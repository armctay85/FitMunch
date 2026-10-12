/* Accent colours for the share page, the PDF, and the coach builder.
   Text on an accent fill is white or near-black, whichever clears 4.5:1.
   Accent used as text on white is darkened until it clears 4.5:1. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FmAccent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WHITE = '#ffffff';
  var INK = '#07130d';
  var MIN = 4.5;

  function parseHex(value) {
    var match = /^#([0-9a-fA-F]{6})$/.exec(value || '');
    if (!match) return null;
    var n = parseInt(match[1], 16);
    return {
      hex: '#' + match[1].toLowerCase(),
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
    };
  }

  function channel(c) {
    var s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return 0;
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function contrastRatio(a, b) {
    var left = luminance(a);
    var right = luminance(b);
    var lighter = Math.max(left, right);
    var darker = Math.min(left, right);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function hexFromRgb(r, g, b) {
    return '#' + [r, g, b].map(function (part) {
      return Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0');
    }).join('');
  }

  function inkOn(background) {
    var parsed = parseHex(background);
    var color = parsed ? parsed.hex : '#1f9d4a';
    var white = contrastRatio(WHITE, color);
    var ink = contrastRatio(INK, color);
    if (white >= MIN && white >= ink) return WHITE;
    if (ink >= MIN) return INK;
    var black = contrastRatio('#000000', color);
    return black >= white ? '#000000' : WHITE;
  }

  function textOnWhite(accent) {
    var parsed = parseHex(accent);
    if (!parsed) return '#0c1210';
    if (contrastRatio(parsed.hex, WHITE) >= MIN) return parsed.hex;
    var lo = 0;
    var hi = 1;
    var best = '#000000';
    var i;
    for (i = 0; i < 20; i += 1) {
      var t = (lo + hi) / 2;
      var candidate = hexFromRgb(
        Math.round(parsed.r * t),
        Math.round(parsed.g * t),
        Math.round(parsed.b * t)
      );
      if (contrastRatio(candidate, WHITE) >= MIN) {
        best = candidate;
        lo = t;
      } else {
        hi = t;
      }
    }
    var guard = 0;
    while (contrastRatio(best, WHITE) < MIN && guard < 12) {
      var current = parseHex(best);
      best = hexFromRgb(current.r - 1, current.g - 1, current.b - 1);
      guard += 1;
    }
    return best;
  }

  function tones(input) {
    var parsed = parseHex(input);
    var accent = parsed ? parsed.hex : '#1f9d4a';
    return {
      accent: accent,
      ink: inkOn(accent),
      text: textOnWhite(accent),
    };
  }

  return {
    contrastRatio: contrastRatio,
    inkOn: inkOn,
    textOnWhite: textOnWhite,
    tones: tones,
  };
});
