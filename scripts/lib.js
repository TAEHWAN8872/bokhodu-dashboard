// scripts/lib.js
// tpay API 공통 함수 모음. Apps Script 버전의 fetchOneStore_/callTpay_ 로직을 그대로 이식.
//
// [범위 제한 대응] tpay API는 SALE_START_DATE~SALE_END_DATE 조회 범위가
// 15일을 넘어가면 조용히 빈 배열을 반환하는 것으로 확인됨(에러 없이 0건).
// 그래서 15일보다 긴 범위는 fetchOneStoreRange()가 15일 단위 청크로 쪼개서
// 여러 번 호출한 뒤 합쳐준다. 단일 날짜(오늘자) 조회처럼 원래부터 15일
// 이내인 경우는 기존 fetchOneStore()를 그대로 써도 안전하다.

const TPAY_HOST = 'http://gw-api.tpay.co.kr/';
const FRANCHISE_CODE = 'AF0076';
const BRAND_CODE = 'BOKHD';

// tpay API가 안전하게 응답하는 것으로 확인된 최대 조회 일수(경계값은 15~30일
// 사이 어딘가로만 확인됐고, 정확한 경계까지는 좁히지 않았으므로 보수적으로 15 사용)
const MAX_RANGE_DAYS = 15;

/** KST 기준 yyyyMMdd 문자열 (오늘 또는 offsetDays만큼 이전 날짜) */
function kstDateString(offsetDays = 0) {
  const now = new Date();
  // UTC 기준시각 + 9시간 = KST
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 86400000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** yyyyMMdd 문자열 -> UTC 기준 Date 객체 (달력 계산용, 시각 정보는 무시) */
function parseYmd(s) {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  return new Date(Date.UTC(y, m, d));
}

/** UTC 기준 Date 객체 -> yyyyMMdd 문자열 */
function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** yyyyMMdd 문자열에 days일을 더한 yyyyMMdd 문자열 */
function addDaysYmd(s, days) {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return formatYmd(d);
}

/**
 * [start, end] 범위를 최대 chunkDays일짜리 구간들로 쪼갠다.
 * 예: splitDateRange('20260101', '20260201', 15)
 *  -> [['20260101','20260115'], ['20260116','20260130'], ['20260131','20260201']]
 */
function splitDateRange(start, end, chunkDays = MAX_RANGE_DAYS) {
  const ranges = [];
  const endDate = parseYmd(end);
  let cursorStart = start;

  while (true) {
    const cursorStartDate = parseYmd(cursorStart);
    let cursorEndDate = new Date(cursorStartDate.getTime());
    cursorEndDate.setUTCDate(cursorEndDate.getUTCDate() + (chunkDays - 1));
    if (cursorEndDate.getTime() > endDate.getTime()) cursorEndDate = endDate;

    const cursorEnd = formatYmd(cursorEndDate);
    ranges.push([cursorStart, cursorEnd]);

    if (cursorEnd === end) break;
    cursorStart = addDaysYmd(cursorEnd, 1);
  }

  return ranges;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 단건 매장 조회 + 실패 시 재시도 (3회 + 백오프).
 * 반환: { days: [...] } 또는 { error: '...' }
 * 주의: 이 함수는 범위 제한을 검사하지 않는다. 15일을 넘는 범위는
 * fetchOneStoreRange()를 사용할 것.
 */
async function fetchOneStore(token, code, start, end) {
  const body = JSON.stringify({
    REQ_CODE: '4',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: start,
    SALE_END_DATE: end,
  });

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'Accept-Encoding': 'utf-8',
        },
        body,
      });

      if (res.ok) {
        try {
          const data = await res.json();
          if (data.RESPONSE_CODE === '0000') return { days: data.SALE_INFO || [] };
          lastError = data.RESPONSE_MSG || data.RESPONSE_CODE;
        } catch (e) {
          lastError = 'parse error';
        }
      } else {
        lastError = 'HTTP_' + res.status;
      }
    } catch (e) {
      lastError = 'FETCH_EXCEPTION: ' + e.message;
    }
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  return { error: lastError || 'unknown error' };
}

