'use strict';
/**
 * Shrink a receipt photo before it is sent to a vision provider.
 *
 * Phone uploads are often a full-frame JPEG (3-12MB). That payload is what
 * makes the xAI vision call hit the 12s cut with no HTTP status. This keeps
 * the long edge at most 1568px (never below 1200px when the source is larger),
 * recompresses to JPEG quality 80, and drops EXIF. A photo that is already
 * small is returned unchanged.
 *
 * sharp is not a dependency, so this is pure JS (jpeg-js and pngjs).
 */

const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const MAX_EDGE = 1568;
const MIN_LEGIBLE_EDGE = 1200;
const JPEG_QUALITY = 80;
// Already-small uploads are not re-encoded. Re-encoding softens receipt text.
const PASS_THROUGH_BYTES = 600 * 1024;
// Decoded upload cap. Larger than a normal phone photo, small enough to reject
// a body that would blow the function memory before we can shrink it.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
// A 48MP phone frame is about 48.8 million pixels. Anything past that is refused.
const MAX_PIXELS = 52_000_000;

const TOO_LARGE_MESSAGE = 'Photo is too large. Retake closer so the receipt fills the frame.';

function unreadableError() {
  const err = new Error('scan_unreadable');
  err.code = 'scan_unreadable';
  err.status = 422;
  return err;
}

function tooLargeError() {
  const err = new Error(TOO_LARGE_MESSAGE);
  err.code = 'payload_too_large';
  err.status = 413;
  return err;
}

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  return '';
}

function u16(buf, offset, le) {
  return le ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}

function u32(buf, offset, le) {
  return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

/** EXIF orientation 1-8, or 0 when the segment is not EXIF. */
function orientationFromExif(payload) {
  if (!payload || payload.length < 16) return 0;
  if (payload.slice(0, 6).toString('ascii') !== 'Exif\0\0') return 0;
  const tiff = payload.subarray(6);
  if (tiff.length < 8) return 0;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!le && !be) return 0;
  if (u16(tiff, 2, le) !== 42) return 0;
  let ifd = u32(tiff, 4, le);
  if (ifd < 0 || ifd + 2 > tiff.length) return 0;
  const count = u16(tiff, ifd, le);
  ifd += 2;
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + n * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(tiff, entry, le) !== 0x0112) continue;
    const value = u16(tiff, entry + 8, le);
    return value >= 1 && value <= 8 ? value : 0;
  }
  return 0;
}

/**
 * Width, height, and EXIF orientation from the JPEG header. Null when the
 * frame size cannot be read (the caller treats that as unreadable).
 */
function jpegMeta(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const len = buf.readUInt16BE(offset + 2);
    if (len < 2 || offset + 2 + len > buf.length) break;
    if (marker === 0xda) break;
    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && len >= 7) {
      height = buf.readUInt16BE(offset + 5);
      width = buf.readUInt16BE(offset + 7);
    } else if (marker === 0xe1) {
      const found = orientationFromExif(buf.subarray(offset + 4, offset + 2 + len));
      if (found) orientation = found;
    }
    offset += 2 + len;
  }
  if (!width || !height) return null;
  return { width, height, orientation };
}

function pngMeta(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.slice(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > 100000 || height > 100000) return null;
  return { width, height, orientation: 1 };
}

function orientedSize(width, height, orientation) {
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
  return { width, height };
}

function applyOrientation(src, width, height, orientation) {
  if (!orientation || orientation === 1) return { data: src, width, height };
  const swaps = orientation >= 5 && orientation <= 8;
  const dw = swaps ? height : width;
  const dh = swaps ? width : height;
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nx = x;
      let ny = y;
      if (orientation === 2) nx = width - 1 - x;
      else if (orientation === 3) { nx = width - 1 - x; ny = height - 1 - y; }
      else if (orientation === 4) ny = height - 1 - y;
      else if (orientation === 5) { nx = y; ny = x; }
      else if (orientation === 6) { nx = height - 1 - y; ny = x; }
      else if (orientation === 7) { nx = height - 1 - y; ny = width - 1 - x; }
      else if (orientation === 8) { nx = y; ny = width - 1 - x; }
      const si = (y * width + x) * 4;
      const di = (ny * dw + nx) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return { data: dst, width: dw, height: dh };
}

/**
 * Long edge after a shrink. Photos already under the cap stay as they are
 * (including ones under 1200px: we do not enlarge). A larger photo is brought
 * down to MAX_EDGE, which stays above the 1200px floor.
 */
function targetLongEdge(longEdge) {
  if (longEdge <= MAX_EDGE) return longEdge;
  if (MAX_EDGE < MIN_LEGIBLE_EDGE) return Math.min(longEdge, MIN_LEGIBLE_EDGE);
  return MAX_EDGE;
}

