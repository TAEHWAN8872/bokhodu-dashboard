// scripts/debug-single-store.js
const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, kstDateString } = require('./lib');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const code = process.env.DEBUG_SHOP_NO || 'BHD055';
  const end = kstDateString(0);
  const start = kstDateString(-7);

  const payload = {
    REQ_CODE: '4',
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
  } catch (e) {
    console.log('JSON 파싱 실패:', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
