'use strict';

// Daily cron, so the window is a bit wider than one day. A sub that enters
// the window is reminded once per trial_end. The next day's run sees the
// same trial_end and does not send again.
const TRIAL_REMINDER_WINDOW_SEC = 72 * 60 * 60;

function trialEndInReminderWindow(trialEndSec, nowMs = Date.now()) {
  const end = Number(trialEndSec);
  if (!Number.isFinite(end)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  return end > nowSec && end <= nowSec + TRIAL_REMINDER_WINDOW_SEC;
}

function formatTrialEndSydney(trialEndSec) {
  const sec = Number(trialEndSec);
  if (!Number.isFinite(sec)) return '';
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(date);
  const pick = (type) => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : '';
  };
  return [pick('weekday'), pick('day'), pick('month')].filter(Boolean).join(' ');
}

module.exports = {
  TRIAL_REMINDER_WINDOW_SEC,
  trialEndInReminderWindow,
  formatTrialEndSydney,
};
