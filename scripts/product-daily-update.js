// scripts/product-daily-update.js
// 매번(예: 30분마다) 실행. "오늘" 하루치 상품별 판매 데이터만 다시 받아서
// 기존 data/product-daily.json에 병합합니다. (daily-update.js의 상품버전)
//
// 저장 포맷은 용량을 줄이기 위해 [날짜, 상품명, 수량, 금액] 배열로 압축 저장합니다.

const fs = require('fs');
const path = require('path');
const { kstDateString, sleep, fetchOneStoreProducts } = require('./lib');

const DATA_PATH = path.join(__dirname, '..', 'data', 'product-daily.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

function loadExisting() {
  if (!fs.existsSync(DATA_PATH)) return { STORES: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {
    console.warn('기존 data/product-daily.json 파싱 실패, 새로 시작합니다:', e.message);
    return { STORES: {} };
  }
}

function toCompactRows(rawRows) {
  // [날짜, 상품명, 수량(취소제외), 실판매금액]
  return rawRows.map((r) => [r.SDA_DT, r.CMDT_NM, r.SDC_QTY, r.SDC_AMT_TTL]);
}

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]
  const today = kstDateString(0);
  const existing = loadExisting();
  const prevStores = existing.STORES || {};

  console.log(`상품별 일일 갱신 시작: ${today}, 매장 ${storeMap.length}개`);

  const stores = { ...prevStores };
  const failed = [];
  let successCount = 0;

  for (let i = 0; i < storeMap.length; i++) {
    const [name, code] = storeMap[i];
    const result = await fetchOneStoreProducts(token, code, today, today);

    if (result.error) {
      failed.push(`${code}(${name}): ${result.error}`);
      if (!stores[code]) stores[code] = { name, rows: [] };
    } else {
      const prev = stores[code] || { name, rows: [] };
      const prevRows = (prev.rows || []).filter((r) => r[0] !== today);
      stores[code] = { name, rows: [...prevRows, ...toCompactRows(result.rows)] };
      successCount++;
    }

    if (i < storeMap.length - 1) await sleep(150);
  }

  const output = {
    START: existing.START || today,
    END: today,
    FORMAT: ['date', 'productName', 'qty', 'amount'],
    STORES: stores,
    updatedAt: new Date().toISOString(),
    lastRunType: 'daily',
    lastRunFailedCount: failed.length,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output));

  console.log(`상품별 갱신 완료: 성공 ${successCount}개 / 실패 ${failed.length}개`);
  if (failed.length) console.log('실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
