'use strict';

/**
 * Baseline JPEG decode that never stores the full coefficient image.
 *
 * jpeg-js keeps an Int32Array(64) per block. An 8000x6000 frame is about
 * 576MB of coefficients before a single pixel is written, which trips its
 * 512MB cap and comes back as a 413. This reads the SOF size first and
 * inverse-transforms one MCU at a time into an image already reduced by
 * 2, 4, or 8. Peak memory is the output buffer, not the source frame.
 *
 * Progressive scans are refused: they need every coefficient before the
 * IDCT, which is the allocation we are avoiding. Phone camera JPEGs are
 * baseline.
 */

const ZIGZAG = new Int32Array([
  0,
  1, 8,
  16, 9, 2,
  3, 10, 17, 24,
  32, 25, 18, 11, 4,
  5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6,
  7, 14, 21, 28, 35, 42, 49, 56,
  57, 50, 43, 36, 29, 22, 15,
  23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31,
  39, 46, 53, 60,
  61, 54, 47,
  55, 62,
  63,
]);

const DCT_COS1 = 4017;
const DCT_SIN1 = 799;
const DCT_COS3 = 3406;
const DCT_SIN3 = 2276;
const DCT_COS6 = 1567;
const DCT_SIN6 = 3784;
const DCT_SQRT2 = 5793;
const DCT_SQRT1D2 = 2896;

let peakRss = 0;
let stripeHook = null;

/** Test hook. Called synchronously at the end of each MCU row, before the yield. */
function setStripeHookForTests(fn) {
  stripeHook = typeof fn === 'function' ? fn : null;
}

function yieldStripe() {
  if (stripeHook) stripeHook();
  return new Promise((resolve) => { setImmediate(resolve); });
}

function noteRss() {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
}

function resetPeakRss() {
  peakRss = process.memoryUsage().rss;
}

function peakRssBytes() {
  return peakRss;
}

function decodeError(message) {
  const err = new Error(message || 'jpeg_scale_failed');
  err.code = 'jpeg_scale_failed';
  return err;
}

function buildHuffmanTable(codeLengths, values) {
  let k = 0;
  let length = 16;
  while (length > 0 && !codeLengths[length - 1]) length -= 1;
  const code = [];
  code.push({ children: [], index: 0 });
  let p = code[0];
  for (let i = 0; i < length; i += 1) {
    for (let j = 0; j < codeLengths[i]; j += 1) {
      p = code.pop();
      p.children[p.index] = values[k];
      while (p.index > 0) {
        if (code.length === 0) throw decodeError('bad huffman table');
        p = code.pop();
      }
      p.index += 1;
      code.push(p);
      while (code.length <= i) {
        const q = { children: [], index: 0 };
        code.push(q);
        p.children[p.index] = q.children;
        p = q;
      }
      k += 1;
    }
    if (i + 1 < length) {
      const q = { children: [], index: 0 };
      code.push(q);
      p.children[p.index] = q.children;
      p = q;
    }
  }
  return code[0].children;
}

