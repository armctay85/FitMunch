'use strict';

const zlib = require('zlib');
const { decodePng } = require('./coach-png');
const { DIETITIAN_LINE } = require('./coach-plan');
const { sanitizePlan, plain, lineText, qtyText, groupShopping } = require('./sanitize-plan');

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

function buildCoachPdf({ branding, plan, clientLabel }) {
  plan = sanitizePlan(plan);
  const shopping = plan.shopping || { lines: [], storeName: '' };
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const accent = hexRgb(branding && branding.accent);
  const image = logoXObject(branding && branding.logo);
  const pages = [];
  let commands = [];
  let y = 760;

  function newPage() {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = 790;
  }

  function ensure(lines) {
    if (y - lines * 14 < 72) newPage();
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

  function paragraph(value, size) {
    const lines = wrap(value, size >= 14 ? 62 : 88);
    ensure(lines.length);
    for (const line of lines) {
      text('F1', size, 48, y, line);
      y -= size + 4;
    }
  }

  commands.push(`${accent.r.toFixed(3)} ${accent.g.toFixed(3)} ${accent.b.toFixed(3)} rg`);
  commands.push('0 786 595 56 re f');
  text('F2', 16, 48, 812, practice, '1 1 1');
  text('F1', 10, 48, 796, '7-day meal plan', '1 1 1');
  if (image) {
    const max = 40;
    const scale = Math.min(max / image.width, max / image.height);
    const w = Math.max(1, image.width * scale);
    const h = Math.max(1, image.height * scale);
    commands.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(540 - w).toFixed(2)} 794 cm /Im1 Do Q`);
  }
  y = 760;
  paragraph(clientLabel ? `Client: ${clientLabel}` : 'Client meal plan', 12);
  y -= 6;
  const targets = plan.targets || {};
  paragraph(
    `Targets: ${targets.kcal || 0} kcal, ${targets.protein || 0}g protein, ${targets.carbs || 0}g carbs, ${targets.fat || 0}g fat. Household size ${plan.householdSize || 1}.`,
    11
  );
  y -= 8;

  for (const day of plan.days || []) {
    ensure(2);
    text('F2', 12, 48, y, plain(day.day, 'Day'));
    y -= 16;
    for (const mealRow of day.meals || []) {
      paragraph(`${plain(mealRow.slot, 'Meal')}: ${plain(mealRow.name, 'Item')} (${mealRow.kcal == null ? 0 : mealRow.kcal} kcal)`, 11);
    }
    y -= 6;
  }

  ensure(3);
  text('F2', 13, 48, y, `${plain(shopping.storeName, 'Store')} draft list`);
  y -= 18;
  for (const group of groupShopping(shopping.lines)) {
    ensure(2);
    text('F2', 11, 48, y, group.label);
    y -= 16;
    for (const line of group.lines) {
      const qty = qtyText(line);
      paragraph(qty ? `${lineText(line)}   ${qty}` : lineText(line), 10);
    }
    y -= 4;
  }
  y -= 4;
  paragraph(plan.priceNote, 10);

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
      '48 52 m 547 52 l S',
      'BT',
      '/F1 9 Tf',
      '0.35 0.42 0.38 rg',
      '1 0 0 1 48 36 Tm',
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
