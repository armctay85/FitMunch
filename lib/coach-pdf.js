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

function glueUnits(value) {
  return String(value || '').replace(/(\d)\s+(g|kg|ml|L|kcal)\b/g, '$1\u00A0$2');
}

function buildCoachPdf({ branding, plan, clientLabel }) {
  plan = sanitizePlan(plan);
  const shopping = plan.shopping || { lines: [], storeName: '' };
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const accent = hexRgb(branding && branding.accent);
  const accentFill = `${accent.r.toFixed(3)} ${accent.g.toFixed(3)} ${accent.b.toFixed(3)}`;
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
    text('F2', 9, left, 828, practice, '1 1 1');
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

  function paragraph(value, size, color) {
    const lines = wrap(glueUnits(value), size >= 14 ? 62 : 92);
    ensure(lines.length * (size + 4));
    for (const line of lines) {
      text('F1', size, left, y, line, color);
      y -= size + 4;
    }
  }

  commands.push(`${accentFill} rg`);
  commands.push('0 786 595 56 re f');
  text('F2', 16, left, 812, practice, '1 1 1');
  text('F1', 10, left, 796, title, '1 1 1');
  if (image) {
    const max = 40;
    const scale = Math.min(max / image.width, max / image.height);
    const w = Math.max(1, image.width * scale);
    const h = Math.max(1, image.height * scale);
    commands.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(540 - w).toFixed(2)} 794 cm /Im1 Do Q`);
  }
  y = 760;
  paragraph(clientLabel ? `Client: ${clientLabel}` : 'Client meal plan', 12);
  y -= 4;
  const targets = plan.targets || {};
  const mealCounts = days.map((day) => (day.meals || []).length);
  const mealLabel = mealCounts.length
    ? (Math.min(...mealCounts) === Math.max(...mealCounts)
      ? String(Math.min(...mealCounts))
      : `${Math.min(...mealCounts)} to ${Math.max(...mealCounts)}`)
    : '';
  const statBits = [
    `${dayCount} days`,
    mealLabel ? `${mealLabel} meals a day` : '',
    `${targets.kcal || 0} kcal`,
    `${targets.protein || 0} g protein`,
  ].filter(Boolean);
  paragraph(statBits.join('   '), 11);
  paragraph(
    `${targets.carbs || 0} g carbs, ${targets.fat || 0} g fat. Household size ${plan.householdSize || 1}.`,
    10,
    muted
  );
  y -= 8;

  for (const day of days) {
    ensure(36);
    text('F2', 13, left, y, plain(day.day, 'Day'));
    if (day.kcal != null) text('F1', 10, 470, y, `${day.kcal} kcal`, muted);
    y -= 16;
    commands.push(`${accentFill} RG`);
    commands.push('0.6 w');
    commands.push(`${left} ${y + 10} m ${right} ${y + 10} l S`);
    y -= 6;
    for (const mealRow of day.meals || []) {
      const ingredients = mealRow.ingredients || [];
      ensure(36 + Math.min(ingredients.length, 3) * 13);
      text('F1', 8, left, y, String(plain(mealRow.slot, 'Meal')).toUpperCase(), accentFill);
      y -= 12;
      text('F2', 11, left, y, plain(mealRow.name, 'Item'));
      y -= 13;
      const macros = macroParts(mealRow);
      if (macros.length) {
        paragraph(macros.join(', '), 9, muted);
      }
      for (const ing of ingredients) {
        paragraph(`- ${ingredientText(ing)}`, 10);
      }
      y -= 6;
    }
    y -= 4;
  }

  const qtyCol = 58;

  function itemBlockHeight(line) {
    const chars = Math.max(12, Math.floor((colW - qtyCol - 8) / 4.6));
    return wrap(lineText(line), chars).length * 12;
  }

  function drawItem(x, top, line) {
    const name = lineText(line);
    const qty = qtyText(line);
    const chars = Math.max(12, Math.floor((colW - qtyCol - 8) / 4.6));
    const lines = wrap(name, chars);
    lines.forEach((row, index) => {
      text('F1', 9, x, top - index * 12, row);
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
    if (groupIndex === 0) keepPx += 22;
    ensure(keepPx);
    if (groupIndex === 0) {
      text('F2', 13, left, y, `${plain(shopping.storeName, 'Store')} draft list`);
      y -= 18;
    }
    text('F2', 10, left, y, group.label, accentFill);
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
    ensure(28);
    text('F2', 13, left, y, `${plain(shopping.storeName, 'Store')} draft list`);
    y -= 18;
  }
  y -= 2;
  paragraph(plan.priceNote, 9, muted);

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
