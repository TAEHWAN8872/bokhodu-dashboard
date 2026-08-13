// scripts/debug-realtime-compare.js
// 검증 전용: REQ_CODE 3(매출정보 마스터, 주문 건별 원본)을 매장+날짜로 합산한 값이
// REQ_CODE 4(일정산매출, 정산 확정값)와 일치하는지 비교합니다.
//
// 목적: "오늘" 매출을 실시간으로 보려면 REQ_CODE 3을 써야 하는데, 건별 합산 로직이
// 정산값과 정확히 맞아떨어지는지 먼저 확인이 필요합니다. 이미 정산이 끝난 과거 날짜로
// 돌려서 두 값이 같으면, 같은 합산 로직을 "오늘" 날짜에도 안전하게 쓸 수 있다는 뜻입니다.
//
// 사용법(로컬): TPAY_TOKEN=xxx DEBUG_SHOP_NO=BHD155 DEBUG_DATE=20260812 node scripts/debug-realtime-compare.js

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE } = require('./lib');

// 매출정보 마스터(REQ_CODE 3) 건별 레코드에서 합산할 금액 필드들.
// 일정산매출(REQ_CODE 4)의 필드명과 1:1로 동일합니다.
const SUM_FIELDS = [
  'SA_AMOUNT', 'SA_DEL_AMT', 'SA_DC_AMT', 'SA_AMT_TTL', 'SA_ADD_AMT',
  'SA_GET_AMT', 'SA_RL_AMT', 'SA_VAT_AMT', 'SA_TF_AMT', 'SA_CASH_AMT',
  'SA_CARD_AMT', 'SA_CPN_AMT', 'SA_ON_AMT', 'SA_RCV_AMT', 'SA_LC_AMT',
  'SA_RSV_AMT', 'SA_PREPAID_AMT', 'SA_CASH_BILL_AMT', 'SA_CXL_AMT',
  'SA_GUEST_M', 'SA_GUEST_F',
];

async function callTpay(token, reqCode, code, start, end) {
  const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Accept-Encoding': 'utf-8',
    },
    body: JSON.stringify({
      REQ_CODE: reqCode,
      FRANCHISE_CODE,
      BRAND_CODE,
      SHOP_NO: code,
      SALE_START_DATE: start,
      SALE_END_DATE: end,
    }),
  });
  const data = await res.json();
  if (data.RESPONSE_CODE !== '0000') {
    throw new Error(`REQ_CODE ${reqCode} 실패: ${data.RESPONSE_MSG || data.RESPONSE_CODE}`);
  }
  return data.SALE_INFO || [];
}

function sumOrdersByDay(orders) {
  const byDay = {};
  for (const o of orders) {
    const day = o.SDA_DT;
    if (!byDay[day]) {
      byDay[day] = { SDA_DT: day, orderCount: 0 };
      for (const f of SUM_FIELDS) byDay[day][f] = 0;
    }
    byDay[day].orderCount++;
    for (const f of SUM_FIELDS) {
      byDay[day][f] += Number(o[f] || 0);
    }
  }
  return byDay;
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const code = process.env.DEBUG_SHOP_NO || 'BHD155';
  const date = process.env.DEBUG_DATE; // yyyymmdd, 필수 (정산 끝난 과거 날짜 권장)
  if (!date) throw new Error('DEBUG_DATE 환경변수(yyyymmdd)가 필요합니다. 정산이 끝난 과거 날짜로 넣어주세요.');

  console.log(`검증 대상: ${code} / ${date}\n`);

  // REQ_CODE 4: 정산 확정값 (기존에 쓰던 것 그대로)
  const settled = await callTpay(token, '4', code, date, date);
  console.log('--- REQ_CODE 4 (일정산매출, 확정값) ---');
  console.log(JSON.stringify(settled[0] || null, null, 2));

  // REQ_CODE 3: 건별 원본을 같은 날짜로 조회해서 직접 합산
  const orders = await callTpay(token, '3', code, date, date);
  const summed = sumOrdersByDay(orders)[date];
  console.log(`\n--- REQ_CODE 3 (매출정보 마스터, 주문 ${orders.length}건 합산) ---`);
  console.log(JSON.stringify(summed || null, null, 2));

  // 비교
  console.log('\n--- 필드별 비교 (확정값 vs 합산값) ---');
  const s = settled[0] || {};
  const m = summed || {};
  let allMatch = true;
  for (const f of SUM_FIELDS) {
    const sv = Number(s[f] || 0);
    const mv = Number(m[f] || 0);
    const match = sv === mv;
    if (!match) allMatch = false;
    console.log(`${match ? '✅' : '❌'} ${f}: 확정=${sv} / 합산=${mv}${match ? '' : '  <- 불일치!'}`);
  }
  console.log(allMatch
    ? '\n결론: 모든 필드 일치 — REQ_CODE 3 건별 합산 로직을 실시간 소스로 안전하게 쓸 수 있습니다.'
    : '\n결론: 불일치 필드가 있습니다 — 합산 로직(취소 건 처리 등)을 더 봐야 합니다. 위 원본 JSON을 공유해주세요.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
