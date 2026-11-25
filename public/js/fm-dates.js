/**
 * The customer's calendar day for meal logging.
 * Australia is ahead of UTC, so a UTC date is still yesterday until late morning.
 * The API stores that day on a UTC server. UTC midnight of the local calendar day
 * is still the same local day in Australia (UTC+10 or UTC+11) and sits inside
 * the server's UTC day window.
 */
(function (root) {
  function localDate(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function mealDateIso(ymd) {
    const day = typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : localDate();
    return day + 'T00:00:00.000Z';
  }

  root.fmLocalDate = localDate;
  root.fmMealDateIso = mealDateIso;
}(typeof globalThis !== 'undefined' ? globalThis : this));
