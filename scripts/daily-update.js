// scripts/daily-update.js
// 매번(예: 30분마다) 실행되는 스크립트. "오늘" 하루치만 다시 받아서
// 기존 data/live-daily.json에 병합합니다. 과거 날짜는 이미 저장된 값을
// 그대로 유지하므로 매번 155개 매장 x 1일치만 호출 -> 빠르고 가볍습니다.
//
// 실패한 매장은 이번 회차 데이터로 덮어쓰지 않고 "직전 성공값"을 그대로
// 유지합니다 (매출 0원과 조회 실패가 섞이지 않도록).
//
// [실시간 소스] "오늘"은 REQ_CODE 4(일정산매출, 정산 배치가 끝나야 채워짐) 대신
// fetchOneStoreRealtime()으로 REQ_CODE 3(매출정보 마스터, 주문 건별 원본)을 조회해서
// 직접 합산합니다. 확정값과 합산값이 완전히 일치함을 검증 완료(2026-08-13,
// scripts/debug-realtime-compare.js). 과거 날짜는 이미 정산 확정된 값이 그대로
// 저장되어 있으므로 건드리지 않습니다.

const fs = require('fs');
const path = require('path');
const { kstDateString, sleep, fetchOneStoreRealtimeWithOrders } = require('./lib');

const DATA_PATH = path.join(__dirname, '..', 'data', 'live-daily.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');
const RECEIPT_PATH = path.join(__dirname, '..', 'data', 'receipt-today.json');

// 영수증(일판매 매출) 탭에 필요한 필드만 추려서 저장 (용량 절약)
function trimOrder_(o) {
  return {
    STR_NM: o.STR_NM,
    SA_NO: o.SA_NO,
    SA_DT: o.SA_DT,
    SA_DEL_MK: o.SA_DEL_MK, // L: 정상(완료), D: 취소
    SA_GET_AMT: Number(o.SA_GET_AMT || 0),   // 판매금액(결제금액)
    SA_CASH_AMT: Number(o.SA_CASH_AMT || 0), // 현금
    SA_CARD_AMT: Number(o.SA_CARD_AMT || 0), // 카드
    SA_DISCOUNT: Number(o.SA_DC_AMT || 0) + Number(o.SA_ADD_AMT || 0), // 단품할인+전체할인
  };
}

function loadExisting() {
  if (!fs.existsSync(DATA_PATH)) return { STORES: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {
    console.warn('기존 data/live-daily.json 파싱 실패, 새로 시작합니다:', e.message);
    return { STORES: {} };
  }
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]
  const today = kstDateString(0);
  const existing = loadExisting();
  const prevStores = existing.STORES || {};

  console.log(`일일 갱신 시작: ${today}, 매장 ${storeMap.length}개`);

  const stores = { ...prevStores };
  const failed = [];
  let successCount = 0;
  const allOrders = []; // 오늘자 전 매장 영수증(주문) 원본 — 일판매 매출 탭용

  for (let i = 0; i < storeMap.length; i++) {
    const [name, code] = storeMap[i];
    const result = await fetchOneStoreRealtimeWithOrders(token, code, today);

    if (result.error) {
      failed.push(`${code}(${name}): ${result.error}`);
      // 실패 시 기존 값 유지 (없으면 error 상태로 최초 기록)
      if (!stores[code]) stores[code] = { name, error: result.error };
    } else {
      const prev = stores[code] || { name, days: [] };
      const prevDays = (prev.days || []).filter((d) => d.SDA_DT !== today);
      stores[code] = { name, days: [...prevDays, ...result.days] };
      successCount++;
      for (const o of result.orders) allOrders.push(trimOrder_(o));
    }

    if (i < storeMap.length - 1) await sleep(150);
  }

  const output = {
    START: existing.START || today,
    END: today,
    STORES: stores,
    updatedAt: new Date().toISOString(),
    lastRunType: 'daily',
    lastRunFailedCount: failed.length,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output));

  // 일판매 매출(영수증) 탭용 파일: "오늘" 스냅샷이라 매회 완전히 새로 씀(누적 아님, 취소건 포함)
  allOrders.sort((a, b) => (a.SA_DT < b.SA_DT ? 1 : a.SA_DT > b.SA_DT ? -1 : 0)); // 최신순
  const receiptOutput = {
    DATE: today,
    ORDERS: allOrders,
    updatedAt: new Date().toISOString(),
    lastRunFailedCount: failed.length,
  };
  fs.writeFileSync(RECEIPT_PATH, JSON.stringify(receiptOutput));

  console.log(`갱신 완료: 성공 ${successCount}개 / 실패 ${failed.length}개 / 영수증 ${allOrders.length}건`);
  if (failed.length) console.log('실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
