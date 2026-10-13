/* Display casing for receipt item names. Receipts print in capitals, and the
   scan sometimes passes that through. Names that already have lower case
   letters are left exactly as they are. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FMItemName = api;
}(typeof self !== 'undefined' ? self : this, function () {
  var ACRONYMS = {
    UHT: 1, BBQ: 1, A2: 1, MSA: 1, RSPCA: 1, NZ: 1, AUS: 1, USA: 1, UK: 1,
    XL: 1, XXL: 1, MCT: 1, BCAA: 1, WPI: 1, WPC: 1, GF: 1, DF: 1, LSA: 1,
    PB: 1, OJ: 1, EVOO: 1, PET: 1, UV: 1, '2L': 1,
  };
  var UNITS = { KG: 'kg', G: 'g', GM: 'g', GMS: 'g', MG: 'mg', ML: 'ml', L: 'L', LT: 'L', LTR: 'L', PK: 'pk', EA: 'ea', X: 'x' };
  var SMALL = { AND: 1, OR: 1, OF: 1, WITH: 1, IN: 1, ON: 1, THE: 1, A: 1, '&': 1 };

  function titleWord(w) {
    return w.split(/([-'\u2019\/])/).map(function (part, i, arr) {
      if (/^[-'\u2019\/]$/.test(part)) return part;
      // Possessive or contraction tail after an apostrophe stays lower case.
      if (i > 0 && /['\u2019]/.test(arr[i - 1]) && part.length <= 2) return part.toLowerCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('');
  }

  function fixToken(token, isFirst) {
    var m = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    var lead = m[1], core = m[2], tail = m[3];
    if (!core) return token;
    var up = core.toUpperCase();
    var out;
    var qty = up.match(/^(\d+(?:[.,]\d+)?)(KG|GMS|GM|G|MG|ML|LTR|LT|L|PK|EA|X)$/);
    if (ACRONYMS[up]) out = core;
    else if (qty) out = qty[1] + UNITS[qty[2]];
    else if (UNITS[up] && up !== 'X' && !isFirst) out = UNITS[up];
    else if (/\d/.test(core)) out = core; // codes like A2, 3X, 12X375
    else if (SMALL[up] && !isFirst) out = core.toLowerCase();
    else out = titleWord(core);
    return lead + out + tail;
  }

  function displayName(name) {
    if (typeof name !== 'string') return name;
    if (/[a-z]/.test(name) || !/[A-Z]/.test(name)) return name;
    var first = true;
    return name.split(/(\s+)/).map(function (tok) {
      if (!tok || /^\s+$/.test(tok)) return tok;
      var r = fixToken(tok, first);
      first = false;
      return r;
    }).join('');
  }

  return { displayName: displayName };
}));
