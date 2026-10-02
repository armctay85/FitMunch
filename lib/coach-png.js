'use strict';

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodeRgbPng(width, height, rgb) {
  if (rgb.length !== width * height * 3) throw new Error('RGB buffer length does not match the image size.');
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer || buffer.length < 8 || !buffer.slice(0, 8).equals(sig)) {
    throw new Error('Not a PNG logo.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.slice(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = buffer.slice(offset, offset + len);
    offset += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace !== 0) throw new Error('Interlaced PNG logos are not supported.');
  if (bitDepth !== 8) throw new Error('PNG logo bit depth is not supported.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('PNG logo colour type is not supported.');
  if (colorType === 3 && !palette) throw new Error('PNG logo palette is missing.');
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    const row = inflated.slice(src, src + stride);
    src += stride;
    const recon = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? recon[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value = (row[i] + left) & 255;
      else if (filter === 2) value = (row[i] + up) & 255;
      else if (filter === 3) value = (row[i] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (row[i] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error('PNG logo filter is not supported.');
      recon[i] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const i = x * channels;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (colorType === 0) {
        r = g = b = recon[i];
      } else if (colorType === 2) {
        r = recon[i];
        g = recon[i + 1];
        b = recon[i + 2];
      } else if (colorType === 3) {
        const idx = recon[i] * 3;
        r = palette[idx];
        g = palette[idx + 1];
        b = palette[idx + 2];
      } else if (colorType === 4) {
        r = g = b = recon[i];
        a = recon[i + 1];
      } else {
        r = recon[i];
        g = recon[i + 1];
        b = recon[i + 2];
        a = recon[i + 3];
      }
      const alpha = a / 255;
      const di = (y * width + x) * 3;
      rgb[di] = Math.round(r * alpha + 255 * (1 - alpha));
      rgb[di + 1] = Math.round(g * alpha + 255 * (1 - alpha));
      rgb[di + 2] = Math.round(b * alpha + 255 * (1 - alpha));
    }
    prev = recon;
  }
  return { width, height, rgb };
}

module.exports = { encodeRgbPng, decodePng };