function clamp8(n) {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

function dcSample(zz0, qt0) {
  const q = zz0 * qt0;
  const t = (DCT_SQRT2 * q + 512) >> 10;
  const t2 = (DCT_SQRT2 * t + 8192) >> 14;
  return clamp8(128 + ((t2 + 8) >> 4));
}

function idct8(zz, qt, p, out) {
  for (let i = 0; i < 64; i += 1) p[i] = zz[i] * qt[i];
  let v0;
  let v1;
  let v2;
  let v3;
  let v4;
  let v5;
  let v6;
  let v7;
  let t;
  for (let i = 0; i < 8; i += 1) {
    const row = 8 * i;
    if (p[1 + row] === 0 && p[2 + row] === 0 && p[3 + row] === 0 && p[4 + row] === 0
      && p[5 + row] === 0 && p[6 + row] === 0 && p[7 + row] === 0) {
      t = (DCT_SQRT2 * p[row] + 512) >> 10;
      p[row] = t;
      p[1 + row] = t;
      p[2 + row] = t;
      p[3 + row] = t;
      p[4 + row] = t;
      p[5 + row] = t;
      p[6 + row] = t;
      p[7 + row] = t;
      continue;
    }
    v0 = (DCT_SQRT2 * p[row] + 128) >> 8;
    v1 = (DCT_SQRT2 * p[4 + row] + 128) >> 8;
    v2 = p[2 + row];
    v3 = p[6 + row];
    v4 = (DCT_SQRT1D2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
    v7 = (DCT_SQRT1D2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
    v5 = p[3 + row] << 4;
    v6 = p[5 + row] << 4;
    t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * DCT_SIN6 + v3 * DCT_COS6 + 128) >> 8;
    v2 = (v2 * DCT_COS6 - v3 * DCT_SIN6 + 128) >> 8;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * DCT_SIN3 + v7 * DCT_COS3 + 2048) >> 12;
    v4 = (v4 * DCT_COS3 - v7 * DCT_SIN3 + 2048) >> 12;
    v7 = t;
    t = (v5 * DCT_SIN1 + v6 * DCT_COS1 + 2048) >> 12;
    v5 = (v5 * DCT_COS1 - v6 * DCT_SIN1 + 2048) >> 12;
    v6 = t;
    p[row] = v0 + v7;
    p[7 + row] = v0 - v7;
    p[1 + row] = v1 + v6;
    p[6 + row] = v1 - v6;
    p[2 + row] = v2 + v5;
    p[5 + row] = v2 - v5;
    p[3 + row] = v3 + v4;
    p[4 + row] = v3 - v4;
  }
  for (let col = 0; col < 8; col += 1) {
    if (p[8 + col] === 0 && p[16 + col] === 0 && p[24 + col] === 0 && p[32 + col] === 0
      && p[40 + col] === 0 && p[48 + col] === 0 && p[56 + col] === 0) {
      t = (DCT_SQRT2 * p[col] + 8192) >> 14;
      p[col] = t;
      p[8 + col] = t;
      p[16 + col] = t;
      p[24 + col] = t;
      p[32 + col] = t;
      p[40 + col] = t;
      p[48 + col] = t;
      p[56 + col] = t;
      continue;
    }
    v0 = (DCT_SQRT2 * p[col] + 2048) >> 12;
    v1 = (DCT_SQRT2 * p[32 + col] + 2048) >> 12;
    v2 = p[16 + col];
    v3 = p[48 + col];
    v4 = (DCT_SQRT1D2 * (p[8 + col] - p[56 + col]) + 2048) >> 12;
    v7 = (DCT_SQRT1D2 * (p[8 + col] + p[56 + col]) + 2048) >> 12;
    v5 = p[24 + col];
    v6 = p[40 + col];
    t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * DCT_SIN6 + v3 * DCT_COS6 + 2048) >> 12;
    v2 = (v2 * DCT_COS6 - v3 * DCT_SIN6 + 2048) >> 12;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * DCT_SIN3 + v7 * DCT_COS3 + 2048) >> 12;
    v4 = (v4 * DCT_COS3 - v7 * DCT_SIN3 + 2048) >> 12;
    v7 = t;
    t = (v5 * DCT_SIN1 + v6 * DCT_COS1 + 2048) >> 12;
    v5 = (v5 * DCT_COS1 - v6 * DCT_SIN1 + 2048) >> 12;
    v6 = t;
    p[col] = v0 + v7;
    p[56 + col] = v0 - v7;
    p[8 + col] = v1 + v6;
    p[48 + col] = v1 - v6;
    p[16 + col] = v2 + v5;
    p[40 + col] = v2 - v5;
    p[24 + col] = v3 + v4;
    p[32 + col] = v3 - v4;
  }
  for (let i = 0; i < 64; i += 1) out[i] = clamp8(128 + ((p[i] + 8) >> 4));
}

