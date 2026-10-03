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
    .replace(/[^\x20-\x7E\u00B7\u00D7]/g, '')
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
    band(practice, `${client} · ${week}`);
    days.slice(0, 4).forEach((day, index) => drawDay(day, 748 - (index * 168)));
    footer();
  });
  const page2 = commandsFor(({ band, footer, drawDay }) => {
    band(practice, `${client} · ${week}`);
    days.slice(4, 7).forEach((day, index) => drawDay(day, 748 - (index * 168)));
    footer();
  });
  const page3 = commandsFor(({ lines, textAt, band, footer, ink, mute }) => {
    band('Shopping list', `${client} · ${week}`);
    const proteinFill = '0.886 0.949 0.910 rg';
    const swapFill = [
      (accent.r + (1 - accent.r) * 0.78).toFixed(3),
      (accent.g + (1 - accent.g) * 0.78).toFixed(3),
      (accent.b + (1 - accent.b) * 0.78).toFixed(3),
      'rg',
    ].join(' ');
    const count = shopping.itemCount != null ? shopping.itemCount : (shopping.lines || []).length;
    const weekly = shopping.weeklyProtein != null ? shopping.weeklyProtein : 0;
    let y = 756;
    textAt('F2', 11, 28, y, "Your coach's store split", ink);
    textAt('F1', 9, 188, y, shopping.storeLine || '', ink);
    y -= 14;
    textAt('F1', 9, 28, y, `${count} items    ${weekly}g protein from this list`, mute);
    y -= 13;
    textAt('F1', 9, 28, y, shopping.note || plan.priceNote || PRICE_NOTE, mute);
    y -= 8;
    lines.push('0.83 0.86 0.84 RG');
    lines.push('0.7 w');
    lines.push(`28 ${y.toFixed(1)} m 567 ${y.toFixed(1)} l S`);
    const top = y - 18;
    const floor = 44;

    function roundedRect(x, bottom, w, h, r) {
      const k = 0.5522847498;
      const c = r * k;
      const n = (v) => v.toFixed(2);
      lines.push(`${n(x + r)} ${n(bottom)} m`);
      lines.push(`${n(x + w - r)} ${n(bottom)} l`);
      lines.push(`${n(x + w - r + c)} ${n(bottom)} ${n(x + w)} ${n(bottom + c)} ${n(x + w)} ${n(bottom + r)} c`);
      lines.push(`${n(x + w)} ${n(bottom + h - r)} l`);
      lines.push(`${n(x + w)} ${n(bottom + h - r + c)} ${n(x + w - c)} ${n(bottom + h)} ${n(x + w - r)} ${n(bottom + h)} c`);
      lines.push(`${n(x + r)} ${n(bottom + h)} l`);
      lines.push(`${n(x + r - c)} ${n(bottom + h)} ${n(x)} ${n(bottom + h - c)} ${n(x)} ${n(bottom + h - r)} c`);
      lines.push(`${n(x)} ${n(bottom + r)} l`);
      lines.push(`${n(x)} ${n(bottom + r - c)} ${n(x + c)} ${n(bottom)} ${n(x + r)} ${n(bottom)} c`);
      lines.push('h f');
    }

    function chip(x, baseline, label, fill) {
      const width = Math.min(240, 10 + String(label).length * 3.55);
      const height = 11;
      lines.push(fill);
      roundedRect(x, baseline - 2.5, width, height, height / 2);
      textAt('F1', 7, x + 5, baseline, label, ink);
      return width;
    }

    function checkbox(x, baseline) {
      lines.push('0.12 0.16 0.14 RG');
      lines.push('0.9 w');
      lines.push(`${x.toFixed(1)} ${(baseline - 1.2).toFixed(1)} 8 8 re S`);
    }

    function aisleIcon(kind, x, baseline) {
      lines.push('0.08 0.32 0.18 RG');
      lines.push('1.15 w 1 J 1 j');
      const ox = x;
      const oy = baseline - 1.5;
      const p = (nx, ny) => `${(ox + nx).toFixed(2)} ${(oy + ny).toFixed(2)}`;
      if (kind === 'Meat') {
        lines.push(`${p(9.2, 7.4)} m`);
        lines.push(`${p(9.2, 10.6)} ${p(5.2, 10.6)} ${p(5.2, 7.4)} c`);
        lines.push(`${p(5.2, 4.2)} ${p(9.2, 4.2)} ${p(9.2, 7.4)} c`);
        lines.push(`${p(6.6, 5.6)} m ${p(3.2, 2.4)} l`);
        lines.push(`${p(3.3, 2.5)} m`);
        lines.push(`${p(3.3, 4.1)} ${p(1.1, 4.1)} ${p(1.1, 2.5)} c`);
        lines.push(`${p(1.1, 0.9)} ${p(3.3, 0.9)} ${p(3.3, 2.5)} c`);
      } else if (kind === 'Produce') {
        lines.push(`${p(2.2, 1.1)} m ${p(7.6, 8.2)} l ${p(5.4, 9.4)} l ${p(2.2, 1.1)}`);
        lines.push(`${p(5.6, 8.6)} m ${p(4.2, 11.2)} ${p(7.4, 11.4)} ${p(7.2, 8.4)} c`);
        lines.push(`${p(6.6, 8.2)} m ${p(8.6, 10.6)} ${p(10.4, 8.4)} ${p(7.4, 7.2)} c`);
      } else if (kind === 'Bakery') {
        lines.push(`${p(1.1, 1.2)} m ${p(10.4, 1.2)} l ${p(10.4, 4.2)} l ${p(1.1, 4.2)} l ${p(1.1, 1.2)}`);
        lines.push(`${p(1.1, 4.2)} m ${p(1.1, 8.6)} ${p(10.4, 8.6)} ${p(10.4, 4.2)} c`);
        lines.push(`${p(4.2, 1.2)} m ${p(4.2, 4.6)} l ${p(7.4, 1.2)} m ${p(7.4, 5.2)} l`);
      } else if (kind === 'Dairy') {
        lines.push(`${p(3.4, 11)} m ${p(7.2, 11)} l ${p(8.6, 9)} l ${p(8.6, 1.1)} l ${p(2, 1.1)} l ${p(2, 9)} l ${p(3.4, 11)}`);
        lines.push(`${p(2, 8.2)} m ${p(8.6, 8.2)} l`);
      } else if (kind === 'Frozen') {
        lines.push(`${p(5.6, 0.4)} m ${p(5.6, 10.8)} l ${p(0.4, 5.6)} m ${p(10.8, 5.6)} l`);
        lines.push(`${p(1.6, 1.6)} m ${p(9.6, 9.6)} l ${p(1.6, 9.6)} m ${p(9.6, 1.6)} l`);
        lines.push(`${p(4.2, 2.2)} m ${p(6.8, 2.2)} l ${p(4.2, 9)} m ${p(6.8, 9)} l`);
        lines.push(`${p(2.2, 4.2)} m ${p(2.2, 6.8)} l ${p(9, 4.2)} m ${p(9, 6.8)} l`);
      } else {
        lines.push(`${p(3.6, 11)} m ${p(8, 11)} l ${p(8, 9)} l ${p(9.4, 9)} l ${p(9.4, 1.1)} l ${p(2.2, 1.1)} l ${p(2.2, 9)} l ${p(3.6, 9)} l ${p(3.6, 11)}`);
        lines.push(`${p(2.2, 5.6)} m ${p(9.4, 5.6)} l`);
      }
      lines.push('S');
    }

    const stores = shopping.stores && shopping.stores.length
      ? shopping.stores
      : [{ storeId: shopping.storeId, storeName: shopping.storeName || 'Store' }];
    const rows = [];
    stores.forEach((store) => {
      rows.push({
        kind: 'store',
        h: 16,
        draw(x, baseline) {
          textAt('F2', 11, x, baseline, store.storeName || '');
        },
      });
      const storeRows = (shopping.lines || []).filter((line) => line.storeId === store.storeId);
      groupLines(storeRows).forEach((group) => {
        rows.push({
          kind: 'aisle',
          h: 14,
          draw(x, baseline) {
            aisleIcon(group.aisle, x, baseline);
            textAt('F2', 9, x + 16, baseline, group.aisle);
          },
        });
        group.lines.forEach((line) => {
          rows.push({
            kind: 'item',
            h: 13,
            draw(x, baseline) {
              checkbox(x, baseline);
              const name = line.packLabel || line.name || '';
              const chips = [];
              if (line.proteinLabel) chips.push({ label: line.proteinLabel, fill: proteinFill });
              if (line.swapLabel) chips.push({ label: line.swapLabel, fill: swapFill });
              const widths = chips.map((row) => Math.min(210, 10 + String(row.label).length * 3.55));
              const chipsW = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 3;
              const right = 567;
              lines.push('q');
              lines.push(`${(x + 11).toFixed(1)} ${(baseline - 3).toFixed(1)} ${Math.max(24, right - chipsW - x - 16).toFixed(1)} 12 re W n`);
              textAt('F1', 8, x + 12, baseline, name);
              lines.push('Q');
              let cx = right - chipsW;
              chips.forEach((row) => {
                cx += chip(cx, baseline, row.label, row.fill) + 3;
              });
            },
          });
        });
      });
    });

    const rowCount = Math.max(rows.length, 1);
    const lastBaseline = 56;
    const rhythm = rowCount <= 1
      ? 20
      : Math.max(16, Math.min(28, (top - lastBaseline) / (rowCount - 1)));
    rows.forEach((row) => { row.h = rhythm; });
    let cursor = top;
    rows.forEach((row) => {
      if (cursor < floor) return;
      row.draw(28, cursor);
      cursor -= row.h;
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
