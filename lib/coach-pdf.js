'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decodePng } = require('./coach-png');
const { PRICE_NOTE } = require('./coach-plan');
const { groupLines, accentInk, firstName, weekOfLabel, initials } = require('./coach-share');

function pdfText(value) {
  return String(value == null ? '' : value)
    .replace(/\u2013|\u2014/g, ' to ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
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

function jpegXObject(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const size = jpegSize(data);
    if (!size || size.components !== 3) return null;
    return {
      width: size.width,
      height: size.height,
      filter: '/DCTDecode',
      colorSpace: '/DeviceRGB',
      data,
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
  if (value == null || Number.isNaN(Number(value))) return 'Check at checkout';
  return `$${Number(value).toFixed(2)}`;
}

function buildCoachPdf({ branding, plan, clientLabel }) {
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const accentHex = /^#[0-9a-fA-F]{6}$/.test(branding && branding.accent) ? branding.accent : '#1f9d4a';
  const accent = hexRgb(accentHex);
  const accentFill = `${accent.r.toFixed(3)} ${accent.g.toFixed(3)} ${accent.b.toFixed(3)} rg`;
  const onAccent = accentInk(accentHex) === '#ffffff' ? '1 1 1 rg' : '0.047 0.071 0.063 rg';
  const ink = '0.047 0.071 0.063 rg';
  const mute = '0.243 0.318 0.282 rg';
  const client = firstName(clientLabel);
  const week = `Week of ${weekOfLabel()}`;
  const prepared = `Prepared by ${practice} with FitMunch`;
  const guidance = 'General guidance, not medical advice';
  const logo = logoXObject(branding && branding.logo);
  const days = (plan && plan.days) || [];
  const shopping = (plan && plan.shopping) || { lines: [], storeName: 'Store', totalAud: 0, estimates: [] };
  const mealDir = path.join(__dirname, '..', 'public', 'img', 'meals');
  const photos = new Map();
  days.forEach((day) => {
    (day.meals || []).forEach((meal) => {
      const slug = String(meal.slug || '').replace(/[^a-z0-9-]/g, '');
      if (!slug || photos.has(slug)) return;
      const image = jpegXObject(path.join(mealDir, `${slug}.jpg`));
      if (image) photos.set(slug, image);
    });
  });

  const images = [];
  if (logo) images.push({ name: 'ImLogo', image: logo });
  photos.forEach((image, slug) => images.push({ name: `Im${images.length}`, image, slug }));
  const photoName = new Map();
  images.forEach((row) => {
    if (row.slug) photoName.set(row.slug, row.name);
  });

  function commandsFor(draw) {
    const lines = [];
    function textAt(font, size, x, y, value, color) {
      lines.push('BT');
      lines.push(`/${font} ${size} Tf`);
      lines.push(color || ink);
      lines.push(`1 0 0 1 ${x} ${y} Tm`);
      lines.push(`(${pdfText(value)}) Tj`);
      lines.push('ET');
    }
    function circle(cx, cy, r) {
      const k = 0.5522847498;
      const c = r * k;
      lines.push(`${(cx + r).toFixed(2)} ${cy.toFixed(2)} m`);
      lines.push(`${(cx + r).toFixed(2)} ${(cy + c).toFixed(2)} ${(cx + c).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c`);
      lines.push(`${(cx - c).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + c).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c`);
      lines.push(`${(cx - r).toFixed(2)} ${(cy - c).toFixed(2)} ${(cx - c).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c`);
      lines.push(`${(cx + c).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - c).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c`);
      lines.push('h');
    }
    function footer() {
      textAt('F1', 8, 28, 30, prepared, mute);
      textAt('F1', 8, 28, 18, guidance, mute);
    }
    function band(title, subtitle) {
      lines.push(accentFill);
      lines.push('0 786 595 56 re f');
      if (logo) lines.push('q 36 0 0 36 24 796 cm /ImLogo Do Q');
      else {
        lines.push(`${accent.r.toFixed(3)} ${accent.g.toFixed(3)} ${accent.b.toFixed(3)} RG`);
        circle(42, 814, 16);
        lines.push('S');
        textAt('F2', 9, 33, 810, initials(practice), onAccent);
      }
      textAt('F2', 14, 70, 820, title, onAccent);
      textAt('F1', 10, 70, 804, subtitle, onAccent);
    }
    function drawMeal(meal, y) {
      const slug = String(meal.slug || '').replace(/[^a-z0-9-]/g, '');
      const name = photoName.get(slug);
      if (name) lines.push(`q 40 0 0 30 28 ${y - 22} cm /${name} Do Q`);
      else {
        lines.push('0.110 0.141 0.129 rg');
        lines.push(`28 ${y - 22} 40 30 re f`);
      }
      textAt('F2', 9, 76, y, meal.name);
      textAt('F1', 8, 330, y, `${meal.kcal} kcal  ${meal.protein}P ${meal.carbs}C ${meal.fat}F`, mute);
      (meal.method || []).slice(0, 2).forEach((line, index) => {
        textAt('F1', 7, 76, y - 12 - (index * 11), line, mute);
      });
    }
    function drawDay(day, top) {
      textAt('F2', 12, 28, top, day.day);
      textAt('F1', 9, 78, top, `${day.kcal} kcal   ${day.protein} P   ${day.carbs} C   ${day.fat} F`, mute);
      lines.push(`${accent.r.toFixed(3)} ${accent.g.toFixed(3)} ${accent.b.toFixed(3)} RG`);
      circle(548, top + 2, 14);
      lines.push('S');
      textAt('F2', 7, 536, top - 1, String(day.kcal));
      let y = top - 22;
      (day.meals || []).forEach((meal) => {
        drawMeal(meal, y);
        y -= 36;
      });
    }
    draw({ lines, textAt, band, footer, drawDay, ink, mute, accentFill });
    return lines.join('\n');
  }

  const page1 = commandsFor(({ band, footer, drawDay }) => {
    band(practice, `${client}  ${week}`);
    days.slice(0, 4).forEach((day, index) => drawDay(day, 748 - (index * 168)));
    footer();
  });
  const page2 = commandsFor(({ band, footer, drawDay }) => {
    band(practice, `${client}  ${week}`);
    days.slice(4, 7).forEach((day, index) => drawDay(day, 748 - (index * 168)));
    footer();
  });
  const page3 = commandsFor(({ textAt, band, footer, ink, mute }) => {
    band('Shopping list', `${client}  ${week}`);
    textAt('F1', 8, 28, 760, 'Estimated total', mute);
    textAt('F2', 14, 130, 758, money(shopping.totalAud), ink);
    textAt('F1', 8, 28, 740, plan.priceNote || PRICE_NOTE, mute);
    let y = 716;
    groupLines(shopping.lines).forEach((group) => {
      if (y < 56) return;
      textAt('F2', 10, 28, y, group.aisle);
      y -= 14;
      group.lines.forEach((line) => {
        if (y < 56) return;
        const label = line.packLabel || line.name;
        textAt('F1', 8, 28, y, label);
        textAt('F1', 8, 470, y, line.priced ? money(line.lineAud) : 'Check at checkout', mute);
        y -= 12;
      });
      y -= 6;
    });
    footer();
  });

  const font1 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const font2 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  const contents = [page1, page2, page3].map((src) => streamObject(`<< /Length ${Buffer.byteLength(src, 'latin1')} >>`, src));
  const imageObjects = images.map((row) => {
    const img = row.image;
    const dict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${img.colorSpace} /BitsPerComponent 8 /Filter ${img.filter} /Length ${img.data.length} >>`;
    return streamObject(dict, img.data);
  });
  const xrefs = images.map((row, index) => `/${row.name} ${11 + index} 0 R`).join(' ');
  const resources = `<< /Font << /F1 9 0 R /F2 10 0 R >> /XObject << ${xrefs} >> >>`;
  const pageObjects = [0, 1, 2].map((index) => (
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${6 + index} 0 R /Resources ${resources} >>`
  ));
  const pages = `<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>`;
  const catalog = '<< /Type /Catalog /Pages 2 0 R >>';
  return buildPdfDocument([
    catalog,
    pages,
    ...pageObjects,
    ...contents,
    font1,
    font2,
    ...imageObjects,
  ]);
}

module.exports = { buildCoachPdf, logoXObject };
