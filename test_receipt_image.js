'use strict';

const jwt = require('jsonwebtoken');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const request = require('supertest');

const prep = require('./lib/receipt-image');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function rgba(width, height, paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const px = paint(x, y);
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

function jpegOf(width, height, quality, paint) {
  const data = rgba(width, height, paint || ((x, y) => [
    Math.round((x / width) * 255),
    Math.round((y / height) * 180),
    90,
  ]));
  return Buffer.from(jpeg.encode({ data, width, height }, quality).data);
}

function exifOrientation(orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

function withExif(jpegBuf, orientation) {
  return Buffer.concat([jpegBuf.subarray(0, 2), exifOrientation(orientation), jpegBuf.subarray(2)]);
}

function huffmanCodes(nrcodes, values) {
  const map = new Map();
  let code = 0;
  let pos = 0;
  for (let len = 1; len <= 16; len += 1) {
    const count = nrcodes[len] || 0;
    for (let i = 0; i < count; i += 1) {
      map.set(values[pos], { code, len });
      code += 1;
      pos += 1;
    }
    code <<= 1;
  }
  return map;
}

const LUMA_DC_N = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const LUMA_DC_V = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const LUMA_AC_N = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const LUMA_AC_V = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const CHROMA_DC_N = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const CHROMA_DC_V = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const CHROMA_AC_N = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const CHROMA_AC_V = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

function markerSegment(marker, body) {
  const out = Buffer.alloc(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  out.writeUInt16BE(body.length + 2, 2);
  body.copy(out, 4);
  return out;
}

function dhtBody(cls, id, nrcodes, values) {
  const lengths = nrcodes.slice(1, 17);
  const count = lengths.reduce((sum, n) => sum + n, 0);
  const body = Buffer.alloc(1 + 16 + count);
  body[0] = (cls << 4) | id;
  for (let i = 0; i < 16; i += 1) body[1 + i] = lengths[i];
  for (let i = 0; i < count; i += 1) body[17 + i] = values[i];
  return body;
}

function dcMagnitude(value) {
  if (value === 0) return { bits: 0, length: 0 };
  const abs = Math.abs(value);
  let length = 0;
  let rest = abs;
  while (rest) {
    rest >>= 1;
    length += 1;
  }
  const bits = value > 0 ? value : value + (1 << length) - 1;
  return { bits, length };
}

/**
 * Baseline 4:2:0 JPEG whose blocks are DC-only. Left half and right half use
 * different luma DC values so a shrink can be checked without allocating an
 * 8000x6000 bitmap. jpeg-js can decode the small sizes this writes.
 */
function dcJpeg(width, height, yLeft, yRight) {
  const quant = Buffer.alloc(65, 1);
  quant[0] = 0;
  const quantC = Buffer.alloc(65, 1);
  quantC[0] = 1;
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof[6] = 1;
  sof[7] = 0x22;
  sof[8] = 0;
  sof[9] = 2;
  sof[10] = 0x11;
  sof[11] = 1;
  sof[12] = 3;
  sof[13] = 0x11;
  sof[14] = 1;
  const sos = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const header = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    markerSegment(0xdb, Buffer.concat([quant, quantC])),
    markerSegment(0xc0, sof),
    markerSegment(0xc4, dhtBody(0, 0, LUMA_DC_N, LUMA_DC_V)),
    markerSegment(0xc4, dhtBody(1, 0, LUMA_AC_N, LUMA_AC_V)),
    markerSegment(0xc4, dhtBody(0, 1, CHROMA_DC_N, CHROMA_DC_V)),
    markerSegment(0xc4, dhtBody(1, 1, CHROMA_AC_N, CHROMA_AC_V)),
    markerSegment(0xda, sos),
  ]);
  const lumaDC = huffmanCodes(LUMA_DC_N, LUMA_DC_V);
  const lumaAC = huffmanCodes(LUMA_AC_N, LUMA_AC_V);
  const chromaDC = huffmanCodes(CHROMA_DC_N, CHROMA_DC_V);
  const chromaAC = huffmanCodes(CHROMA_AC_N, CHROMA_AC_V);
  const mcusX = width / 16;
  const mcusY = height / 16;
  const bytes = Buffer.alloc(mcusX * mcusY * 8 + 64);
  let pos = 0;
  let acc = 0;
  let nbits = 0;
  function writeBits(code, len) {
    acc = (acc << len) | (code & ((1 << len) - 1));
    nbits += len;
    while (nbits >= 8) {
      nbits -= 8;
      const byte = (acc >> nbits) & 255;
      bytes[pos] = byte;
      pos += 1;
      if (byte === 0xff) {
        bytes[pos] = 0;
        pos += 1;
      }
    }
  }
  function emit(pred, value, dcMap, acMap) {
    const mag = dcMagnitude(value - pred);
    const dc = dcMap.get(mag.length);
    writeBits(dc.code, dc.len);
    if (mag.length) writeBits(mag.bits, mag.length);
    const eob = acMap.get(0x00);
    writeBits(eob.code, eob.len);
    return value;
  }
  let predY = 0;
  let predCb = 0;
  let predCr = 0;
  for (let my = 0; my < mcusY; my += 1) {
    for (let mx = 0; mx < mcusX; mx += 1) {
      const yv = mx < mcusX / 2 ? yLeft : yRight;
      for (let block = 0; block < 4; block += 1) predY = emit(predY, yv, lumaDC, lumaAC);
      predCb = emit(predCb, 0, chromaDC, chromaAC);
      predCr = emit(predCr, 0, chromaDC, chromaAC);
    }
  }
  if (nbits) {
    const byte = (acc << (8 - nbits)) & 255;
    bytes[pos] = byte;
    pos += 1;
    if (byte === 0xff) {
      bytes[pos] = 0;
      pos += 1;
    }
  }
  return Buffer.concat([header, bytes.subarray(0, pos), Buffer.from([0xff, 0xd9])]);
}

function longEdge(width, height) {
  return Math.max(width, height);
}

describe('receipt image prep', () => {
  it('keeps an ordinary photo at 1568 and raises the cap for a large or tall frame', () => {
    expect(prep.targetLongEdge(2200, 1600)).toBe(1568);
    expect(prep.targetLongEdge(4032, 3024)).toBe(prep.LARGE_EDGE);
    expect(prep.targetLongEdge(4000, 3000)).toBe(2400);
    expect(prep.targetLongEdge(6000, 1200)).toBe(prep.THIN_EDGE);
    expect(prep.targetLongEdge(1400, 1000)).toBe(1400);
    expect(prep.targetLongEdge(800, 600)).toBe(800);
    expect(prep.MAX_EDGE).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
    expect(prep.LARGE_EDGE).toBeGreaterThan(prep.MAX_EDGE);
    expect(prep.THIN_EDGE).toBeGreaterThanOrEqual(2400);
    expect(prep.THIN_EDGE).toBeLessThanOrEqual(3000);
  });

  it('downscales a large photo under the byte threshold and strips EXIF', () => {
    const source = withExif(jpegOf(2200, 1600, 95), 1);
    expect(source.length).toBeGreaterThan(50 * 1024);
    expect(source.includes(Buffer.from('Exif'))).toBe(true);
    const out = prep.prepareReceiptImage({
      imageBase64: source.toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(out.passthrough).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
    expect(longEdge(out.width, out.height)).toBe(1568);
    expect(longEdge(out.width, out.height)).toBeGreaterThanOrEqual(1200);
    expect(out.bytes).toBeLessThan(400 * 1024);
    expect(out.bytes).toBeLessThan(source.length);
    const sent = Buffer.from(out.imageBase64, 'base64');
    expect(sent.includes(Buffer.from('Exif'))).toBe(false);
    expect(sent.length).toBe(out.bytes);
  });

  it('recompresses a shrink at JPEG_QUALITY', () => {
    expect(prep.JPEG_QUALITY).toBe(80);
    const source = jpegOf(1800, 1200, 90);
    const spy = jest.spyOn(jpeg, 'encode');
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64') });
    expect(out.passthrough).toBe(false);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe(prep.JPEG_QUALITY);
    expect(spy.mock.calls[0][1]).toBe(80);
  });

  it('leaves a small image byte-for-byte untouched', () => {
    const source = jpegOf(320, 240, 80);
    const b64 = source.toString('base64');
    const out = prep.prepareReceiptImage({ imageBase64: b64, mimeType: 'image/jpeg' });
    expect(out.passthrough).toBe(true);
    expect(out.imageBase64).toBe(b64);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
    expect(out.bytes).toBe(source.length);
  });

  it('strips Exif and GPS before a small photo is sent to the provider', () => {
    const plain = jpegOf(320, 240, 80);
    const payload = Buffer.concat([
      Buffer.from('Exif\0\0', 'ascii'),
      Buffer.from('GPSLatitudeREF', 'ascii'),
    ]);
    const seg = Buffer.alloc(4 + payload.length);
    seg[0] = 0xff;
    seg[1] = 0xe1;
    seg.writeUInt16BE(payload.length + 2, 2);
    payload.copy(seg, 4);
    const tagged = Buffer.concat([plain.subarray(0, 2), seg, plain.subarray(2)]);
    expect(tagged.includes(Buffer.from('Exif'))).toBe(true);
    expect(tagged.includes(Buffer.from('GPSLatitude'))).toBe(true);
    const out = prep.prepareReceiptImage({ imageBase64: tagged.toString('base64'), mimeType: 'image/jpeg' });
    const sent = Buffer.from(out.imageBase64, 'base64');
    expect(sent.includes(Buffer.from('Exif'))).toBe(false);
    expect(sent.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(sent.includes(Buffer.from([0xff, 0xe1]))).toBe(false);
    expect(sent.equals(plain)).toBe(true);
    const decoded = jpeg.decode(sent, { useTArray: true, formatAsRGBA: true });
    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(240);
  });

  it('keeps a tall strip above the 1568 cap so the short edge stays readable', () => {
    const source = jpegOf(400, 2400, 75, () => [30, 30, 30]);
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64') });
    expect(out.passthrough).toBe(false);
    expect(out.width).toBeGreaterThanOrEqual(380);
    expect(out.height).toBeGreaterThan(1568);
    expect(longEdge(out.width, out.height)).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
    expect(longEdge(out.width, out.height)).toBeLessThanOrEqual(prep.THIN_EDGE);
    const crushed = Math.round(400 * prep.MAX_EDGE / 2400);
    expect(out.width).toBeGreaterThan(crushed);
  });

  it('tiles a very tall strip instead of crushing the short edge under 3000px', () => {
    const source = jpegOf(100, 3200, 70, () => [40, 40, 40]);
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64') });
    const crushed = Math.round(100 * prep.THIN_EDGE / 3200);
    expect(out.passthrough).toBe(false);
    expect(out.width).toBeGreaterThan(crushed);
    expect(out.width).toBeGreaterThanOrEqual(100);
    expect(out.height).toBeGreaterThan(prep.MAX_EDGE);
    expect(longEdge(out.width, out.height)).toBeLessThanOrEqual(prep.THIN_EDGE);
    expect(longEdge(out.width, out.height)).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
  });

  it('shrinks an 8000x6000 jpeg instead of refusing it, and stays under a sane RSS', () => {
    const small = dcJpeg(32, 16, 400, -400);
    const reference = jpeg.decode(small, { useTArray: true, formatAsRGBA: true });
    expect(reference.width).toBe(32);
    expect(reference.data[0]).toBeGreaterThan(reference.data[16 * 4] + 40);

    const source = dcJpeg(8000, 6000, 400, -400);
    expect(source.length).toBeLessThan(prep.MAX_UPLOAD_BYTES);
    const meta = prep.jpegMeta(source);
    expect(meta.width * meta.height).toBe(48_000_000);
    prep.resetPeakRssForTests();
    const before = process.memoryUsage().rss;
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64'), mimeType: 'image/jpeg' });
    const peak = Math.max(prep.peakRssForTests(), process.memoryUsage().rss);
    expect(out.passthrough).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.width).toBe(2400);
    expect(out.height).toBe(1800);
    expect(longEdge(out.width, out.height)).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
    const sent = Buffer.from(out.imageBase64, 'base64');
    expect(sent.includes(Buffer.from('Exif'))).toBe(false);
    const decoded = jpeg.decode(sent, { useTArray: true, formatAsRGBA: true });
    expect(decoded.width).toBe(2400);
    expect(decoded.height).toBe(1800);
    const left = decoded.data[8 * 4];
    const right = decoded.data[(decoded.width - 8) * 4];
    expect(left).toBeGreaterThan(right + 20);
    expect(peak - before).toBeLessThan(200 * 1024 * 1024);
  }, 30000);

  it('passes a tiny png through and turns a large png into a smaller jpeg', () => {
    const tiny = prep.prepareReceiptImage({
      imageBase64: TINY_PNG.toString('base64'),
      mimeType: 'image/png',
    });
    expect(tiny.passthrough).toBe(true);
    expect(tiny.mimeType).toBe('image/png');
    expect(tiny.imageBase64).toBe(TINY_PNG.toString('base64'));

    const png = new PNG({ width: 1700, height: 80 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const i = (y * png.width + x) * 4;
        png.data[i] = x % 255;
        png.data[i + 1] = y % 255;
        png.data[i + 2] = 80;
        png.data[i + 3] = 255;
      }
    }
    const raw = PNG.sync.write(png);
    const out = prep.prepareReceiptImage({
      imageBase64: raw.toString('base64'),
      mimeType: 'image/png',
    });
    expect(out.passthrough).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
    // 1700x80 is thin, so the long edge stays under the 3000 cap instead of being crushed to 1568.
    expect(longEdge(out.width, out.height)).toBe(1700);
    expect(out.width).toBeGreaterThan(prep.MAX_EDGE);
    expect(out.width).toBeGreaterThan(out.height);
  });

  it('applies EXIF orientation and does not keep the orientation tag', () => {
    const source = withExif(jpegOf(4, 2, 90, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255])), 6);
    expect(prep.jpegMeta(source).orientation).toBe(6);
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64') });
    expect(out.passthrough).toBe(false);
    expect(out.width).toBe(2);
    expect(out.height).toBe(4);
    const pixels = jpeg.decode(Buffer.from(out.imageBase64, 'base64'), { formatAsRGBA: true, useTArray: true });
    const red = pixels.data[(0 * pixels.width + 1) * 4];
    const blue = pixels.data[(0 * pixels.width + 1) * 4 + 2];
    expect(red).toBeGreaterThan(200);
    expect(blue).toBeLessThan(40);
    expect(Buffer.from(out.imageBase64, 'base64').includes(Buffer.from('Exif'))).toBe(false);
  });

  it('rejects a corrupt image as unreadable and an oversized body as 413', () => {
    expect(() => prep.prepareReceiptImage({ imageBase64: Buffer.from('not a receipt').toString('base64') }))
      .toThrow(expect.objectContaining({ code: 'scan_unreadable', status: 422 }));
    expect(() => prep.prepareReceiptImage({ imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }))
      .toThrow(expect.objectContaining({ status: 422 }));
    const huge = 'A'.repeat(Math.floor(prep.MAX_UPLOAD_BYTES * 4 / 3) + 8);
    expect(() => prep.prepareReceiptImage({ imageBase64: huge }))
      .toThrow(expect.objectContaining({ status: 413, message: prep.TOO_LARGE_MESSAGE }));
  });
});

describe('receipt scan upload and vision payload', () => {
  const app = require('./server.js');
  const receiptRouter = require('./receipt-scanner');
  const storage = require('./server/storage');
  const aiUsage = require('./lib/ai-usage');
  let previousJwt;

  function token() {
    return jwt.sign({ userId: 'u-image-prep' }, process.env.JWT_SECRET);
  }

  beforeEach(() => {
    previousJwt = process.env.JWT_SECRET;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    jest.spyOn(storage, 'getUserById').mockResolvedValue({
      subscriptionTier: 'premium',
      settings: { aiDataConsent: true },
    });
    jest.spyOn(aiUsage, 'checkAndConsume').mockResolvedValue({ allowed: true, remaining: null });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    receiptRouter._setVisionForTests(null);
    if (previousJwt == null) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    jest.restoreAllMocks();
    if (typeof aiUsage._endPoolForTests === 'function') await aiUsage._endPoolForTests();
  });

  it('sends the downscaled bytes to the vision provider', async () => {
    const source = jpegOf(2200, 1600, 95);
    let seen = null;
    receiptRouter._setVisionForTests(async (opts) => {
      seen = opts;
      return { ok: true, text: JSON.stringify([{ name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' }]) };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', source, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(seen).toBeTruthy();
    expect(seen.mimeType).toBe('image/jpeg');
    const sent = Buffer.from(seen.imageBase64, 'base64');
    expect(sent.length).toBeLessThan(source.length);
    expect(sent.length).toBeLessThan(400 * 1024);
    const decoded = jpeg.decode(sent, { formatAsRGBA: true, useTArray: true });
    expect(longEdge(decoded.width, decoded.height)).toBe(1568);
  });

  it('passes a small photo through to the provider untouched', async () => {
    const source = jpegOf(320, 240, 80);
    let seen = null;
    receiptRouter._setVisionForTests(async (opts) => {
      seen = opts;
      return { ok: true, text: JSON.stringify([{ name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' }]) };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', source, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(seen.imageBase64).toBe(source.toString('base64'));
    expect(seen.mimeType).toBe('image/jpeg');
  });

  it('returns the 422 unreadable path for a corrupt image and does not call vision', async () => {
    let calls = 0;
    receiptRouter._setVisionForTests(async () => {
      calls += 1;
      return { ok: true, text: '[]' };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', Buffer.from('this is not a photo'), { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    });
    expect(calls).toBe(0);
  });

  it('returns 413 with a friendly message when the upload is over the cap', async () => {
    let calls = 0;
    receiptRouter._setVisionForTests(async () => {
      calls += 1;
      return { ok: true, text: '[]' };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', Buffer.alloc(prep.MAX_UPLOAD_BYTES + 1, 1), { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: prep.TOO_LARGE_MESSAGE });
    expect(calls).toBe(0);
  });

  it('turns a JSON body over the parser limit into the same 413 message', async () => {
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(15 * 1024 * 1024 + 2048, 0x7b));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: prep.TOO_LARGE_MESSAGE });
  }, 20000);

  it('surfaces a second-provider 429 as 503 with Retry-After', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: false,
      code: 'unavailable',
      error: 'provider_error',
      provider: 'openai',
      status: 429,
      errorClass: 'rate_limited',
      diag: {
        counts: { xai: { none: 1 }, openai: { '429': 1 } },
        lastErrorClass: 'rate_limited',
        p50Ms: 14000,
      },
    }));
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body).toEqual({
      success: false,
      error: 'Scanning is unavailable right now.',
    });
    expect(res.body.scanDiag).toBeUndefined();
  });
});

describe('xAI vision request and network retry', () => {
  const ORIG = { ...process.env };

  function clearKeys() {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROK_VISION_MODEL;
    delete process.env.GROK_CHAT_MODEL;
    delete process.env.DATABASE_URL;
  }

  function installHttps(handler) {
    const https = require('https');
    const calls = [];
    jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
      const chunks = [];
      const handlers = {};
      const req = {
        on(event, fn) {
          handlers[event] = fn;
          return req;
        },
        write(chunk) { chunks.push(Buffer.from(chunk)); },
        end() {
          const body = Buffer.concat(chunks).toString('utf8');
          calls.push({ hostname: opts.hostname, timeout: opts.timeout, body: JSON.parse(body) });
          const outcome = handler(calls[calls.length - 1], calls.length);
          if (outcome && outcome.network) {
            const err = new Error('socket hang up');
            err.code = 'ECONNRESET';
            if (handlers.error) handlers.error(err);
            return;
          }
          if (outcome && outcome.timeout) {
            if (handlers.timeout) handlers.timeout();
            return;
          }
          const res = {
            statusCode: outcome.status,
            on(event, fn) {
              if (event === 'data') fn(Buffer.from(JSON.stringify(outcome.body || {})));
              if (event === 'end') fn();
            },
          };
          cb(res);
        },
        destroy() {},
        setTimeout() {},
      };
      return req;
    });
    return calls;
  }

  function answer(text) {
    return {
      status: 200,
      body: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    };
  }

  async function closePools() {
    const usage = require('./lib/ai-usage');
    const migrate = require('./lib/db-migrate');
    if (typeof usage._endPoolForTests === 'function') await usage._endPoolForTests();
    if (typeof migrate._endPoolForTests === 'function') await migrate._endPoolForTests();
  }

  afterEach(async () => {
    process.env = { ...ORIG };
    jest.restoreAllMocks();
    jest.resetModules();
    await closePools();
  });

  it('asks grok-4.3 for detail high and no reasoning, and uses the first-provider budget', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps(() => answer('[{"name":"Milk"}]'));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('xai');
    expect(calls).toHaveLength(1);
    expect(calls[0].timeout).toBe(ai.visionFirstTimeoutMs());
    expect(calls[0].body.model).toBe('grok-4.3');
    expect(calls[0].body.reasoning_effort).toBe('none');
    expect(calls[0].body.response_format).toBeUndefined();
    expect(calls[0].body.max_tokens).toBe(2000);
    const part = calls[0].body.messages[0].content[1];
    expect(part.type).toBe('image_url');
    expect(part.image_url.detail).toBe('high');
    expect(part.image_url.url).toBe('data:image/jpeg;base64,aa');
  });

  it('omits reasoning_effort on a model id that is not grok-4.3', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.GROK_VISION_MODEL = 'grok-4';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps(() => answer('[{"name":"Milk"}]'));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    await ai.vision({ imageBase64: 'aa', prompt: 'read' });
    expect(calls[0].body.model).toBe('grok-4');
    expect(calls[0].body.reasoning_effort).toBeUndefined();
    expect(calls[0].body.messages[0].content[1].image_url.detail).toBe('high');
  });

  it('retries one xAI network error quickly when time remains, then fails over', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const diag = require('./lib/vision-diag');
    diag._resetForTests();
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { network: true };
      return answer('[{"name":"Oats"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(calls.map((c) => c.hostname)).toEqual(['api.x.ai', 'api.x.ai', 'api.openai.com']);
    expect(calls[0].timeout).toBe(ai.visionFirstTimeoutMs());
    expect(calls[1].timeout).toBe(ai.XAI_QUICK_RETRY_MS);
    expect(calls[2].timeout).toBe(20000);
    expect(calls[2].body.messages[0].content[1].image_url.detail).toBe('high');
    expect(calls[2].body.reasoning_effort).toBeUndefined();
    const rows = diag._attemptsForTests();
    expect(rows.map((row) => row.provider)).toEqual(['xai', 'xai', 'openai']);
    expect(rows[0].status).toBeNull();
    expect(rows[0].errorClass).toBe('network');
    expect(rows[1].errorClass).toBe('network');
  });

  it('does not retry an xAI network error when the first-provider budget is already spent', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') {
        now += ai.visionFirstTimeoutMs() - 1000;
        return { network: true };
      }
      return answer('[{"name":"Oats"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.hostname)).toEqual(['api.x.ai', 'api.openai.com']);
    expect(calls[0].timeout).toBe(ai.visionFirstTimeoutMs());
    expect(calls[1].timeout).toBe(20000);
  });

  it('records an OpenAI 429 and reports it as unavailable', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const diag = require('./lib/vision-diag');
    diag._resetForTests();
    installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { network: true };
      return { status: 429, body: { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'slow down' } } };
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result).toMatchObject({
      ok: false,
      code: 'unavailable',
      status: 429,
      provider: 'openai',
      errorClass: 'rate_limited',
    });
    const view = diag.summary();
    expect(view.counts.xai.none).toBe(2);
    expect(view.counts.openai['429']).toBe(1);
    expect(view.lastErrorClass).toBe('rate_limited');
    expect(JSON.stringify(diag._attemptsForTests())).not.toMatch(/slow down|xai-test|sk-test/);
  });

  it('still cuts a hung xAI call at the first-provider budget without a second try', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { timeout: true };
      return answer('[{"name":"Rice"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(calls.map((c) => [c.hostname, c.timeout])).toEqual([
      ['api.x.ai', ai.visionFirstTimeoutMs()],
      ['api.openai.com', 20000],
    ]);
  });
});
