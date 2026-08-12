// scripts/product-category.js
// 상품분류(카테고리) 매핑 수집. product-daily-update.js와 동일한 인증(TPAY_TOKEN env)/
// 매장 목록(data/store-map.json)을 사용합니다.
//
// 상품 마스터 데이터(분류명)는 매장마다 다르지 않고 프랜차이즈 전체에 동일할 가능성이
// 높아서, 기본값은 대표 매장 1곳만 조회하도록 되어 있습니다(REPRESENTATIVE_ONLY = true).
// 자주 바뀌는 데이터가 아니므로 하루 1회 정도만 실행하면 충분합니다(30분 주기 X).
//
// 만약 대표 매장 응답에 일부 상품(신상품 등)이 빠져있는 게 확인되면
// REPRESENTATIVE_ONLY를 false로 바꿔서 전체 매장을 돌며 합치도록 하면 됩니다
// (느리지만 더 안전 — 151개 매장 * 150ms 슬립이면 대략 30초 이상 걸릴 수 있음).

const fs = require('fs');
const path = require('path');
const { sleep, fetchProductCategories, buildProductCategoryMap } = require('./lib');

const DATA_PATH = path.join(__dirname, '..', 'data', 'product-category.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

const REPRESENTATIVE_ONLY = true; // false로 바꾸면 전체 매장을 돈다

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]
  const targets = REPRESENTATIVE_ONLY ? storeMap.slice(0, 1) : storeMap;

  console.log(`상품분류 수집 시작: 매장 ${targets.length}개 조회 (전체 ${storeMap.length}개 중)`);

  let allProducts = [];
  const failed = [];

  for (let i = 0; i < targets.length; i++) {
    const [name, code] = targets[i];
    const result = await fetchProductCategories(token, code);

    if (result.error) {
      failed.push(`${code}(${name}): ${result.error}`);
    } else {
      // 첫 호출 시 실제 응답 구조를 눈으로 확인하고 싶다면 아래 주석을 풀어서 확인
      // console.log(JSON.stringify(result.products.slice(0, 3), null, 2));
      allProducts = allProducts.concat(result.products);
    }

    if (i < targets.length - 1) await sleep(150);
  }

  if (allProducts.length === 0) {
    throw new Error(
      '수집된 상품 데이터가 없습니다. REQ_CODE 2 응답 필드명이 SALE_INFO가 아닐 수 있으니 ' +
        'lib.js의 fetchProductCategories 안에서 실제 응답(JSON.stringify(data))을 한 번 찍어보고 ' +
        '필드명을 맞춰주세요.'
    );
  }

  const map = buildProductCategoryMap(allProducts);

  const output = {
    map, // { 상품명: 분류명 }
    productCount: Object.keys(map).length,
    sourceStoreCount: targets.length,
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2));

  console.log(`상품분류 수집 완료: 상품 ${output.productCount}개 -> ${DATA_PATH}`);
  if (failed.length) console.log('실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
