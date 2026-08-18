// scripts/debug-order-detail.js
// 진단 전용: REQ_CODE 6(매출정보 주문내역) 원본 응답을 그대로 로그에 출력하고,
// REQ_CODE 3(매출정보 마스터, 주문 목록)과 함께 SA_NO ↔ SC_NO 매칭이 맞는지 검증합니다.
//
// [배경] daily-update.js의 matchKey_()는 "SA_NO % 100 = SC_NO"라고 가정하는데,
// 2026-08-18 일일 갱신 로그에서 파주금촌/다산/부천중동/양주옥정 등 일부 매장이
// 그날 주문 전체가 매칭 실패(품목합계 ≠ 주문금액)했습니다. 이 스크립트로:
//   방식A) 기존 방식: SA_NO % 100 = SC_NO
//   방식B) 대안: 시간순 정렬 SA_NO ↔ 숫자순 정렬 SC_NO를 인덱스로 매칭
// 두 방식의 일치율을 비교해서 어느 쪽이 맞는지, 혹은 SA_NO % 100 자체가
// 매장 내에서 충돌하는지(단말기 2대 등) 확인합니다.
//
// 사용법(Actions): workflow_dispatch에서 mode=debug-order 선택 후 실행
// 사용법(로컬, 매장 1개 - 기존 방식):
//   TPAY_TOKEN=xxx DEBUG_SHOP_NO=BHD055 DEBUG_DATE=20260817 node scripts/debug-order-detail.js
// 사용법(로컬, 매장 여러 개 - 이름으로 지정, store-map.json 사용):
//   TPAY_TOKEN=xxx DEBUG_DATE=20260818 \
//   DEBUG_STORE_NAMES="파주금촌점,다산점,부천중동점,양주옥정점" \
//   node scripts/debug-order-detail.js

const fs = require('fs');
const path = require('path');
const {
  TPAY_HOST,
  FRANCHISE_CODE,
  BRAND_CODE,
  kstDateString,
  sleep,
  fetchOneStoreRealtimeWithOrders,
} = require('./lib');

const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

// REQ_CODE 6 원본 응답을 그대로 가져옴 (필드 덤프용, 가공 없음)
async function fetchRawOrderDetail(token, code, date) {
  const payload = {
    REQ_CODE: '6',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: date,
    SALE_END_DATE: date,
  };

  const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Accept-Encoding': 'utf-8',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const json = JSON.parse(text); // 실패 시 그대로 throw (진단 스크립트라 의도적으로 안 감쌈)
  return json.SALE_INFO || [];
}

function groupBySc(rows) {
  const byNo = {};
  for (const r of rows) {
    const key = String(r.SC_NO);
    if (!byNo[key]) byNo[key] = { lines: [], sum: 0 };
    byNo[key].lines.push(r);
    byNo[key].sum += Number(r.SC_AMT_TTL || 0);
  }
  return byNo;
}

function resolveTargets() {
  const codesEnv = process.env.DEBUG_STORE_CODES;
  if (codesEnv) {
    return codesEnv.split(',').map((c) => c.trim()).filter(Boolean).map((code) => [null, code]);
  }

  const namesEnv = process.env.DEBUG_STORE_NAMES;
  if (namesEnv) {
    const names = namesEnv.split(',').map((s) => s.trim()).filter(Boolean);
    const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]
    const targets = [];
    for (const n of names) {
      const found = storeMap.find(([name]) => name === n);
      if (found) targets.push(found);
      else console.log(`⚠ store-map.json에서 "${n}" 이름을 못 찾았습니다. (건너뜀)`);
    }
    return targets;
  }

  // 기존 방식(하위호환): 매장 1개, 코드만
  const code = process.env.DEBUG_SHOP_NO || 'BHD055';
  return [[null, code]];
}

