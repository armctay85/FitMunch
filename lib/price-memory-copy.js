'use strict';

const FOOTNOTE = 'From your receipts. Shelf prices change. Check at checkout.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function money(cents) {
  const n = Number(cents) || 0;
  return `A$${n < 0 ? '-' : ''}${Math.abs(n / 100).toFixed(2)}`;
}

function dateParts(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function shortDate(iso, now = new Date()) {
  const parts = dateParts(iso);
  if (!parts) return '';
  const month = MONTHS[parts.month - 1];
  if (parts.year === now.getFullYear()) return `${parts.day} ${month}`;
  return `${parts.day} ${month} ${parts.year}`;
}

function sinceLabel(iso, now = new Date()) {
  const parts = dateParts(iso);
  if (!parts) return '';
  const month = MONTHS[parts.month - 1];
  if (parts.year === now.getFullYear()) return month;
  return `${month} ${parts.year}`;
}

function voiceMoney(cents) {
  const abs = Math.abs(Math.round(Number(cents) || 0));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  if (rem === 0) return `${dollars} dollars`;
  return `${dollars} dollars and ${rem} cents`;
}

function voiceDate(iso, now = new Date()) {
  const parts = dateParts(iso);
  if (!parts) return '';
  const month = MONTHS_LONG[parts.month - 1];
  if (parts.year === now.getFullYear()) return `${parts.day} ${month}`;
  return `${parts.day} ${month} ${parts.year}`;
}

function figure(lastPaid) {
  if (lastPaid.showUnitRate && lastPaid.unitRateCents != null) {
    const suffix = lastPaid.unitRateBasis === 'per_kg' ? '/kg' : lastPaid.unitRateBasis === 'per_l' ? '/L' : '';
    return `${money(lastPaid.unitRateCents)}${suffix}`;
  }
  if (lastPaid.packQualifier && lastPaid.packLabel) {
    return `${money(lastPaid.cents)} for ${lastPaid.packLabel}`;
  }
  return money(lastPaid.cents);
}

function lastPaidLine(memo, now = new Date()) {
  const last = memo.lastPaid;
  let line = `Your last paid: ${figure(last)} at ${last.storeName} (${shortDate(last.purchasedOn, now)})`;
  if (memo.ageBand === 'older') line += ' · older than 3 months';
  if (last.promo) line += ' (on special when you bought it)';
  return line;
}

function rangeLine(memo, now = new Date()) {
  if (!memo.range) return '';
  const range = memo.range;
  const noun = range.receipts === 1 ? 'receipt' : 'receipts';
  return `You paid ${money(range.minCents)} to ${money(range.maxCents)} (${range.receipts} ${noun} since ${sinceLabel(range.since, now)})`;
}

function coverageLine(covered, total, cents) {
  return `Your last paid covers ${covered} of ${total} items: ${money(cents)}`;
}

function voiceOver(memo, now = new Date()) {
  const last = memo.lastPaid;
  let amount = voiceMoney(last.showUnitRate && last.unitRateCents != null ? last.unitRateCents : last.cents);
  if (last.showUnitRate && last.unitRateBasis === 'per_kg') amount += ' per kilogram';
  else if (last.showUnitRate && last.unitRateBasis === 'per_l') amount += ' per litre';
  return `You last paid ${amount} at ${last.storeName} on ${voiceDate(last.purchasedOn, now)}`;
}

function formatMemo(memo, now = new Date()) {
  if (!memo || !memo.lastPaid) return { lines: [], footnote: '' };
  const lines = [lastPaidLine(memo, now)];
  const range = rangeLine(memo, now);
  if (range) lines.push(range);
  return { lines, footnote: FOOTNOTE, voiceOver: voiceOver(memo, now) };
}

module.exports = {
  FOOTNOTE,
  money,
  shortDate,
  lastPaidLine,
  rangeLine,
  coverageLine,
  voiceOver,
  formatMemo,
};
