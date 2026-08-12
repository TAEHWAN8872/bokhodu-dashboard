// scripts/debug-single-store.js (임시 - 상품분류 디버그용)
// REQ_CODE 2 응답 중 CMDTG_NM(분류명) 전체 목록만 압축해서 보여주는 디버그 스크립트.
// (원본 전체를 찍으면 로그가 3000자에서 잘려서 일부 분류만 보이는 문제가 있었음)
//
// 확인이 끝나면 이 파일을 원래 debug-single-store.js 내용으로 되돌려주세요.

const { fetchProductCategories, buildProductCategoryMap } = require('./lib');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');
  const shopNo = process.env.DEBUG_SHOP_NO || 'BHD055';

  console.log(`SHOP_NO=${shopNo} 상품분류 조회 중...`);
  const result = await fetchProductCategories(token, shopNo);
  if (result.error) {
    console.error('조회 실패:', result.error);
    process.exit(1);
  }

  console.log(`총 상품 수: ${result.products.length}`);

  const byCategory = {};
  result.products.forEach((p) => {
    const cat = p.CMDTG_NM || '(분류없음)';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p.CMDT_NM);
  });

  console.log(`\n분류(CMDTG_NM) 종류: ${Object.keys(byCategory).length}개`);
  Object.entries(byCategory).forEach(([cat, names]) => {
    console.log(`\n[${cat}] (${names.length}개)`);
    console.log('  ' + names.slice(0, 10).join(', ') + (names.length > 10 ? ' ...' : ''));
  });

  const map = buildProductCategoryMap(result.products);
  console.log(`\n최종 매핑(상품명→분류명) 상품 수: ${Object.keys(map).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
