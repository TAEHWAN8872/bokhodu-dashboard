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

// REQ_CODE 3(매출정보 마스터, 주문 건별 원본)을 합산할 때 쓰는 금액/인원 필드.
// REQ_CODE 4(일정산매출, 정산 확정값)의 필드명과 1:1 동일 — debug-realtime-compare.js로
// 확정값과 합산값이 완전히 일치함을 검증 완료(2026-08-13).
const REALTIME_SUM_FIELDS = [
  'SA_AMOUNT', 'SA_DEL_AMT', 'SA_DC_AMT', 'SA_AMT_TTL', 'SA_ADD_AMT',
  'SA_GET_AMT', 'SA_RL_AMT', 'SA_VAT_AMT', 'SA_TF_AMT', 'SA_CASH_AMT',
  'SA_CARD_AMT', 'SA_CPN_AMT', 'SA_ON_AMT', 'SA_RCV_AMT', 'SA_LC_AMT',
  'SA_RSV_AMT', 'SA_PREPAID_AMT', 'SA_CASH_BILL_AMT', 'SA_CXL_AMT',
  'SA_GUEST_M', 'SA_GUEST_F',
];

/**
 * 매출정보 마스터(REQ_CODE 3) 주문 건별 원본을 SDA_DT(영업일) 기준으로 합산해서
 * 일정산매출(REQ_CODE 4)과 동일한 모양의 day 객체 배열로 변환한다.
 * 각 day 객체에는 STR_NO/STR_NM/BRD_CD/FRC_CD와 REALTIME_SUM_FIELDS 합계가 들어간다.
 */
function aggregateOrdersToDays(orders) {
  const byDay = {};
  for (const o of orders) {
    const day = o.SDA_DT;
    if (!byDay[day]) {
      byDay[day] = {
        SDA_DT: day,
        STR_NO: o.STR_NO,
        STR_NM: o.STR_NM,
        BRD_CD: o.BRD_CD,
        FRC_CD: o.FRC_CD,
      };
      for (const f of REALTIME_SUM_FIELDS) byDay[day][f] = 0;
    }
    for (const f of REALTIME_SUM_FIELDS) {
      byDay[day][f] += Number(o[f] || 0);
    }
  }
  return Object.values(byDay);
}

/**
 * 매출정보 마스터(REQ_CODE 3)로 단일 날짜를 조회해서 합산한 실시간 매출을 반환.
 * "오늘"처럼 아직 정산(REQ_CODE 4)이 안 끝난 날짜의 실시간 값을 보려 할 때 사용.
 * 반환: { days: [...] } (주문이 0건이면 금액 0으로 채워진 day 1개) 또는 { error: '...' }
 * 주의: fetchOneStore와 달리 REQ_CODE 3은 날짜 범위 제한을 확인하지 않았으므로
 * 반드시 단일 날짜(start === end, 오늘자)로만 호출할 것.
 */
async function fetchOneStoreRealtime(token, code, date) {
  const body = JSON.stringify({
    REQ_CODE: '3',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
    SALE_START_DATE: date,
    SALE_END_DATE: date,
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
          if (data.RESPONSE_CODE === '0000') {
            const orders = data.SALE_INFO || [];
            const days = aggregateOrdersToDays(orders);
            // 주문이 0건이면 그날짜 항목 자체가 안 나오므로, 0원 상태를 명시적으로 채워서 반환
            if (days.length === 0) {
              const zero = { SDA_DT: date, STR_NO: code };
              for (const f of REALTIME_SUM_FIELDS) zero[f] = 0;
              days.push(zero);
            }
            return { days };
          }
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

/**
 * 상품정보(상품 마스터) 조회 (REQ_CODE 2) + 실패 시 재시도(3회+백오프).
 * 날짜 범위가 필요 없는 조회로 확인됨(SALE_START_DATE/SALE_END_DATE 없이도 동일 응답).
 * 반환: { products: [...] } 또는 { error: '...' }
 * 각 항목은 { CMDTG_CD, CMDTG_NM, CMDT_CD, CMDT_NM, CMDT_DEL_MK, ... } 형태로 확인됨.
 */
async function fetchProductCategories(token, code) {
  const body = JSON.stringify({
    REQ_CODE: '2',
    FRANCHISE_CODE,
    BRAND_CODE,
    SHOP_NO: code,
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
          if (data.RESPONSE_CODE === '0000') {
            return { products: data.ITEM_INFO || [] };
          }
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
 * fetchProductCategories 결과를 { [상품명]: 분류명 } 매핑 객체로 변환.
 * 같은 상품명이 여러 매장/여러 건 나와도 마지막 값으로 덮어써 정리됨.
 * CMDT_DEL_MK(사용여부, Y:사용/N:중지)가 'N'인 상품은 매핑에서 제외한다.
 * (스펙문서 확인 완료 — POS_매출연동규격서 '2.상품정보조회' 응답 항목)
 */
function buildProductCategoryMap(products) {
  const map = {};
  for (const p of products) {
    if (p.CMDT_DEL_MK === 'N') continue; // 중지된 상품은 제외
    const name = p.CMDT_NM;
    const category = p.CMDTG_NM;
    if (name && category) map[name] = category;
  }
  return map;
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
  fetchOneStoreRealtime,
  fetchOneStoreProducts,
  fetchOneStoreProductsRange,
  fetchProductCategories,
  buildProductCategoryMap,
};
