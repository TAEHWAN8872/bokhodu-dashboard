// scripts/backfill.js
// 최초 1회(또는 필요시 수동으로) 90일치 전체 데이터를 새로 받아서
// data/live-daily.json을 새로 만듭니다. 평소 자동 실행되는 스크립트가 아니라
// GitHub Actions에서 workflow_dispatch로 수동 실행하는 용도입니다.
//
// tpay API는 조회 범위가 15일을 넘어가면 에러 없이 빈 배열을 반환하는 것으로
// 확인되어(디버그 결과: 14일=정상, 31일 이상=전멸), fetchOneStoreRange()가
// 요청 범위를 15일 단위로 자동으로 쪼개서 여러 번 호출한 뒤 합쳐준다.
//
// 사용법(로컬): TPAY_TOKEN=xxx node scripts/backfill.js
// 사용법(Actions): workflow_dispatch 로 tpay-sync.yml의 backfill job 실행

const fs = require('fs');
const path = require('path');
const { kstDateString, sleep, fetchOneStoreRange } = require('./lib');

const ROLLING_DAYS = Number(process.env.ROLLING_DAYS || 90);
const DATA_PATH = path.join(__dirname, '..', 'data', 'live-daily.json');
const STORE_MAP_PATH = path.join(__dirname, '..', 'data', 'store-map.json');

async function main() {
  const token = process.env.TPAY_TOKEN;
  if (!token) throw new Error('TPAY_TOKEN 환경변수가 없습니다.');

  const storeMap = JSON.parse(fs.readFileSync(STORE_MAP_PATH, 'utf8')); // [[name, code], ...]

  const end = kstDateString(0);
  const start = kstDateString(-ROLLING_DAYS);

  console.log(`백필 시작: ${start} ~ ${end}, 매장 ${storeMap.length}개 (15일 단위 자동 분할 조회)`);

  const stores = {};
  const failed = [];
  const partial = [];

  for (let i = 0; i < storeMap.length; i++) {
    const [name, code] = storeMap[i];
    const result = await fetchOneStoreRange(token, code, start, end);
    stores[code] = { name, ...result };

    if (result.error) {
      failed.push(`${code}(${name}): ${result.error}`);
    } else if (result.partialError) {
      partial.push(`${code}(${name}): ${result.partialError}`);
    }

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

  console.log(
    `백필 완료: 완전성공 ${storeMap.length - failed.length - partial.length}개 / ` +
      `부분성공 ${partial.length}개 / 실패 ${failed.length}개`
  );
  if (partial.length) console.log('부분 실패 매장(일부 구간만 누락):\n' + partial.join('\n'));
  if (failed.length) console.log('완전 실패 매장:\n' + failed.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
