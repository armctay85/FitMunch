'use strict';

const zlib = require('zlib');
const { decodePng } = require('./coach-png');
const { DIETITIAN_LINE, PRICE_NOTE } = require('./coach-plan');
const { artKey } = require('./coach-share-art');
const { groupLines, accentInk } = require('./coach-share');

function pdfText(value) {
  return String(value == null ? '' : value)
    .replace(/\u2013|\u2014/g, ' to ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function hexRgb(accent) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : '#1f9d4a';
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
        components: buf[i + 9],
      };
    }
    i += 2 + len;
  }
  return null;
}

function logoXObject(logo) {
  if (!logo || !logo.buffer) return null;
  try {
    if (logo.mime === 'jpeg') {
      const size = jpegSize(logo.buffer);
      if (!size || (size.components !== 3 && size.components !== 1)) return null;
      return {
        width: size.width,
        height: size.height,
        filter: '/DCTDecode',
        colorSpace: size.components === 1 ? '/DeviceGray' : '/DeviceRGB',
        data: logo.buffer,
      };
    }
    const png = decodePng(logo.buffer);
    return {
      width: png.width,
      height: png.height,
      filter: '/FlateDecode',
      colorSpace: '/DeviceRGB',
      data: zlib.deflateSync(png.rgb),
    };
  } catch (_) {
    return null;
  }
}

function streamObject(dict, data) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
  return Buffer.concat([
    Buffer.from(`${dict}\nstream\n`),
    body,
    Buffer.from('\nendstream'),
  ]);
}

