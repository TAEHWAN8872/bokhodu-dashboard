// scripts/debug-product-category.js
// REQ_CODE 2(상품정보 조회)의 원본 응답을 그대로 찍어보는 디버그 전용 스크립트.
// lib.js의 fetchProductCategories()를 거치지 않고 raw fetch로 직접 호출해서,
// RESPONSE_CODE가 실제로 뭔지 / 필드명이 뭔지를 그대로 확인합니다.
//
// 실행: TPAY_TOKEN=xxx DEBUG_SHOP_NO=BHD055 node scripts/debug-product-category.js
// (GitHub Actions에서는 workflow_dispatch의 debug_shop_no 입력값을 그대로 씁니다)

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, kstDateString } = require('./lib');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');
  const shopNo = process.env.DEBUG_SHOP_NO || 'BHD055';

  console.log(`REQ_CODE 2 디버그 호출: SHOP_NO=${shopNo}`);

  // 1차 시도: 날짜 범위 없이 (지금 lib.js의 fetchProductCategories와 동일한 바디)
  await tryCall('바디 A (날짜 없음)', {
    REQ_CODE: '2',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: shopNo,
  });

  // 2차 시도: 혹시 날짜 범위를 요구하는 API일 수도 있으니 오늘 날짜를 넣어서도 호출
  const today = kstDateString(0);
  await tryCall('바디 B (오늘 날짜 포함)', {
    REQ_CODE: '2',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: shopNo,
    SALE_START_DATE: today,
    SALE_END_DATE: today,
  });
}

async function tryCall(label, bodyObj) {
  console.log(`\n=== ${label} ===`);
  console.log('요청 바디:', JSON.stringify(bodyObj));
  try {
    const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.TPAY_TOKEN,
        'Accept-Encoding': 'utf-8',
      },
      body: JSON.stringify(bodyObj),
    });
    console.log('HTTP 상태:', res.status);
    const text = await res.text();
    console.log('원본 응답 (최대 3000자):');
    console.log(text.slice(0, 3000));
  } catch (e) {
    console.log('요청 자체 실패:', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
