// scripts/debug-product-sales.js
// 진단 전용: 매장 1곳에 대해 REQ_CODE 5(상품별 일별 정산조회) 원본 응답을
// 그대로 로그에 출력합니다. "상품별 매출" 탭을 만들기 전에
//  - 응답이 어떤 키로 오는지 (SALE_INFO? PRODUCT_INFO? 등)
//  - STR_NM/SDA_DT/CMDT_NM/SDC_QTY/SDC_AMT_TTL 필드명이 실제로 그대로 오는지
//  - REQ_CODE 4처럼 조회 범위 제한(15일)이 여기도 걸리는지
// 를 확인하기 위한 용도입니다.
//
// 사용법(Actions): workflow_dispatch에서 mode=debug_product 선택 후 실행
// 사용법(로컬): TPAY_TOKEN=xxx node scripts/debug-product-sales.js

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, kstDateString } = require('./lib');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const code = process.env.DEBUG_SHOP_NO || 'BHD055'; // 검단신도시점 (기존에도 정상 조회됐던 매장)
  const testDays = Number(process.env.DEBUG_DAYS || 2); // REQ_CODE 4처럼 범위 제한이 있을 수 있어 우선 짧게
  const end = kstDateString(0);
  const start = kstDateString(-testDays);

  const payload = {
    REQ_CODE: '5',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: start,
    SALE_END_DATE: end,
  };

  console.log('요청 payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Accept-Encoding': 'utf-8',
    },
    body: JSON.stringify(payload),
  });

  console.log('HTTP 상태 코드:', res.status);
  const text = await res.text();
  console.log('원본 응답 본문 (그대로):');
  console.log(text);

  try {
    const json = JSON.parse(text);
    console.log('응답 최상위 키 목록:', Object.keys(json));
    // SALE_INFO 외에 다른 이름의 배열 키가 있을 수 있으니 배열 타입 키를 전부 찾아서 알려줌
    const arrayKeys = Object.keys(json).filter((k) => Array.isArray(json[k]));
    console.log('배열 타입 키들(상품 목록일 가능성):', arrayKeys);
    arrayKeys.forEach((k) => console.log(`  ${k}: ${json[k].length}건`));
  } catch (e) {
    console.log('JSON 파싱 실패:', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