function boxDown(src, n, dest) {
  if (n === 8) {
    dest.set(src);
    return;
  }
  const step = 8 / n;
  const area = step * step;
  let o = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let sum = 0;
      const y0 = y * step;
      const x0 = x * step;
      for (let yy = 0; yy < step; yy += 1) {
        let i = (y0 + yy) * 8 + x0;
        for (let xx = 0; xx < step; xx += 1) {
          sum += src[i];
          i += 1;
        }
      }
      dest[o] = (sum + (area >> 1)) / area | 0;
      o += 1;
    }
  }
}

/**
 * @param {Buffer|Uint8Array} jpegData
 * @param {1|2|4|8} divisor output is about 1/divisor on each edge
 * @returns {Promise<{ width: number, height: number, data: Buffer }>}
 */
async function decodeScaledJpeg(jpegData, divisor) {
  if (divisor !== 1 && divisor !== 2 && divisor !== 4 && divisor !== 8) {
    throw decodeError('bad scale');
  }
  const data = jpegData instanceof Uint8Array ? jpegData : new Uint8Array(jpegData);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw decodeError('not a jpeg');

  const quant = [];
  const dcTables = [];
  const acTables = [];
  let frame = null;
  let resetInterval = 0;
  let offset = 2;

  function readU16() {
    if (offset + 2 > data.length) throw decodeError('truncated jpeg');
    const v = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return v;
  }

  function nextMarker() {
    if (offset >= data.length || data[offset] !== 0xff) throw decodeError('marker missing');
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) throw decodeError('marker missing');
    const marker = data[offset];
    offset += 1;
    return marker;
  }

  while (offset < data.length) {
    const marker = nextMarker();
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segLen = readU16();
    if (segLen < 2 || offset + segLen - 2 > data.length) throw decodeError('bad segment');
    const segEnd = offset + segLen - 2;

    if (marker === 0xdb) {
      while (offset < segEnd) {
        const spec = data[offset];
        offset += 1;
        const table = new Int32Array(64);
        const prec = spec >> 4;
        if (prec === 0) {
          for (let j = 0; j < 64; j += 1) {
            table[ZIGZAG[j]] = data[offset];
            offset += 1;
          }
        } else if (prec === 1) {
          for (let j = 0; j < 64; j += 1) {
            table[ZIGZAG[j]] = readU16();
          }
        } else throw decodeError('bad quant table');
        quant[spec & 15] = table;
      }
    } else if (marker === 0xc4) {
      while (offset < segEnd) {
        const spec = data[offset];
        offset += 1;
        const lengths = new Uint8Array(16);
        let count = 0;
        for (let j = 0; j < 16; j += 1) {
          lengths[j] = data[offset];
          count += lengths[j];
          offset += 1;
        }
        const values = new Uint8Array(count);
        for (let j = 0; j < count; j += 1) {
          values[j] = data[offset];
          offset += 1;
        }
        const table = buildHuffmanTable(lengths, values);
        if ((spec >> 4) === 0) dcTables[spec & 15] = table;
        else acTables[spec & 15] = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      const precision = data[offset];
      offset += 1;
      const height = readU16();
      const width = readU16();
      const count = data[offset];
      offset += 1;
      if (precision !== 8 || !width || !height || (count !== 1 && count !== 3)) {
        throw decodeError('unsupported frame');
      }
      const components = [];
      let maxH = 1;
      let maxV = 1;
      for (let i = 0; i < count; i += 1) {
        const id = data[offset];
        const hv = data[offset + 1];
        const qId = data[offset + 2];
        const h = hv >> 4;
        const v = hv & 15;
        offset += 3;
        if (h < 1 || h > 4 || v < 1 || v > 4) throw decodeError('bad sampling');
        if (h > maxH) maxH = h;
        if (v > maxV) maxV = v;
        components.push({ id, h, v, qId });
      }
      frame = { width, height, components, maxH, maxV };
    } else if (marker === 0xc2) {
      throw decodeError('progressive jpeg');
    } else if (marker === 0xdd) {
      resetInterval = readU16();
    } else if (marker === 0xda) {
      if (!frame) throw decodeError('scan before frame');
      const selectors = data[offset];
      offset += 1;
      const scan = [];
      for (let i = 0; i < selectors; i += 1) {
        const id = data[offset];
        const spec = data[offset + 1];
        offset += 2;
        const component = frame.components.find((c) => c.id === id);
        if (!component) throw decodeError('unknown component');
        component.dc = dcTables[spec >> 4];
        component.ac = acTables[spec & 15];
        component.qt = quant[component.qId];
        if (!component.dc || !component.ac || !component.qt) throw decodeError('missing table');
        scan.push(component);
      }
      const spectralStart = data[offset];
      const spectralEnd = data[offset + 1];
      const successive = data[offset + 2];
      offset += 3;
      if (spectralStart !== 0 || spectralEnd !== 63 || successive !== 0) {
        throw decodeError('progressive scan');
      }
      if (offset !== segEnd) offset = segEnd;
      return decodeScan(data, offset, frame, scan, resetInterval, divisor);
    } else {
      offset = segEnd;
    }
    if (offset < segEnd) offset = segEnd;
  }
  throw decodeError('no scan');
}