/**
 * 단건 매장 조회, 단 [start, end]가 MAX_RANGE_DAYS(기본 15일)를 넘으면
 * 자동으로 15일 단위 청크로 쪼개서 여러 번 호출한 뒤 결과를 합쳐준다.
 *
 * 반환:
 *  - 모든 청크 성공: { days: [...] }
 *  - 일부만 성공: { days: [...성공분...], partialError: '실패한 구간 목록' }
 *  - 전부 실패(또는 첫 청크부터 실패): { error: '실패한 구간 목록' }
 */
async function fetchOneStoreRange(token, code, start, end, chunkDays = MAX_RANGE_DAYS) {
  const ranges = splitDateRange(start, end, chunkDays);

  // 원래부터 한 번에 끝나는 범위면 기존 fetchOneStore와 동일하게 동작
  if (ranges.length === 1) {
    return fetchOneStore(token, code, ranges[0][0], ranges[0][1]);
  }

  let allDays = [];
  const errors = [];

  for (let i = 0; i < ranges.length; i++) {
    const [rStart, rEnd] = ranges[i];
    const result = await fetchOneStore(token, code, rStart, rEnd);
    if (result.error) {
      errors.push(`${rStart}~${rEnd}: ${result.error}`);
    } else {
      allDays = allDays.concat(result.days);
    }
    if (i < ranges.length - 1) await sleep(150);
  }

  if (errors.length > 0) {
    if (allDays.length === 0) return { error: errors.join(' | ') };
    return { days: allDays, partialError: errors.join(' | ') };
  }
  return { days: allDays };
}

/**
 * 단건 매장 상품별 정산 조회 (REQ_CODE 5) + 실패 시 재시도(3회+백오프).
 * 반환: { rows: [...] } 또는 { error: '...' }
 */
async function fetchOneStoreProducts(token, code, start, end) {
  const body = JSON.stringify({
    REQ_CODE: '5',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: start,
    SALE_END_DATE: end,
  });

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(TPAY_HOST + 'bridge/common/selectPos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'Accept-Encoding': 'utf-8',
        },
        body,
      });

      if (res.ok) {
        try {
          const data = await res.json();
          if (data.RESPONSE_CODE === '0000') return { rows: data.SALE_INFO || [] };
          lastError = data.RESPONSE_MSG || data.RESPONSE_CODE;
        } catch (e) {
          lastError = 'parse error';
        }
      } else {
        lastError = 'HTTP_' + res.status;
      }
    } catch (e) {
      lastError = 'FETCH_EXCEPTION: ' + e.message;
    }
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  return { error: lastError || 'unknown error' };
}

/**
 * 상품별 정산 조회, [start, end]가 15일을 넘으면 자동으로 청크로 쪼개서 호출.
 */
async function fetchOneStoreProductsRange(token, code, start, end, chunkDays = MAX_RANGE_DAYS) {
  const ranges = splitDateRange(start, end, chunkDays);

  if (ranges.length === 1) {
    return fetchOneStoreProducts(token, code, ranges[0][0], ranges[0][1]);
  }

  let allRows = [];
  const errors = [];

  for (let i = 0; i < ranges.length; i++) {
    const [rStart, rEnd] = ranges[i];
    const result = await fetchOneStoreProducts(token, code, rStart, rEnd);
    if (result.error) {
      errors.push(`${rStart}~${rEnd}: ${result.error}`);
    } else {
      allRows = allRows.concat(result.rows);
    }
    if (i < ranges.length - 1) await sleep(150);
  }

  if (errors.length > 0) {
    if (allRows.length === 0) return { error: errors.join(' | ') };
    return { rows: allRows, partialError: errors.join(' | ') };
  }
  return { rows: allRows };
}

module.exports = {
  TPAY_HOST,
  FRANCHISE_CODE,
  BRAND_CODE,
  MAX_RANGE_DAYS,
  kstDateString,
  parseYmd,
  formatYmd,
  addDaysYmd,
  splitDateRange,
  sleep,
  fetchOneStore,
  fetchOneStoreRange,
  fetchOneStoreProducts,
  fetchOneStoreProductsRange,
};
