// scripts/backfill.js
// 최초 1회(또는 필요시 수동으로) 90일치 전체 데이터를 새로 받아서
// data/live-daily.json을 새로 만듭니다. 평소 자동 실행되는 스크립트가 아니라
// GitHub Actions에서 workflow_dispatch로 수동 실행하는 용도입니다.
//
// 사용법(로컬): TPAY_TOKEN=xxx node scripts/backfill.js
// 사용법(Actions): workflow_dispatch 로 tpay-sync.yml의 backfill job 실행

const fs = require('fs');
const path = require('path');
const { kstDateString, sleep, fetchOneStore } = require('./lib');

const ROLLING_DAYS = Number(process.env.ROLLING_DAYS || 90);
const DATA_PATH = path.join(__dirname, '..', 'data', 'live-daily.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]

  const end = kstDateString(0);
  const start = kstDateString(-ROLLING_DAYS);

  console.log(`백필 시작: ${start} ~ ${end}, 매장 ${storeMap.length}개`);

  const stores = {};
  const failed = [];

  for (let i = 0; i < storeMap.length; i++) {
    const [name, code] = storeMap[i];
    const result = await fetchOneStore(token, code, start, end);
    stores[code] = { name, ...result };
    if (result.error) failed.push(`${code}(${name}): ${result.error}`);
    if (i % 20 === 0) console.log(`진행: ${i + 1}/${storeMap.length}`);
    if (i < storeMap.length - 1) await sleep(150);
  }

  const output = {
    START: start,
    END: end,
    STORES: stores,
    updatedAt: new Date().toISOString(),
    lastRunType: 'backfill',
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output));

  console.log(`백필 완료: 성공 ${storeMap.length - failed.length}개 / 실패 ${failed.length}개`);
  if (failed.length) console.log('실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
