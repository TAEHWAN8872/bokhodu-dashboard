// scripts/product-backfill.js
// 최초 1회(또는 필요시 수동으로) 상품별 판매 데이터를 새로 받아서
// data/product-daily.json을 새로 만듭니다. (backfill.js의 상품버전)
//
// 상품 단위라 데이터량이 커서, 기본 90일로 제한합니다.
//
// 사용법(Actions): workflow_dispatch 로 tpay-sync.yml의 mode=product-backfill 실행

const fs = require('fs');
const path = require('path');
const { kstDateString, sleep, fetchOneStoreProductsRange } = require('./lib');

const ROLLING_DAYS = Number(process.env.PRODUCT_ROLLING_DAYS || 90);
const DATA_PATH = path.join(__dirname, '..', 'data', 'product-daily.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

function toCompactRows(rawRows) {
  return rawRows.map((r) => [r.SDA_DT, r.CMDT_NM, r.SDC_QTY, r.SDC_AMT_TTL]);
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]

  const end = kstDateString(0);
  const start = kstDateString(-ROLLING_DAYS);

  console.log(`상품별 백필 시작: ${start} ~ ${end}, 매장 ${storeMap.length}개 (15일 단위 자동 분할 조회)`);

  const stores = {};
  const failed = [];
  const partial = [];

  for (let i = 0; i < storeMap.length; i++) {
    const [name, code] = storeMap[i];
    const result = await fetchOneStoreProductsRange(token, code, start, end);

    if (result.error) {
      failed.push(`${code}(${name}): ${result.error}`);
      stores[code] = { name, rows: [] };
    } else {
      stores[code] = { name, rows: toCompactRows(result.rows) };
      if (result.partialError) partial.push(`${code}(${name}): ${result.partialError}`);
    }

    if (i % 20 === 0) console.log(`진행: ${i + 1}/${storeMap.length}`);
    if (i < storeMap.length - 1) await sleep(150);
  }

  const output = {
    START: start,
    END: end,
    FORMAT: ['date', 'productName', 'qty', 'amount'],
    STORES: stores,
    updatedAt: new Date().toISOString(),
    lastRunType: 'product-backfill',
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output));

  const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1);
  console.log(
    `상품별 백필 완료: 완전성공 ${storeMap.length - failed.length - partial.length}개 / ` +
      `부분성공 ${partial.length}개 / 실패 ${failed.length}개 / 파일크기 약 ${sizeMB}MB`
  );
  if (partial.length) console.log('부분 실패 매장(일부 구간만 누락):\n' + partial.join('\n'));
  if (failed.length) console.log('완전 실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