async function diagnoseStore(token, name, code, date) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`매장: ${name || '(이름 미상)'} (${code})  날짜: ${date}`);
  console.log('='.repeat(70));

  // --- REQ_CODE 6 원본 필드 덤프 (기존 기능 그대로) ---
  let rows;
  try {
    rows = await fetchRawOrderDetail(token, code, date);
  } catch (e) {
    console.log(`REQ_CODE 6 조회/파싱 실패: ${e.message}`);
    return;
  }
  console.log(`\n[REQ_CODE 6] SALE_INFO 건수: ${rows.length}건`);

  if (rows.length === 0) {
    console.log('해당 매장/날짜에 라인이 없습니다.');
    return;
  }

  console.log('\n첫 번째 라인의 필드 목록:', Object.keys(rows[0]));
  console.log('\n--- 원본 라인 샘플 (앞 5건, 전체 필드 그대로) ---');
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));

  const candidateKeys = ['SA_NO', 'SDA_NO', 'SC_NO', 'ORDER_NO'];
  for (const key of candidateKeys) {
    if (key in rows[0]) {
      const byKey = {};
      for (const r of rows) {
        const k = r[key];
        byKey[k] = (byKey[k] || 0) + 1;
      }
      console.log(`\n"${key}" 필드 발견 — 이 키로 묶으면 주문 수: ${Object.keys(byKey).length}개 (라인 총 ${rows.length}건)`);
      console.log('상위 5개 주문의 라인 수:', Object.entries(byKey).slice(0, 5));
    }
  }

  // --- 여기부터 매칭 검증 (REQ_CODE 3과 대조) ---
  const realtime = await fetchOneStoreRealtimeWithOrders(token, code, date);
  if (realtime.error) {
    console.log(`\nREQ_CODE 3 조회 실패: ${realtime.error} (매칭 비교는 건너뜀)`);
    return;
  }
  const orders = [...realtime.orders].sort((a, b) => (a.SA_DT < b.SA_DT ? -1 : 1));
  console.log(`\n[REQ_CODE 3] 주문 ${orders.length}건 (시간순)`);
  orders.forEach((o) => {
    console.log(
      `  SA_NO=${o.SA_NO}  (SA_NO%100=${Number(o.SA_NO) % 100})  SA_DT=${o.SA_DT}  ` +
      `SA_GET_AMT=${o.SA_GET_AMT}  SA_DEL_MK=${o.SA_DEL_MK}`
    );
  });

  if (orders.length === 0) {
    console.log('오늘 주문이 없어 매칭 비교를 건너뜁니다.');
    return;
  }

  // SA_NO % 100 충돌 여부
  const modCounts = {};
  orders.forEach((o) => {
    const m = Number(o.SA_NO) % 100;
    modCounts[m] = (modCounts[m] || 0) + 1;
  });
  const collisions = Object.entries(modCounts).filter(([, c]) => c > 1);
  if (collisions.length) {
    console.log(
      `\n⚠ SA_NO % 100 값이 매장 내에서 중복됩니다: ` +
      collisions.map(([m, c]) => `${m}(${c}건)`).join(', ') +
      ` → % 100 매칭 방식은 이 매장에서 원천적으로 불가능`
    );
  } else {
    console.log('\nSA_NO % 100 값은 매장 내에서 중복 없음 (충돌은 아님, 다른 원인 가능성)');
  }

  const grouped = groupBySc(rows);
  const scKeys = Object.keys(grouped).sort((a, b) => Number(a) - Number(b));

  console.log('\n--- 매칭 비교 ---');
  console.log('방식A) 기존: SA_NO % 100 = SC_NO 로 매칭');
  let matchCountA = 0;
  orders.forEach((o) => {
    const key = String(Number(o.SA_NO) % 100);
    const g = grouped[key];
    const sum = g ? g.sum : null;
    const ok = sum === Number(o.SA_GET_AMT || 0);
    if (ok) matchCountA++;
    console.log(
      `  SA_NO=${o.SA_NO} → SC_NO=${key} : ${g ? `품목합계=${sum}` : '매칭없음'} ` +
      `vs 주문금액=${o.SA_GET_AMT} → ${ok ? '✅ 일치' : '❌ 불일치'}`
    );
  });
  console.log(`방식A 일치 건수: ${matchCountA} / ${orders.length}`);

  console.log('\n방식B) 대안: 시간순 SA_NO ↔ 숫자순 SC_NO 인덱스 매칭');
  let matchCountB = 0;
  orders.forEach((o, i) => {
    const key = scKeys[i];
    const g = key ? grouped[key] : null;
    const sum = g ? g.sum : null;
    const ok = sum === Number(o.SA_GET_AMT || 0);
    if (ok) matchCountB++;
    console.log(
      `  [${i}] SA_NO=${o.SA_NO}(${o.SA_DT}) → SC_NO=${key ?? '없음'} : ` +
      `${g ? `품목합계=${sum}` : '매칭없음'} vs 주문금액=${o.SA_GET_AMT} → ${ok ? '✅ 일치' : '❌ 불일치'}`
    );
  });
  console.log(`방식B 일치 건수: ${matchCountB} / ${orders.length}`);
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const date = process.env.DEBUG_DATE || kstDateString(-1);
  const targets = resolveTargets();

  if (!targets.length) {
    console.log('진단할 매장이 없습니다. DEBUG_STORE_NAMES / DEBUG_STORE_CODES / DEBUG_SHOP_NO를 확인하세요.');
    return;
  }

  for (const [name, code] of targets) {
    await diagnoseStore(token, name, code, date);
    await sleep(150);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
