// scripts/debug-check-category-coverage.js
// 1회성 점검 스크립트. product-daily.json에 실제로 등장한 상품명들이
// product-category.json의 map에 전부 분류가 붙어있는지 확인한다.
// 배치(product-daily-update.js, product-category.js)와는 무관하게
// 필요할 때 로컬/CI에서 수동으로만 돌리면 된다.

const fs = require('fs');
const path = require('path');

const DAILY_PATH = path.join(__dirname, '..', 'data', 'product-daily.json');
const CATEGORY_PATH = path.join(__dirname, '..', 'data', 'product-category.json');

function main() {
  const daily = JSON.parse(fs.readFileSync(DAILY_PATH, 'utf8'));
  const category = JSON.parse(fs.readFileSync(CATEGORY_PATH, 'utf8'));
  const map = category.map || {};

  // product-daily.json 구조: { STORES: { code: { name, rows: [[date, productName, qty, amount], ...] } } }
  const nameCounts = {}; // 상품명 -> 등장 횟수(대략적인 판매 빈도)

  for (const code of Object.keys(daily.STORES || {})) {
    const rows = daily.STORES[code].rows || [];
    for (const row of rows) {
      const productName = row[1]; // FORMAT: ['date', 'productName', 'qty', 'amount']
      nameCounts[productName] = (nameCounts[productName] || 0) + 1;
    }
  }

  const allNames = Object.keys(nameCounts);
  const missing = allNames.filter((n) => !map[n]);

  console.log(`전체 상품(판매 데이터 기준): ${allNames.length}개`);
  console.log(`카테고리 매핑 존재: ${allNames.length - missing.length}개`);
  console.log(`카테고리 매핑 누락: ${missing.length}개`);

  if (missing.length > 0) {
    // 등장 빈도 높은 순으로 정렬해서 보여줌 (자주 팔리는데 누락된 게 더 시급하니까)
    missing.sort((a, b) => nameCounts[b] - nameCounts[a]);
    console.log('\n누락된 상품명 (등장횟수 많은 순):');
    for (const n of missing) {
      console.log(`  ${n}  (${nameCounts[n]}건)`);
    }
  }
}

main();
