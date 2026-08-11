# tpay 매출 데이터 - GitHub Actions 동기화

Apps Script의 PropertiesService 캐시(9KB/500KB 제한, 청크 저장 실패 등)를 없애고,
GitHub Actions가 직접 tpay API를 호출해서 `data/live-daily.json`을 리포에 저장하는 구조입니다.
대시보드는 이 정적 json 파일만 fetch하면 됩니다.

## 1. 이 폴더를 대시보드 리포(`bokhodu-dashboard`)에 그대로 복사

```
bokhodu-dashboard/
├── .github/workflows/tpay-sync.yml
├── scripts/
│   ├── lib.js
│   ├── backfill.js
│   └── daily-update.js
├── data/
│   ├── store-map.json      (매장 목록, 이미 채워져 있음)
│   └── live-daily.json     (자동 생성됨, 처음엔 없어도 됨)
└── index.html               (기존 대시보드)
```

## 2. GitHub Secret 등록

리포 → Settings → Secrets and variables → Actions → New repository secret

- 이름: `TPAY_TOKEN`
- 값: 기존 Apps Script 스크립트 속성에 넣었던 그 토큰 값

## 3. 최초 백필 1회 실행

Actions 탭 → "tpay 매출 데이터 동기화" → Run workflow → mode: `backfill` 선택 → 실행
(90일치를 한 번에 받아오므로 155개 매장 기준 몇 분 걸릴 수 있습니다)

완료되면 `data/live-daily.json`이 커밋됩니다.

## 4. 이후로는 자동

`*/30 * * * *` cron으로 30분마다 "오늘 하루"만 다시 받아서 병합합니다.
과거 날짜 데이터는 그대로 유지되므로 매번 155번 호출만 하면 됩니다 (가볍고 빠름).

필요하면 cron 주기를 워크플로우 파일에서 조정하세요 (예: 영업시간에만 돌리고 싶다면
`'*/30 6-23 * * *'` 처럼 시간 제한, 단 cron은 UTC 기준이라 KST -9시간 해서 적어야 합니다).

## 5. 프론트엔드(index.html) 연동

기존에 Apps Script `?action=liveDaily&start=...&end=...` 를 호출하던 부분을
아래처럼 정적 json fetch + 클라이언트 필터링으로 바꾸면 됩니다.

```js
// 기존: fetch(POS_API_URL + '?action=liveDaily&start=' + start + '&end=' + end)
// 변경:
const LIVE_DATA_URL = 'https://raw.githubusercontent.com/taehwan8872/bokhodu-dashboard/main/data/live-daily.json';
// (GitHub Pages로 서빙 중이면 'https://taehwan8872.github.io/bokhodu-dashboard/data/live-daily.json' 도 가능,
//  다만 Pages는 캐싱이 더 오래 걸릴 수 있어 raw.githubusercontent.com 쪽이 갱신 반영이 더 빠릅니다)

async function fetchLiveDaily(start, end) {
  const res = await fetch(LIVE_DATA_URL + '?_=' + Date.now()); // 캐시 우회용 쿼리
  const raw = await res.json();

  const stores = {};
  Object.entries(raw.STORES).forEach(([code, s]) => {
    if (s.error) {
      stores[code] = s;
      return;
    }
    stores[code] = {
      name: s.name,
      days: (s.days || []).filter(d => d.SDA_DT >= start && d.SDA_DT <= end),
    };
  });

  return { RESPONSE_CODE: '0000', START: start, END: end, STORES: stores, CACHED_AT: raw.updatedAt };
}
```

이렇게 하면 반환 형태가 기존 Apps Script `liveDaily` 응답과 동일해서
대시보드 나머지 로직(테이블 렌더링 등)은 손댈 필요가 없습니다.

## 6. Apps Script는 어떻게 되나요?

`liveDaily` 관련 코드(`getLiveDaily_`, `refreshLiveDailyCache`, `filterDaysForRange_`,
`LIVECACHE_*` 트리거)는 전부 삭제해도 됩니다. `shops`/`items`/`salesMaster`/`orders`/`payments`
같은 다른 action들은 캐시가 필요 없는 단발성 조회라 Apps Script에 그대로 둬도 무방합니다.
트리거(refreshLiveDailyCache)는 이제 안 쓰니 삭제하세요.

## 참고: public 리포에서 안전한가요?

`TPAY_TOKEN`은 GitHub Secret에만 저장되고 Actions 실행 로그나 코드에는 절대 노출되지 않습니다
(Actions 러너 안에서만 환경변수로 쓰이고 끝). `data/live-daily.json`은 어차피 지금도
대시보드에서 공개적으로 보여주던 매출 데이터라 공개 저장소에 커밋해도 기존과 노출 수준이 같습니다.
