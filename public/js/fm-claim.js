/**
 * Pull a guest claim token out of the URL before analytics or navigation.
 * The token belongs in the fragment. Query copies are stripped too.
 * Nothing here is sent to the server until the person confirms.
 */
(function (root) {
  function takeClaimToken(loc, replaceState) {
    var href = '';
    try {
      href = String((loc && (loc.href || loc)) || '');
    } catch (e) {
      return '';
    }
    var url;
    try {
      url = new URL(href, 'https://www.fitmunch.com.au');
    } catch (e) {
      return '';
    }
    var rawHash = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash;
    var hashParams;
    try {
      hashParams = new URLSearchParams(rawHash);
    } catch (e) {
      return '';
    }
    var fromHash = hashParams.get('claim') || '';
    var fromQuery = url.searchParams.get('claim') || '';
    var claim = fromHash || fromQuery;
    if (!claim) return '';
    url.searchParams.delete('claim');
    var search = url.searchParams.toString();
    var nextHash = rawHash;
    if (fromHash) {
      hashParams.delete('claim');
      nextHash = hashParams.toString();
    }
    var next = url.pathname + (search ? '?' + search : '') + (nextHash ? '#' + nextHash : '');
    if (typeof replaceState === 'function') {
      try { replaceState(next); } catch (e) { /* keep the token in memory anyway */ }
    }
    return claim;
  }

  var api = { takeClaimToken: takeClaimToken };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (!root || !root.document || !root.location || !root.history) return;
  var token = takeClaimToken(root.location, function (next) {
    root.history.replaceState({}, '', next);
  });
  if (token) root.__fmClaimToken = token;
})(typeof window !== 'undefined' ? window : null);