function buildPdfDocument(objectBodies) {
  let body = Buffer.from('%PDF-1.4\n');
  const offsets = [0];
  objectBodies.forEach((obj, index) => {
    offsets.push(body.length);
    const chunk = Buffer.isBuffer(obj) ? obj : Buffer.from(String(obj));
    body = Buffer.concat([
      body,
      Buffer.from(`${index + 1} 0 obj\n`),
      chunk,
      Buffer.from('\nendobj\n'),
    ]);
  });
  const xrefAt = body.length;
  let xref = `xref\n0 ${objectBodies.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objectBodies.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.concat([body, Buffer.from(xref + trailer)]);
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return 'No public special at this store';
  return `$${Number(value).toFixed(2)}`;
}

const INK = '0.047 0.071 0.063';
const MUTE = '0.243 0.318 0.282';
const WHITE = '1 1 1';
const BOTTOM = 64;

const SLOT_INK = {
  Breakfast: '0.541 0.322 0.031',
  Lunch: '0.078 0.420 0.196',
  Dinner: '0.078 0.325 0.176',
  Snack: '0.118 0.310 0.690',
};

const SLOT_BG = {
  Breakfast: '0.973 0.945 0.894',
  Lunch: '0.906 0.953 0.922',
  Dinner: '0.953 0.965 0.953',
  Snack: '0.973 0.965 0.910',
};

function fillRgb(obj) {
  return `${obj.r.toFixed(3)} ${obj.g.toFixed(3)} ${obj.b.toFixed(3)} rg`;
}

function strokeNums(obj) {
  return `${obj.r.toFixed(3)} ${obj.g.toFixed(3)} ${obj.b.toFixed(3)}`;
}

function shareFrac(value, target) {
  const goal = Number(target);
  const current = Number(value);
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(1, current / goal));
}

function buildCoachPdf({ branding, plan, clientLabel }) {
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const accentHex = /^#[0-9a-fA-F]{6}$/.test(branding && branding.accent) ? branding.accent : '#1f9d4a';
  const accent = hexRgb(accentHex);
  const accentFill = fillRgb(accent);
  const accentText = accentInk(accentHex) === '#ffffff' ? WHITE : INK;
  const image = logoXObject(branding && branding.logo);
  const shopping = (plan && plan.shopping) || { lines: [], storeName: 'Store', totalAud: 0 };
  const pages = [];
  let commands = [];
  let y = 730;

  function textAt(font, size, x, yy, value, color) {
    commands.push(
      'BT',
      `${color || INK} rg`,
      `/${font} ${size} Tf`,
      `1 0 0 1 ${Number(x).toFixed(2)} ${Number(yy).toFixed(2)} Tm`,
      `(${pdfText(value)}) Tj`,
      'ET'
    );
  }

  function textWidth(value, size) {
    return String(value || '').length * size * 0.5;
  }

  function textCenter(font, size, cx, yy, value, color) {
    textAt(font, size, cx - textWidth(value, size) / 2, yy, value, color);
  }

  function circlePath(cx, cy, r) {
    const k = 0.5522847498 * r;
    const x = cx;
    const yy = cy;
    return [
      `${(x + r).toFixed(2)} ${yy.toFixed(2)} m`,
      `${(x + r).toFixed(2)} ${(yy + k).toFixed(2)} ${(x + k).toFixed(2)} ${(yy + r).toFixed(2)} ${x.toFixed(2)} ${(yy + r).toFixed(2)} c`,
      `${(x - k).toFixed(2)} ${(yy + r).toFixed(2)} ${(x - r).toFixed(2)} ${(yy + k).toFixed(2)} ${(x - r).toFixed(2)} ${yy.toFixed(2)} c`,
      `${(x - r).toFixed(2)} ${(yy - k).toFixed(2)} ${(x - k).toFixed(2)} ${(yy - r).toFixed(2)} ${x.toFixed(2)} ${(yy - r).toFixed(2)} c`,
      `${(x + k).toFixed(2)} ${(yy - r).toFixed(2)} ${(x + r).toFixed(2)} ${(yy - k).toFixed(2)} ${(x + r).toFixed(2)} ${yy.toFixed(2)} c`,
    ].join('\n');
  }

  function arcCmds(cx, cy, r, startDeg, endDeg) {
    let a0 = startDeg;
    let a1 = endDeg;
    while (a1 <= a0) a1 += 360;
    const parts = [];
    let cursor = a0;
    let moved = false;
    while (cursor < a1 - 0.05) {
      const next = Math.min(cursor + 80, a1);
      const d0 = (cursor * Math.PI) / 180;
      const d1 = (next * Math.PI) / 180;
      const delta = d1 - d0;
      const alpha = (Math.sin(delta) * (Math.sqrt(4 + 3 * Math.tan(delta / 2) ** 2) - 1)) / 3;
      const p0 = [cx + r * Math.cos(d0), cy + r * Math.sin(d0)];
      const p3 = [cx + r * Math.cos(d1), cy + r * Math.sin(d1)];
      const p1 = [p0[0] - alpha * r * Math.sin(d0), p0[1] + alpha * r * Math.cos(d0)];
      const p2 = [p3[0] + alpha * r * Math.sin(d1), p3[1] - alpha * r * Math.cos(d1)];
      if (!moved) {
        parts.push(`${p0[0].toFixed(2)} ${p0[1].toFixed(2)} m`);
        moved = true;
      }
      parts.push(`${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} ${p3[0].toFixed(2)} ${p3[1].toFixed(2)} c`);
      cursor = next;
    }
    return parts.join('\n');
  }

  function blob(cx, cy, rx, ry, color) {
    commands.push('q');
    commands.push(`${color} rg`);
    commands.push(`${rx.toFixed(2)} 0 0 ${ry.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} cm`);
    commands.push(circlePath(0, 0, 1));
    commands.push('f');
    commands.push('Q');
  }

  function motif(kind, x, yy, scale) {
    const s = scale || 1;
    commands.push('q');
    commands.push(`${s.toFixed(2)} 0 0 ${s.toFixed(2)} ${x.toFixed(2)} ${yy.toFixed(2)} cm`);
    if (kind === 'eggs' || kind === 'eggs-toast') {
      blob(7, 8, 4, 5.2, '1 0.995 0.97');
      blob(15, 8, 4, 5.2, '0.98 0.96 0.92');
      blob(7, 8, 1.6, 1.6, '0.941 0.706 0.161');
      blob(15, 8, 1.5, 1.5, '0.878 0.604 0.106');
    } else if (kind === 'banana' || kind === 'banana-pb') {
      blob(11, 8, 8, 3, '0.949 0.820 0.353');
      if (kind === 'banana-pb') blob(16, 9, 3, 2.2, '0.769 0.541 0.227');
    } else if (kind === 'salmon') {
      blob(11, 8, 8, 3.6, '0.878 0.478 0.373');
      blob(4, 12, 2.2, 1.5, '0.184 0.561 0.306');
    } else if (kind === 'tuna') {
      blob(8, 8, 5, 3.4, '0.835 0.867 0.886');
      blob(16, 8, 3.5, 2.4, '0.965 0.945 0.900');
    } else if (kind === 'pasta' || kind === 'mince') {
      blob(11, 8, 7, 3.6, '0.965 0.945 0.900');
      blob(8, 9, 3, 2, kind === 'pasta' ? '0.941 0.831 0.541' : '0.635 0.294 0.227');
      blob(15, 8, 2, 2, '0.839 0.325 0.235');
    } else if (kind === 'chicken' || kind === 'tray' || kind === 'stir') {
      blob(10, 8, 7, 3.6, '0.906 0.780 0.631');
      blob(4, 12, 2.3, 2.3, '0.184 0.561 0.306');
      blob(17, 11, 2, 2, '0.243 0.561 0.333');
    } else if (kind === 'tub' || kind === 'cheese-cuke') {
      blob(11, 8, 6, 4.5, '0.949 0.757 0.306');
    } else if (kind === 'yoghurt' || kind === 'oats' || kind === 'peanut-oats') {
      blob(11, 7, 8, 3.2, '1 1 1');
      blob(11, 10, 6, 2, '0.965 0.945 0.900');
      blob(7, 11, 1.7, 1.7, '0.557 0.227 0.333');
      blob(13, 12, 1.4, 1.4, '0.769 0.357 0.471');
    } else {
      blob(11, 8, 7, 3.6, '0.910 0.953 0.922');
      blob(7, 9, 2, 2, '0.184 0.561 0.306');
      blob(15, 8, 1.8, 1.8, '0.878 0.541 0.235');
    }
    commands.push('Q');
  }

  function macroBar(x, yy, w, day) {
    const p = (Number(day.protein) || 0) * 4;
    const c = (Number(day.carbs) || 0) * 4;
    const f = (Number(day.fat) || 0) * 9;
    const total = p + c + f || 1;
    let cursor = x;
    [
      [p, '0.122 0.616 0.290'],
      [c, '0.769 0.478 0.071'],
      [f, '0.184 0.435 0.929'],
    ].forEach(([val, col]) => {
      const sw = (w * val) / total;
      commands.push(`${col} rg`);
      commands.push(`${cursor.toFixed(2)} ${yy.toFixed(2)} ${Math.max(sw, 0).toFixed(2)} 3 re f`);
      cursor += sw;
    });
  }

  function ring(cx, cy, r, frac, stroke) {
    commands.push('1.8 w');
    commands.push('1 J');
    commands.push('0.843 0.886 0.859 RG');
    commands.push(circlePath(cx, cy, r));
    commands.push('S');
    if (frac > 0.01) {
      const start = 90 - Math.min(frac, 0.999) * 360;
      commands.push(`${stroke} RG`);
      commands.push(arcCmds(cx, cy, r, start, 90));
      commands.push('S');
    }
    commands.push('1 w');
    commands.push('0 J');
  }

  function newPage() {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    commands.push(fillRgb(hexRgb('#07130d')));
    commands.push('0 816 595 26 re f');
    commands.push(accentFill);
    commands.push('0 838 595 4 re f');
    textAt('F2', 9, 28, 824, practice, WHITE);
    y = 800;
  }

  function ensure(height) {
    if (y - height < BOTTOM) newPage();
  }

  function drawCover() {
    commands.push(fillRgb(hexRgb('#07130d')));
    commands.push('0 752 595 90 re f');
    commands.push(accentFill);
    commands.push('0 836 595 6 re f');
    textAt('F2', 8, 28, 824, 'FITMUNCH', '0.718 0.886 0.769');
    textAt('F1', 8, 28, 806, 'TRAINER', '0.718 0.886 0.769');
    const nameLines = wrap(practice, 32).slice(0, 2);
    textAt('F2', 16, 28, 788, nameLines[0], WHITE);
    if (nameLines[1]) textAt('F2', 16, 28, 770, nameLines[1], WHITE);
    else textAt('F1', 10, 28, 768, '7-day meal plan', WHITE);
    if (image) {
      const max = 42;
      const scale = Math.min(max / image.width, max / image.height);
      const w = Math.max(1, image.width * scale);
      const h = Math.max(1, image.height * scale);
      commands.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(552 - w).toFixed(2)} 774 cm /Im1 Do Q`);
    }
    y = 732;
  }

  function drawRings() {
    const targets = plan.targets || {};
    const averages = plan.draftAverages || {};
    const items = [
      ['kcal', averages.kcal, targets.kcal, strokeNums(accent)],
      ['Protein', averages.protein, targets.protein, '0.122 0.616 0.290'],
      ['Carbs', averages.carbs, targets.carbs, '0.769 0.478 0.071'],
      ['Fat', averages.fat, targets.fat, '0.184 0.435 0.929'],
    ];
    ensure(86);
    const cy = y - 40;
    commands.push('1 1 1 rg');
    commands.push(`28 ${(cy - 34).toFixed(2)} 539 70 re f`);
    commands.push('0.812 0.851 0.824 RG');
    commands.push('0.6 w');
    commands.push(`28 ${(cy - 34).toFixed(2)} 539 70 re S`);
    commands.push('1 w');
    items.forEach((item, index) => {
      const cx = 62 + index * 134;
      const value = item[1] == null ? 0 : item[1];
      ring(cx, cy, 16, shareFrac(item[1], item[2]), item[3]);
      textCenter('F2', 8, cx, cy - 3, String(value), INK);
      textCenter('F1', 7, cx, cy - 28, item[0], MUTE);
    });
    y = cy - 46;
  }

  function drawCard(day, x, top, w, h) {
    const bottom = top - h;
    const meals = day.meals || [];
    commands.push('1 1 1 rg');
    commands.push(`${x.toFixed(2)} ${bottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    commands.push('0.812 0.851 0.824 RG');
    commands.push('0.7 w');
    commands.push(`${x.toFixed(2)} ${bottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    commands.push('1 w');
    textAt('F2', 10, x + 8, top - 14, day.day || '', INK);
    const dayKcal = `${day.kcal || 0} kcal`;
    textAt('F1', 8, x + w - 8 - textWidth(dayKcal, 8), top - 13, dayKcal, MUTE);
    macroBar(x + 8, top - 20, w - 16, day);
    meals.forEach((meal, index) => {
      const row = top - 34 - index * 16;
      commands.push(`${SLOT_BG[meal.slot] || '0.953 0.965 0.953'} rg`);
      commands.push(`${(x + 6).toFixed(2)} ${(row - 12).toFixed(2)} ${(w - 12).toFixed(2)} 15 re f`);
      motif(artKey(meal.name, meal.slot), x + 8, row - 11, 0.58);
      const kcal = `${meal.kcal || 0} kcal`;
      const kcalW = textWidth(kcal, 7);
      const nameMax = w - 46 - kcalW;
      let size = 8;
      let name = meal.name || '';
      if (textWidth(name, size) > nameMax) size = 7;
      if (textWidth(name, size) > nameMax) {
        while (name.length > 1 && textWidth(`${name}...`, size) > nameMax) name = name.slice(0, -1);
        name = `${name}...`;
      }
      textAt('F1', size, x + 26, row - 8, name, INK);
      textAt('F1', 7, x + w - 10 - kcalW, row - 8, kcal, MUTE);
    });
  }

  function drawWeek(days) {
    const list = days || [];
    const colGap = 10;
    const colW = (539 - colGap) / 2;
    const mealsN = Math.max(1, ...list.map((day) => (day.meals || []).length), 0);
    const cardH = 28 + mealsN * 16;
    ensure(22);
    textAt('F2', 8, 28, y, 'THE WEEK', MUTE);
    y -= 14;
    for (let index = 0; index < list.length; index += 2) {
      ensure(cardH + 8);
      drawCard(list[index], 28, y, colW, cardH);
      if (list[index + 1]) drawCard(list[index + 1], 28 + colW + colGap, y, colW, cardH);
      y -= cardH + 8;
    }
  }

  function drawBadges() {
    ensure(46);
    const names = [
      ['woolworths', 'Woolworths'],
      ['coles', 'Coles'],
      ['aldi', 'Aldi'],
    ];
    const bw = 100;
    const gap = 8;
    const x0 = (595 - (bw * 3 + gap * 2)) / 2;
    names.forEach(([id, name], index) => {
      const x = x0 + index * (bw + gap);
      const on = id === shopping.storeId;
      commands.push(on ? accentFill : '0.933 0.949 0.933 rg');
      commands.push(`${x.toFixed(2)} ${(y - 16).toFixed(2)} ${bw} 16 re f`);
      textCenter('F2', 8, x + bw / 2, y - 12, name, on ? accentText : INK);
    });
    y -= 28;
    textAt('F1', 8, 28, y, 'from public specials, draft', MUTE);
    y -= 16;
  }

  function drawShopping() {
    ensure(32);
    const storeName = shopping.storeName || 'Store';
    textAt('F2', 12, 28, y, `${storeName} draft list`, INK);
    y -= 16;
    groupLines(shopping.lines).forEach((group) => {
      ensure(26);
      commands.push('0.933 0.949 0.933 rg');
      commands.push(`28 ${(y - 4).toFixed(2)} 539 14 re f`);
      textAt('F2', 8, 34, y, String(group.aisle || 'Other').toUpperCase(), MUTE);
      y -= 16;
      group.lines.forEach((line) => {
        const price = line.priced ? money(line.lineAud) : 'No public special at this store';
        const parts = wrap(`${line.packs} x ${line.name}`, line.priced ? 62 : 88);
        ensure(12 * (parts.length + (line.priced ? 0 : 1)));
        textAt('F1', 9, 28, y, parts[0], INK);
        if (line.priced) textAt('F1', 9, 567 - textWidth(price, 9), y, price, INK);
        y -= 12;
        parts.slice(1, 2).forEach((extra) => {
          textAt('F1', 9, 28, y, extra, INK);
          y -= 12;
        });
        if (!line.priced) {
          textAt('F1', 9, 28, y, price, MUTE);
          y -= 12;
        }
      });
      y -= 3;
    });
    ensure(36);
    y -= 4;
    textAt('F2', 12, 28, y, `${storeName} total ${money(shopping.totalAud)}`, INK);
    y -= 16;
    textAt('F1', 9, 28, y, plan.priceNote || PRICE_NOTE, MUTE);
    y -= 13;
    if (shopping.unpricedCount) {
      ensure(14);
      textAt('F1', 9, 28, y, `${shopping.unpricedCount} items have no public special at this store.`, MUTE);
    }
  }

  drawCover();
  textAt('F2', 11, 28, y, clientLabel || 'Client', INK);
  y -= 14;
  wrap(
    `Targets: ${(plan.targets || {}).kcal || 0} kcal, ${(plan.targets || {}).protein || 0}g protein, ${(plan.targets || {}).carbs || 0}g carbs, ${(plan.targets || {}).fat || 0}g fat. Household size ${plan.householdSize || 1}.`,
    92
  ).forEach((line) => {
    textAt('F1', 9, 28, y, line, MUTE);
    y -= 12;
  });
  y -= 6;
  drawRings();
  y -= 4;
  drawWeek(plan.days || []);
  drawBadges();
  drawShopping();

  if (commands.length) pages.push(commands.join('\n'));

  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const font1 = 3;
  const font2 = 4;
  const imageObj = image ? 5 : null;
  const firstPage = image ? 6 : 5;
  const kids = pages.map((_, index) => `${firstPage + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  if (image) {
    objects.push(streamObject(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace} /BitsPerComponent 8 /Filter ${image.filter} /Length ${image.data.length} >>`,
      image.data
    ));
  }

  pages.forEach((content, index) => {
    const contentsId = firstPage + index * 2 + 1;
    const xobject = imageObj ? ` /XObject << /Im1 ${imageObj} 0 R >>` : '';
    const footer = [
      '0.35 0.42 0.38 rg',
      '28 52 m 567 52 l S',
      'BT',
      '/F1 9 Tf',
      '0.35 0.42 0.38 rg',
      '1 0 0 1 28 36 Tm',
      `(${pdfText(DIETITIAN_LINE)}) Tj`,
      'ET',
    ].join('\n');
    const stream = `${content}\n${footer}`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >>${xobject} >> /Contents ${contentsId} 0 R >>`
    );
    objects.push(streamObject(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>`, stream));
  });

  return buildPdfDocument(objects);
}

module.exports = { buildCoachPdf, logoXObject };
