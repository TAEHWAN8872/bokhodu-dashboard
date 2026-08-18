// scripts/debug-order-detail.js
// 진단 전용: REQ_CODE 6(매출정보 주문내역) 원본 응답을 그대로 로그에 출력합니다.
// "일판매 매출" 탭에서 주문 클릭 시 품목별 상세를 보여주려면, 이 응답에 주문을
// 식별할 수 있는 필드(SA_NO 등, REQ_CODE 3의 주문번호와 매칭되는 키)가 있는지부터
// 확인해야 합니다.
//
// 사용법(Actions): workflow_dispatch에서 mode=debug-order 선택 후 실행
// 사용법(로컬): TPAY_TOKEN=xxx DEBUG_SHOP_NO=BHD055 DEBUG_DATE=20260817 node scripts/debug-order-detail.js

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, kstDateString } = require('./lib');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const code = process.env.DEBUG_SHOP_NO || 'BHD055';
  // 기본값: 정산이 끝났을 어제 날짜 (오늘은 취소건 등으로 라인이 계속 바뀔 수 있어서)
  const date = process.env.DEBUG_DATE || kstDateString(-1);

  const payload = {
    REQ_CODE: '6',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: date,
    SALE_END_DATE: date,
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

  try {
    const json = JSON.parse(text);
    console.log('응답 최상위 키 목록:', Object.keys(json));
    const rows = json.SALE_INFO || [];
    console.log(`SALE_INFO 건수: ${rows.length}건`);

    if (rows.length > 0) {
      console.log('\n첫 번째 라인의 필드 목록:', Object.keys(rows[0]));
      console.log('\n--- 원본 라인 샘플 (앞 5건, 전체 필드 그대로) ---');
      console.log(JSON.stringify(rows.slice(0, 5), null, 2));

      // 같은 주문(추정 키)으로 몇 줄이 묶이는지 확인 — SA_NO가 있다면 이걸로 그룹핑해서 보여줌
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
    } else {
      console.log('해당 매장/날짜에 라인이 없습니다. DEBUG_SHOP_NO / DEBUG_DATE를 매출이 있던 값으로 바꿔서 다시 시도해주세요.');
    }
  } catch (e) {
    console.log('JSON 파싱 실패:', e.message);
    console.log('원본 응답 본문:', text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
