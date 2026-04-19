/**
 * FitMunch browser API helper — Bearer from localStorage, JSON errors like login.html.
 * Optional; pages can keep inline fetch. Pattern inspired by MentorMate src/lib/api.ts.
 */
(function (w) {
  'use strict';

  w.fmParseApiJson = async function fmParseApiJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const err = new Error('Unexpected server response. Please try again.');
      err.status = response.status;
      throw err;
    }
    const payload = await response.json();
    if (!response.ok) {
      const message =
        payload.error || payload.message || 'Request failed. Please try again.';
      const err = new Error(message);
      err.status = response.status;
      if (payload.code) err.code = payload.code;
      if (payload.upgrade) err.upgrade = true;
      throw err;
    }
    return payload;
  };

  /**
   * @param {string} path - e.g. '/api/auth/me' or '/api/foods/search?q=a'
   * @param {RequestInit} [opts]
   */
  w.fmApiRequest = async function fmApiRequest(path, opts) {
    const token = w.localStorage.getItem('fm_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...((opts && opts.headers) || {}),
    };
    const url = path.startsWith('/') ? path : '/api/' + path;
    const res = await fetch(url, { ...opts, headers });
    return w.fmParseApiJson(res);
  };
})(typeof window !== 'undefined' ? window : globalThis);