function fitSize(width, height) {
  const longEdge = Math.max(width, height);
  const target = targetLongEdge(longEdge);
  if (target === longEdge) return { width, height };
  const scale = target / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function resizeRGBA(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const y0 = Math.min(sh - 1, Math.floor(y * scaleY));
    let y1 = Math.min(sh, Math.floor((y + 1) * scaleY));
    if (y1 <= y0) y1 = Math.min(sh, y0 + 1);
    for (let x = 0; x < dw; x += 1) {
      const x0 = Math.min(sw - 1, Math.floor(x * scaleX));
      let x1 = Math.min(sw, Math.floor((x + 1) * scaleX));
      if (x1 <= x0) x1 = Math.min(sw, x0 + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx += 1) {
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n += 1;
          i += 4;
        }
      }
      const o = (y * dw + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = Math.round(a / n);
    }
  }
  return dst;
}

function decodeJpeg(buf) {
  const raw = jpeg.decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 512,
    maxResolutionInMP: 60,
  });
  if (!raw || !raw.width || !raw.height || !raw.data) throw unreadableError();
  return { data: Buffer.from(raw.data), width: raw.width, height: raw.height };
}

function decodePng(buf) {
  const png = PNG.sync.read(buf);
  if (!png || !png.width || !png.height || !png.data) throw unreadableError();
  return { data: Buffer.from(png.data), width: png.width, height: png.height };
}

function encodeJpeg(data, width, height) {
  const encoded = jpeg.encode({ data, width, height }, JPEG_QUALITY);
  return Buffer.from(encoded.data);
}

/**
 * @param {{ imageBase64?: string, mimeType?: string }} input
 * @returns {{ imageBase64: string, mimeType: string, width: number, height: number, bytes: number, passthrough: boolean }}
 */
function prepareReceiptImage(input) {
  const cleaned = String((input && input.imageBase64) || '').replace(/\s+/g, '');
  if (!cleaned) throw unreadableError();
  const approx = Math.floor((cleaned.length * 3) / 4);
  if (approx > MAX_UPLOAD_BYTES) throw tooLargeError();
  let buf;
  try {
    buf = Buffer.from(cleaned, 'base64');
  } catch (_) {
    throw unreadableError();
  }
  if (!buf.length) throw unreadableError();
  if (buf.length > MAX_UPLOAD_BYTES) throw tooLargeError();

  const kind = sniff(buf);
  if (!kind) throw unreadableError();
  const meta = kind === 'jpeg' ? jpegMeta(buf) : pngMeta(buf);
  if (!meta) throw unreadableError();
  const oriented = orientedSize(meta.width, meta.height, meta.orientation);
  if (oriented.width * oriented.height > MAX_PIXELS) throw tooLargeError();

  const longEdge = Math.max(oriented.width, oriented.height);
  const upright = !meta.orientation || meta.orientation === 1;
  if (upright && longEdge <= MAX_EDGE && buf.length <= PASS_THROUGH_BYTES) {
    return {
      imageBase64: cleaned,
      mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
      width: meta.width,
      height: meta.height,
      bytes: buf.length,
      passthrough: true,
    };
  }

  let raw;
  try {
    raw = kind === 'jpeg' ? decodeJpeg(buf) : decodePng(buf);
  } catch (err) {
    if (err && (err.status === 413 || err.status === 422)) throw err;
    const msg = String(err && err.message || '');
    if (/maxMemoryUsageInMB|maxResolutionInMP/i.test(msg)) throw tooLargeError();
    throw unreadableError();
  }

  let frame = applyOrientation(raw.data, raw.width, raw.height, meta.orientation || 1);
  const fit = fitSize(frame.width, frame.height);
  if (fit.width !== frame.width || fit.height !== frame.height) {
    frame = {
      data: resizeRGBA(frame.data, frame.width, frame.height, fit.width, fit.height),
      width: fit.width,
      height: fit.height,
    };
  }
  const out = encodeJpeg(frame.data, frame.width, frame.height);
  const sentLong = Math.max(frame.width, frame.height);
  if (longEdge >= MIN_LEGIBLE_EDGE && sentLong < MIN_LEGIBLE_EDGE) {
    // fitSize is not supposed to land here. Refuse rather than send a blur.
    throw unreadableError();
  }
  return {
    imageBase64: out.toString('base64'),
    mimeType: 'image/jpeg',
    width: frame.width,
    height: frame.height,
    bytes: out.length,
    passthrough: false,
  };
}

module.exports = {
  MAX_EDGE,
  MIN_LEGIBLE_EDGE,
  JPEG_QUALITY,
  PASS_THROUGH_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_PIXELS,
  TOO_LARGE_MESSAGE,
  prepareReceiptImage,
  targetLongEdge,
  jpegMeta,
  orientationFromExif,
};
