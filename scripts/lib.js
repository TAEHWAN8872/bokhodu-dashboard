// scripts/lib.js
// tpay API 공통 함수 모음. Apps Script 버전의 fetchOneStore_/callTpay_ 로직을 그대로 이식.

const TPAY_HOST = 'http://gw-api.tpay.co.kr/';
const FRANCHISE_CODE = 'AF0076';
const BRAND_CODE = 'BOKHD';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 단건 매장 조회 + 실패 시 재시도 (3회 + 백오프).
 * 반환: { days: [...] } 또는 { error: '...' }
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

module.exports = { TPAY_HOST, FRANCHISE_CODE, BRAND_CODE, kstDateString, sleep, fetchOneStore };
