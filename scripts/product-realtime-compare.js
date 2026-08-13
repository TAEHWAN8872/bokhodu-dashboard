// scripts/product-realtime-compare.js
// 검증 전용: REQ_CODE 6(주문내역, 상품별 건별 원본)을 상품명 기준으로 합산한 값이
// REQ_CODE 5(일상품정산매출, 정산 확정값)와 일치하는지 비교합니다.
// (debug-realtime-compare.js의 상품버전 — 같은 목적, 같은 사용법)
//
// 사용법(로컬): TPAY_TOKEN=xxx DEBUG_SHOP_NO=BHD155 DEBUG_DATE=20260812 node scripts/product-realtime-compare.js

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE } = require('./lib');

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

// REQ_CODE 6(주문내역) 건별 라인을 상품명(CMDT_NM) 기준으로 그대로 전부 합산.
// SC_FORM(O:첫주문/A:추가주문/D:취소/C:반품) 구분 없이 다 더해서, REQ_CODE 5 확정값과
// 맞는지부터 확인한다 — 안 맞으면 SC_FORM별로 어떻게 처리해야 하는지 breakdown을 같이 보여준다.
function aggregateByProduct(rows) {
  const byProduct = {};
  const formBreakdown = {};
  for (const r of rows) {
    const name = r.CMDT_NM;
    if (!byProduct[name]) byProduct[name] = { qty: 0, amtTtl: 0, lineCount: 0 };
    byProduct[name].qty += Number(r.SC_QTY || 0);
    byProduct[name].amtTtl += Number(r.SC_AMT_TTL || 0);
    byProduct[name].lineCount++;

    const form = r.SC_FORM || '(없음)';
    if (!formBreakdown[form]) formBreakdown[form] = 0;
    formBreakdown[form]++;
  }
  return { byProduct, formBreakdown };
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const code = process.env.DEBUG_SHOP_NO || 'BHD155';
  const date = process.env.DEBUG_DATE;
  if (!date) throw new Error('DEBUG_DATE 환경변수(yyyymmdd)가 필요합니다. 정산이 끝난 과거 날짜로 넣어주세요.');

  console.log(`검증 대상: ${code} / ${date}\n`);

  // REQ_CODE 5: 정산 확정값(상품별)
  const settledRows = await callTpay(token, '5', code, date, date);
  const settled = {};
  for (const r of settledRows) {
    settled[r.CMDT_NM] = { qty: Number(r.SDC_QTY || 0), amtTtl: Number(r.SDC_AMT_TTL || 0) };
  }
  console.log(`--- REQ_CODE 5 (일상품정산매출, 상품 ${settledRows.length}종) ---`);
  console.log(JSON.stringify(settled, null, 2));

  // REQ_CODE 6: 건별 원본을 상품명 기준으로 합산
  const orderRows = await callTpay(token, '6', code, date, date);
  const { byProduct: summed, formBreakdown } = aggregateByProduct(orderRows);
  console.log(`\n--- REQ_CODE 6 (주문내역, 라인 ${orderRows.length}건 합산) ---`);
  console.log(JSON.stringify(summed, null, 2));
  console.log('\nSC_FORM별 라인 수 (O:첫주문/A:추가주문/D:취소/C:반품):', formBreakdown);

  // 비교
  console.log('\n--- 상품별 비교 (확정값 vs 합산값) ---');
  const allNames = new Set([...Object.keys(settled), ...Object.keys(summed)]);
  let allMatch = true;
  for (const name of allNames) {
    const s = settled[name] || { qty: 0, amtTtl: 0 };
    const m = summed[name] || { qty: 0, amtTtl: 0 };
    const match = s.qty === m.qty && s.amtTtl === m.amtTtl;
    if (!match) allMatch = false;
    console.log(`${match ? '✅' : '❌'} ${name}: 확정(수량=${s.qty}, 금액=${s.amtTtl}) / 합산(수량=${m.qty}, 금액=${m.amtTtl})`);
  }
  console.log(allMatch
    ? '\n결론: 모든 상품 일치 — REQ_CODE 6 건별 합산 로직을 실시간 소스로 안전하게 쓸 수 있습니다.'
    : '\n결론: 불일치 상품이 있습니다 — SC_FORM별 라인 수를 참고해서 취소/반품(D/C) 라인 처리 방식을 조정해야 합니다. 이 로그를 그대로 공유해주세요.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
