'use strict';

const zlib = require('zlib');
const { decodePng } = require('./coach-png');
const { DIETITIAN_LINE } = require('./coach-plan');
const {
  sanitizePlan,
  plain,
  lineText,
  qtyText,
  ingredientText,
  macroParts,
  groupShopping,
} = require('./sanitize-plan');
const { tones } = require('../public/js/fm-accent');

function pdfText(value) {
  return String(value == null ? '' : value)
    .replace(/\u00A0/g, ' ')
    .replace(/\u2013|\u2014/g, ' to ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const words = String(text || '').split(/[ \t]+/).filter(Boolean);
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

function rgbFill(hex) {
  const n = parseInt(String(hex || '').slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
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

function glueUnits(value) {
  return String(value || '').replace(/(\d)\s+(g|kg|ml|L|kcal)\b/g, '$1\u00A0$2');
}

function buildCoachPdf({ branding, plan, clientLabel }) {
  plan = sanitizePlan(plan);
  const shopping = plan.shopping || { lines: [], storeName: '' };
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const tone = tones(branding && branding.accent);
  const accentFill = rgbFill(tone.accent);
  const inkFill = rgbFill(tone.ink);
  const textFill = rgbFill(tone.text);
  const image = logoXObject(branding && branding.logo);
  const days = plan.days || [];
  const dayCount = days.length;
  const title = dayCount === 1 ? '1-day meal plan' : `${dayCount || 7}-day meal plan`;
  const pages = [];
  let commands = [];
  let y = 760;
  const left = 48;
  const right = 547;
  const colGap = 16;
  const colW = (right - left - colGap) / 2;
  const muted = '0.42 0.48 0.45';

  function newPage() {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = 790;
    commands.push(`${accentFill} rg`);
    commands.push('0 820 595 22 re f');
    text('F2', 9, left, 828, practice, inkFill);
  }

  function ensure(px) {
    if (y - px < 72) newPage();
  }

  function text(font, size, x, yy, value, color) {
    const tint = color || '0 0 0';
    commands.push(
      'BT',
      `${tint} rg`,
      `/${font} ${size} Tf`,
      `1 0 0 1 ${x} ${yy} Tm`,
      `(${pdfText(value)}) Tj`,
      'ET'
    );
  }

  const contentW = right - left;

  function measureChars(size, width) {
    return Math.max(20, Math.floor(width / (size * 0.5)));
  }

  function paragraph(value, size, color) {
    const lines = wrap(glueUnits(value), measureChars(size, contentW));
    ensure(lines.length * (size + 4));
    for (const line of lines) {
      text('F1', size, left, y, line, color);
      y -= size + 4;
    }
  }

  function rule(yLine, color) {
    commands.push(`${color || '0.82 0.86 0.83'} RG`);
    commands.push('0.6 w');
    commands.push(`${left} ${yLine} m ${right} ${yLine} l S`);
  }

  function filledDot(cx, cy, r) {
    const k = r * 0.5522847498;
    const n = (v) => v.toFixed(2);
    commands.push('0.12 0.16 0.14 rg');
    commands.push(`${n(cx + r)} ${n(cy)} m`);
    commands.push(`${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`);
    commands.push(`${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`);
    commands.push(`${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`);
    commands.push(`${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`);
    commands.push('f');
  }

  function bullet(value, size) {
    const lines = wrap(glueUnits(value), measureChars(size, contentW - 16));
    ensure(lines.length * (size + 3));
    lines.forEach((line, index) => {
      if (index === 0) filledDot(left + 3.2, y + 2.4, 1.55);
      text('F1', size, left + 14, y, line);
      y -= size + 3;
    });
  }

  function spread(parts, size, color) {
    if (!parts.length) return;
    const slice = contentW / parts.length;
    parts.forEach((part, index) => {
      text('F1', size, left + index * slice, y, part, color);
    });
    y -= size + 4;
  }

  function statRow(items) {
    const gap = 6;
    const h = 36;
    const w = (contentW - gap * (items.length - 1)) / items.length;
    const top = y;
    items.forEach((item, index) => {
      const x = left + index * (w + gap);
      commands.push('0.945 0.957 0.949 rg');
      commands.push(`${x.toFixed(2)} ${(top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
      text('F2', 11, x + 6, top - 15, item.value);
      text('F1', 7, x + 6, top - 28, item.label, muted);
    });
    y = top - h - 12;
  }

  commands.push(`${accentFill} rg`);
  commands.push('0 786 595 56 re f');
  text('F2', 16, left, 812, practice, inkFill);
  text('F1', 10, left, 796, title, inkFill);
  if (image) {
    const max = 40;
    const scale = Math.min(max / image.width, max / image.height);
    const w = Math.max(1, image.width * scale);
    const h = Math.max(1, image.height * scale);
    commands.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(540 - w).toFixed(2)} 794 cm /Im1 Do Q`);
  }
  y = 752;
  const targets = plan.targets || {};
  statRow([
    { value: String(targets.kcal || 0), label: 'kcal' },
    { value: String(targets.protein || 0), label: 'protein' },
    { value: String(targets.carbs || 0), label: 'carbs' },
    { value: String(targets.fat || 0), label: 'fat' },
    { value: String(dayCount), label: 'days' },
  ]);
  paragraph(clientLabel ? `Client: ${clientLabel}` : 'Client meal plan', 12);
  y -= 8;

  for (const day of days) {
    ensure(36);
    text('F2', 13, left, y, plain(day.day, 'Day'));
    if (day.kcal != null) text('F1', 10, 470, y, `${day.kcal} kcal`, muted);
    y -= 14;
    rule(y + 8, textFill);
    y -= 8;
    for (const mealRow of day.meals || []) {
      const ingredients = mealRow.ingredients || [];
      const macros = macroParts(mealRow);
      ensure(40 + ingredients.length * 14);
      text('F1', 8, left, y, String(plain(mealRow.slot, 'Meal')).toUpperCase(), textFill);
      y -= 13;
      const nameLines = wrap(plain(mealRow.name, 'Item'), measureChars(12, contentW));
      nameLines.forEach((line) => {
        text('F2', 12, left, y, line);
        y -= 15;
      });
      if (macros.length) spread(macros, 9, muted);
      rule(y + 6);
      y -= 8;
      for (const ing of ingredients) bullet(ingredientText(ing), 10);
      y -= 6;
    }
    y -= 4;
  }

  const qtyCol = 58;

  const tick = 11;

  function itemChars() {
    return Math.max(12, Math.floor((colW - qtyCol - tick - 4) / 4.6));
  }

  function itemBlockHeight(line) {
    return wrap(lineText(line), itemChars()).length * 12;
  }

  function drawTick(x, baseline) {
    const s = 8;
    const by = baseline - 1.5;
    commands.push('0.12 0.16 0.14 RG');
    commands.push('0.9 w');
    commands.push(`${x.toFixed(2)} ${by.toFixed(2)} ${s} ${s} re S`);
  }

  function drawItem(x, top, line) {
    const name = lineText(line);
    const qty = qtyText(line);
    const lines = wrap(name, itemChars());
    drawTick(x, top);
    lines.forEach((row, index) => {
      text('F1', 9, x + tick, top - index * 12, row);
    });
    if (qty) text('F1', 8, x + colW - qtyCol, top, qty, muted);
    return lines.length * 12;
  }

  const shopGroups = groupShopping(shopping.lines);
  shopGroups.forEach((group, groupIndex) => {
    const rows = [];
    for (let i = 0; i < group.lines.length; i += 2) {
      rows.push(group.lines.slice(i, i + 2));
    }
    const keepRows = Math.min(3, rows.length);
    let keepPx = 16;
    for (let i = 0; i < keepRows; i += 1) {
      keepPx += Math.max(itemBlockHeight(rows[i][0]), rows[i][1] ? itemBlockHeight(rows[i][1]) : 0) + 4;
    }
    if (groupIndex === 0) keepPx += 40;
    ensure(keepPx);
    if (groupIndex === 0) {
      text('F2', 13, left, y, `${plain(shopping.storeName, 'Store')} draft list`);
      y -= 14;
      text('F1', 9, left, y, plan.priceNote, muted);
      y -= 16;
    }
    text('F2', 10, left, y, group.label, textFill);
    commands.push('0.82 0.86 0.83 RG');
    commands.push('0.6 w');
    commands.push(`${left} ${y - 4} m ${right} ${y - 4} l S`);
    y -= 16;
    for (const pair of rows) {
      const height = Math.max(itemBlockHeight(pair[0]), pair[1] ? itemBlockHeight(pair[1]) : 0);
      if (y - height < 72) newPage();
      drawItem(left, y, pair[0]);
      if (pair[1]) drawItem(left + colW + colGap, y, pair[1]);
      y -= height + 4;
    }
    y -= 6;
  });
  if (!shopGroups.length) {
    ensure(40);
    text('F2', 13, left, y, `${plain(shopping.storeName, 'Store')} draft list`);
    y -= 14;
    text('F1', 9, left, y, plan.priceNote, muted);
    y -= 14;
  }

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
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    const footer = [
      '0.35 0.42 0.38 rg',
      '48 52 m 547 52 l S',
      'BT',
      '/F1 9 Tf',
      '0.35 0.42 0.38 rg',
      '1 0 0 1 48 36 Tm',
      `(${pdfText(DIETITIAN_LINE)}) Tj`,
      'ET',
      'BT',
      '/F1 9 Tf',
      '0.35 0.42 0.38 rg',
      '1 0 0 1 470 36 Tm',
      `(${pdfText(pageLabel)}) Tj`,
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
