'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decodePng } = require('./coach-png');
const { PRICE_NOTE } = require('./coach-plan');
const { accentInk, firstName, weekOfLabel, initials, groupLines } = require('./coach-share');

function pdfText(value) {
  return String(value == null ? '' : value)
    .replace(/\u2013|\u2014/g, ' to ')
    .replace(/[^\x20-\x7E\u00B7]/g, '')
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
  const shopping = (plan && plan.shopping) || { lines: [], stores: [], splitLabel: '', note: PRICE_NOTE };
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
  const page3 = commandsFor(({ lines, textAt, band, footer, ink, mute }) => {
    band('Shopping list', `${client}  ${week}`);
    const proteinFill = '0.886 0.949 0.910 rg';
    const swapFill = [
      (accent.r + (1 - accent.r) * 0.78).toFixed(3),
      (accent.g + (1 - accent.g) * 0.78).toFixed(3),
      (accent.b + (1 - accent.b) * 0.78).toFixed(3),
      'rg',
    ].join(' ');
    const count = shopping.itemCount != null ? shopping.itemCount : (shopping.lines || []).length;
    const weekly = shopping.weeklyProtein != null ? shopping.weeklyProtein : 0;
    const aisleText = (shopping.aisles || []).join(', ');
    let y = 768;
    lines.push('0.965 0.976 0.969 rg');
    lines.push(`28 ${y - 78} 539 86 re f`);
    textAt('F2', 12, 40, y - 6, "Your coach's store split", ink);
    textAt('F1', 9, 40, y - 22, shopping.splitLabel || '', ink);
    textAt('F1', 9, 40, y - 38, `${count} items    ${weekly}g protein from this list`, ink);
    textAt('F1', 9, 40, y - 54, aisleText, mute);
    const noteY = y - 70;
    textAt('F1', 9, 54, noteY, shopping.note || plan.priceNote || PRICE_NOTE, mute);
    lines.push('0.102 0.380 0.220 RG');
    lines.push('1.1 w 1 J 1 j');
    lines.push(`${40} ${noteY - 6} m ${42.2} ${noteY} l ${46} ${noteY - 6} l S`);
    lines.push(`${40} ${noteY - 6} m ${46} ${noteY - 6} l ${46} ${noteY - 12} l ${40} ${noteY - 12} l h S`);
    y = 676;

    function chip(x, baseline, label, fill) {
      const width = Math.min(520, 10 + String(label).length * 4.2);
      lines.push(fill);
      lines.push(`${x.toFixed(1)} ${(baseline - 3).toFixed(1)} ${width.toFixed(1)} 13 re f`);
      textAt('F1', 8, x + 4, baseline, label, ink);
      return width;
    }

    function aisleMark(kind, x, baseline) {
      lines.push('0.102 0.380 0.220 RG');
      lines.push('1.15 w 1 J 1 j');
      const ox = x;
      const oy = baseline - 1;
      const p = (nx, ny) => `${(ox + nx).toFixed(1)} ${(oy + ny).toFixed(1)}`;
      if (kind === 'Produce') {
        lines.push(`${p(1, 1)} m ${p(4, 8)} ${p(10, 7)} ${p(8, 2)} c`);
        lines.push(`${p(2, 3)} m ${p(6, 6)} l`);
      } else if (kind === 'Meat') {
        lines.push(`${p(2, 0)} m ${p(2, 5)} l ${p(5, 0)} m ${p(5, 5)} l ${p(8, 0)} m ${p(8, 5)} l`);
        lines.push(`${p(2, 5)} m ${p(8, 5)} l ${p(5, 5)} m ${p(5, 10)} l`);
      } else if (kind === 'Dairy') {
        lines.push(`${p(3, 0)} m ${p(3, 7)} l ${p(7, 7)} l ${p(7, 0)} l`);
        lines.push(`${p(4, 7)} m ${p(4, 10)} l ${p(6, 10)} l ${p(6, 7)} l`);
      } else if (kind === 'Frozen') {
        lines.push(`${p(5, 0)} m ${p(5, 10)} l ${p(1, 2)} m ${p(9, 8)} l ${p(1, 8)} m ${p(9, 2)} l`);
      } else if (kind === 'Bakery') {
        lines.push(`${p(1, 0)} m ${p(9, 0)} l ${p(9, 3)} l`);
        lines.push(`${p(1, 3)} m ${p(1, 8)} ${p(9, 8)} ${p(9, 3)} c`);
      } else {
        lines.push(`${p(3, 9)} m ${p(7, 9)} l ${p(7, 7)} l ${p(8, 7)} l ${p(8, 0)} l ${p(2, 0)} l ${p(2, 7)} l ${p(3, 7)} l ${p(3, 9)} l`);
      }
      lines.push('S');
    }

    const stores = shopping.stores && shopping.stores.length
      ? shopping.stores
      : [{ storeId: shopping.storeId, storeName: shopping.storeName || 'Store' }];
    stores.forEach((store) => {
      if (y < 70) return;
      textAt('F2', 12, 28, y, store.storeName || '');
      y -= 18;
      const rows = (shopping.lines || []).filter((line) => line.storeId === store.storeId);
      groupLines(rows).forEach((group) => {
        if (y < 64) return;
        aisleMark(group.aisle, 28, y);
        textAt('F2', 10, 44, y, group.aisle);
        y -= 16;
        group.lines.forEach((line) => {
          if (y < 56) return;
          const name = line.packLabel || line.name || '';
          const chips = [];
          if (line.proteinLabel) chips.push({ label: line.proteinLabel, fill: proteinFill });
          if (line.swapLabel) chips.push({ label: line.swapLabel, fill: swapFill });
          const nameWidth = String(name).length * 5.1;
          const chipsWidth = chips.reduce((sum, row) => sum + 10 + String(row.label).length * 4.15, 0) + Math.max(0, chips.length - 1) * 6;
          const inline = chips.length && (58 + nameWidth + chipsWidth) <= 567;
          textAt('F1', 9, 36, y, name);
          if (inline) {
            let x = 52 + nameWidth;
            chips.forEach((row) => {
              x += chip(x, y, row.label, row.fill) + 6;
            });
            y -= 16;
          } else if (chips.length) {
            y -= 14;
            let x = 36;
            chips.forEach((row) => {
              const width = 10 + String(row.label).length * 4.15;
              if (x + width > 567) {
                y -= 16;
                x = 36;
              }
              if (y >= 48) x += chip(x, y, row.label, row.fill) + 6;
            });
            y -= 16;
          } else {
            y -= 15;
          }
        });
      });
      y -= 6;
    });
    footer();
  });

  const font1 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  const font2 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
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
