// scripts/debug-store-list.js
// 진단 전용: tpay API에 "가맹점(매장) 전체 목록 조회"용 REQ_CODE가 있는지 탐색합니다.
//
// [배경] 지금까지 daily-update.js 등에서 쓰는 REQ_CODE는 2(상품정보조회),
// 3(매출정보 마스터), 4(일정산매출), 5(일상품정산매출), 6(매출정보 주문내역)
// 뿐이고, 전부 SHOP_NO(매장코드)를 미리 알아야만 호출 가능합니다. 즉 지금까지
// "매장 목록 자체"를 API로 받아온 적이 없고, data/store-map.json은 매장코드를
// 이미 알고 있는 상태에서 수동으로 만든 정적 파일로 추정됩니다.
//
// 이 스크립트는 SHOP_NO 없이(또는 더미 값으로) REQ_CODE 0~9를 순서대로
// 호출해보면서, 응답에 매장 목록으로 보이는 배열(STR_NO/SHOP_NO/STR_NM 등의
// 필드를 가진 여러 건)이 나오는지 확인합니다.
//
// 사용법(로컬): TPAY_TOKEN=xxx node scripts/debug-store-list.js
// 사용법(Actions): workflow_dispatch에서 mode=debug-store-list 선택 후 실행

const { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, sleep } = require('./lib');

// 시도해볼 REQ_CODE 후보들. 이미 알려진 2~6은 참고용으로 남겨두되 SHOP_NO 없이
// 호출했을 때 어떤 에러/응답이 오는지도 같이 확인(비교 기준용).
const CANDIDATE_CODES = ['0', '1', '7', '8', '9', '2', '3', '4', '5', '6'];

async function tryReqCode(token, reqCode) {
  const payload = {
    REQ_CODE: reqCode,
    FRANCHISE_CODE,
    BRAND_CODE,
    // SHOP_NO를 일부러 안 넣어봄 — "전체 매장" 조회라면 SHOP_NO가 없어도
    // 응답이 와야 정상. 안 넣었을 때 에러가 나면 그건 이 REQ_CODE가
    // SHOP_NO 필수라는 뜻이므로 후보에서 제외 가능.
  };

  try {
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
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 아래에서 raw로 처리 */ }

    if (!json) {
      console.log(`REQ_CODE=${reqCode}: HTTP ${res.status}, JSON 파싱 실패, 원본(앞 200자): ${text.slice(0, 200)}`);
      return;
    }

    console.log(`\nREQ_CODE=${reqCode}: HTTP ${res.status}, RESPONSE_CODE=${json.RESPONSE_CODE}, RESPONSE_MSG=${json.RESPONSE_MSG || ''}`);
    console.log(`  최상위 키: ${Object.keys(json).join(', ')}`);

    // SALE_INFO, ITEM_INFO 외에 다른 배열 키가 있을 수도 있으므로 전부 훑어봄
    for (const [key, val] of Object.entries(json)) {
      if (Array.isArray(val) && val.length > 0) {
        console.log(`  배열 필드 "${key}": ${val.length}건`);
        console.log(`    첫 건 필드: ${Object.keys(val[0]).join(', ')}`);
        console.log(`    첫 건 샘플: ${JSON.stringify(val[0])}`);
        // 매장 목록처럼 보이는지 힌트 체크
        const looksLikeStoreList = Object.keys(val[0]).some((k) =>
          /SHOP|STR_NO|STR_NM|SHOP_NO|SHOP_NM/i.test(k)
        );
        if (looksLikeStoreList && val.length > 5) {
          console.log(`  ⭐ 이 필드("${key}")가 매장 목록일 가능성이 높습니다! (${val.length}건, SHOP/STR 관련 필드 포함)`);
        }
      }
    }
  } catch (e) {
    console.log(`REQ_CODE=${reqCode}: 요청 실패 - ${e.message}`);
  }
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  console.log('REQ_CODE 후보들을 SHOP_NO 없이 순서대로 호출해봅니다...');
  for (const code of CANDIDATE_CODES) {
    await tryReqCode(token, code);
    await sleep(200);
  }
  console.log('\n완료. ⭐ 표시가 있는 REQ_CODE가 있으면 그게 매장 목록 조회 API일 가능성이 큽니다.');
  console.log('아무 것도 안 나왔다면, tpay 쪽에 "가맹점 목록 조회" API 자체가 없다는 뜻일 수 있습니다 — 이 경우 POS_매출연동규격서 문서를 확인하거나 tpay 측에 문의가 필요합니다.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