async function decodeScan(data, offset, frame, scan, resetInterval, divisor) {
  const n = 8 / divisor;
  const outW = Math.ceil(frame.width / divisor);
  const outH = Math.ceil(frame.height / divisor);
  noteRss();
  const rgba = Buffer.alloc(outW * outH * 4, 255);
  noteRss();

  const mcuW = 8 * frame.maxH;
  const mcuH = 8 * frame.maxV;
  const mcusPerLine = Math.ceil(frame.width / mcuW);
  const mcusPerColumn = Math.ceil(frame.height / mcuH);
  const mcuExpected = mcusPerLine * mcusPerColumn;
  if (!resetInterval) resetInterval = mcuExpected;

  const zz = new Int32Array(64);
  const idctIn = new Int32Array(64);
  const idctOut = new Uint8Array(64);
  const grids = scan.map((component) => ({
    component,
    blocks: Array.from({ length: component.v * component.h }, () => new Uint8Array(n * n)),
  }));

  let bitsData = 0;
  let bitsCount = 0;

  function readBit() {
    if (bitsCount > 0) {
      bitsCount -= 1;
      return (bitsData >> bitsCount) & 1;
    }
    if (offset >= data.length) throw decodeError('truncated scan');
    bitsData = data[offset];
    offset += 1;
    if (bitsData === 0xff) {
      if (offset >= data.length) throw decodeError('truncated scan');
      const next = data[offset];
      offset += 1;
      if (next !== 0) throw decodeError('unexpected marker');
    }
    bitsCount = 7;
    return bitsData >>> 7;
  }

  function receive(length) {
    let value = 0;
    while (length > 0) {
      value = (value << 1) | readBit();
      length -= 1;
    }
    return value;
  }

  function receiveAndExtend(length) {
    const value = receive(length);
    if (value >= (1 << (length - 1))) return value;
    return value + (-1 << length) + 1;
  }

  function decodeHuffman(tree) {
    let node = tree;
    for (;;) {
      node = node[readBit()];
      if (typeof node === 'number') return node;
      if (typeof node !== 'object' || node == null) throw decodeError('bad huffman code');
    }
  }

  function decodeBlock(component, dest) {
    zz.fill(0);
    const t = decodeHuffman(component.dc);
    const diff = t === 0 ? 0 : receiveAndExtend(t);
    component.pred = (component.pred || 0) + diff;
    zz[0] = component.pred;
    let k = 1;
    let ac = false;
    while (k < 64) {
      const rs = decodeHuffman(component.ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k >= 64) break;
      zz[ZIGZAG[k]] = receiveAndExtend(s);
      ac = true;
      k += 1;
    }
    if (!ac && n === 8) {
      dest.fill(dcSample(zz[0], component.qt[0]));
      return;
    }
    if (!ac) {
      dest.fill(dcSample(zz[0], component.qt[0]));
      return;
    }
    idct8(zz, component.qt, idctIn, idctOut);
    boxDown(idctOut, n, dest);
  }

  function sample(grid, localX, localY) {
    const component = grid.component;
    const gridW = component.h * n;
    const gridH = component.v * n;
    let gx = (localX * gridW / mcuW) | 0;
    let gy = (localY * gridH / mcuH) | 0;
    if (gx < 0) gx = 0;
    if (gy < 0) gy = 0;
    if (gx >= gridW) gx = gridW - 1;
    if (gy >= gridH) gy = gridH - 1;
    const bx = (gx / n) | 0;
    const by = (gy / n) | 0;
    const block = grid.blocks[by * component.h + bx];
    return block[(gy - by * n) * n + (gx - bx * n)];
  }

  function writeMcu(mcu) {
    const mcuCol = mcu % mcusPerLine;
    const mcuRow = (mcu / mcusPerLine) | 0;
    const x0 = (mcuCol * mcuW / divisor) | 0;
    const y0 = (mcuRow * mcuH / divisor) | 0;
    let x1 = ((mcuCol + 1) * mcuW / divisor) | 0;
    let y1 = ((mcuRow + 1) * mcuH / divisor) | 0;
    if (x1 > outW) x1 = outW;
    if (y1 > outH) y1 = outH;
    const yGrid = grids[0];
    const cbGrid = grids[1];
    const crGrid = grids[2];
    for (let y = y0; y < y1; y += 1) {
      const localY = (y - y0) * divisor + (divisor >> 1);
      let di = (y * outW + x0) * 4;
      for (let x = x0; x < x1; x += 1) {
        const localX = (x - x0) * divisor + (divisor >> 1);
        const Y = sample(yGrid, localX, localY);
        if (!cbGrid) {
          rgba[di] = Y;
          rgba[di + 1] = Y;
          rgba[di + 2] = Y;
        } else {
          const Cb = sample(cbGrid, localX, localY) - 128;
          const Cr = sample(crGrid, localX, localY) - 128;
          rgba[di] = clamp8(Y + 1.402 * Cr);
          rgba[di + 1] = clamp8(Y - 0.3441363 * Cb - 0.71413636 * Cr);
          rgba[di + 2] = clamp8(Y + 1.772 * Cb);
        }
        rgba[di + 3] = 255;
        di += 4;
      }
    }
  }

  let mcu = 0;
  while (mcu < mcuExpected) {
    for (let i = 0; i < scan.length; i += 1) scan[i].pred = 0;
    const batch = Math.min(resetInterval, mcuExpected - mcu);
    for (let nMcu = 0; nMcu < batch; nMcu += 1) {
      for (let g = 0; g < grids.length; g += 1) {
        const grid = grids[g];
        const component = grid.component;
        let b = 0;
        for (let row = 0; row < component.v; row += 1) {
          for (let col = 0; col < component.h; col += 1) {
            decodeBlock(component, grid.blocks[b]);
            b += 1;
          }
        }
      }
      writeMcu(mcu);
      const row = (mcu / mcusPerLine) | 0;
      mcu += 1;
      if ((mcu & 63) === 0) noteRss();
      const nextRow = (mcu / mcusPerLine) | 0;
      if (mcu === mcuExpected || nextRow !== row) await yieldStripe();
    }
    bitsCount = 0;
    if (mcu >= mcuExpected) break;
    if (offset + 1 < data.length && data[offset] === 0xff && data[offset + 1] === 0xff) {
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      offset -= 1;
    }
    if (offset + 1 >= data.length || data[offset] !== 0xff) throw decodeError('restart missing');
    const rst = data[offset + 1];
    if (rst < 0xd0 || rst > 0xd7) throw decodeError('restart missing');
    offset += 2;
  }
  noteRss();
  return { width: outW, height: outH, data: rgba };
}

module.exports = {
  decodeScaledJpeg,
  resetPeakRss,
  peakRssBytes,
  noteRss,
  setStripeHookForTests,
};
