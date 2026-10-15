'use strict';
/**
 * Shrink a receipt photo before it is sent to a vision provider.
 *
 * Phone uploads are often a full-frame JPEG (3-12MB). This keeps an ordinary
 * photo's long edge at most 1568px, raises that to 2400px when the source is
 * already that large, and to 3000px (or a side-by-side tile) for a tall or
 * thin receipt so the short edge stays legible. Output is JPEG quality 80.
 * EXIF, including GPS, is removed on every path, including a small photo that
 * is not recompressed. A small PNG also drops tEXt, iTXt, zTXt, and eXIf
 * chunks. The long edge is never taken below 1200px when the source was at
 * least that large, and a small photo is not enlarged.
 *
 * Frames jpeg-js cannot hold are decoded at a reduced scale, and at most two
 * of those large decodes run at once in this process. A third waits, and
 * gives up if that wait would run past the request budget.
 *
 * sharp is not a dependency, so this is pure JS (jpeg-js, pngjs, and a
 * streaming baseline decoder for frames jpeg-js cannot hold in memory).
 */

const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const jpegScale = require('./jpeg-scale');

const MAX_EDGE = 1568;
const LARGE_EDGE = 2400;
const THIN_EDGE = 3000;
const THIN_RATIO = 2;
const MIN_LEGIBLE_EDGE = 1200;
const JPEG_QUALITY = 80;
// jpeg-js stores 256 bytes of coefficients per 8x8 block per component.
// Past this estimate we decode at a reduced scale instead of letting that
// allocation fail the request.
const JPEG_JS_BYTE_BUDGET = 200 * 1024 * 1024;
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

/**
 * Drop every APP1 segment (EXIF, GPS, XMP), including one that sits after
 * the SOS marker. FF 00 in the entropy stream is a stuffed byte, not a
 * marker, and restart markers are left in place. The entropy-coded image
 * is kept, so an upright photo stays byte-identical apart from those
 * segments. Returns the same buffer when there is no APP1.
 */
function stripApp1Entropy(buf) {
  const parts = [];
  let i = 0;
  let removed = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      let j = i + 1;
      while (j < buf.length && buf[j] !== 0xff) j += 1;
      parts.push(buf.subarray(i, j));
      i = j;
      continue;
    }
    let p = i;
    while (p + 1 < buf.length && buf[p] === 0xff && buf[p + 1] === 0xff) p += 1;
    if (p + 1 >= buf.length) {
      parts.push(buf.subarray(i));
      break;
    }
    const marker = buf[p + 1];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(i, p + 2));
      i = p + 2;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(buf.subarray(i));
      break;
    }
    if (p + 3 >= buf.length) {
      parts.push(buf.subarray(i));
      break;
    }
    const len = buf.readUInt16BE(p + 2);
    const segEnd = p + 2 + len;
    if (len < 2 || segEnd > buf.length) {
      parts.push(buf.subarray(i));
      break;
    }
    if (marker === 0xe1) {
      removed = true;
      i = segEnd;
    } else {
      parts.push(buf.subarray(i, segEnd));
      i = segEnd;
    }
  }
  if (!removed) return buf;
  return Buffer.concat(parts);
}

function stripJpegApp1(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts = [buf.subarray(0, 2)];
  let offset = 2;
  let removed = false;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) {
      parts.push(buf.subarray(offset));
      break;
    }
    let p = offset;
    while (p + 1 < buf.length && buf[p] === 0xff && buf[p + 1] === 0xff) p += 1;
    if (buf[p] !== 0xff || p + 1 >= buf.length) {
      parts.push(buf.subarray(offset));
      break;
    }
    const marker = buf[p + 1];
    if (marker === 0xd9) {
      parts.push(buf.subarray(offset));
      break;
    }
    if (marker === 0xda) {
      if (p + 3 >= buf.length) {
        parts.push(buf.subarray(offset));
        break;
      }
      const len = buf.readUInt16BE(p + 2);
      const segEnd = p + 2 + len;
      if (len < 2 || segEnd > buf.length) {
        parts.push(buf.subarray(offset));
        break;
      }
      parts.push(buf.subarray(offset, segEnd));
      const entropy = buf.subarray(segEnd);
      const tail = stripApp1Entropy(entropy);
      if (tail !== entropy) removed = true;
      parts.push(tail);
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(buf.subarray(offset, p + 2));
      offset = p + 2;
      continue;
    }
    if (p + 3 >= buf.length) {
      parts.push(buf.subarray(offset));
      break;
    }
    const len = buf.readUInt16BE(p + 2);
    const segEnd = p + 2 + len;
    if (len < 2 || segEnd > buf.length) {
      parts.push(buf.subarray(offset));
      break;
    }
    if (marker === 0xe1) {
      removed = true;
      offset = segEnd;
    } else {
      parts.push(buf.subarray(offset, segEnd));
      offset = segEnd;
    }
  }
  if (!removed) return buf;
  return Buffer.concat(parts);
}

const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);

/** Drop PNG text and eXIf chunks. Returns the same buffer when none are present. */
function stripPngText(buf) {
  if (!buf || buf.length < 8) return buf;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return buf;
  const parts = [buf.subarray(0, 8)];
  let offset = 8;
  let removed = false;
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    if (len > buf.length - offset - 12) break;
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + len;
    if (PNG_TEXT_CHUNKS.has(type)) removed = true;
    else parts.push(buf.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  if (offset < buf.length) parts.push(buf.subarray(offset));
  if (!removed) return buf;
  return Buffer.concat(parts);
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
 * Long edge after a shrink. Photos already under 1568 stay as they are
 * (including ones under 1200px: we do not enlarge). A tall or thin frame
 * (long side at least twice the short side) may use 3000. A large but
 * squarer photo may use 2400. Anything in between still stops at 1568,
 * which stays above the 1200px floor.
 */
function targetLongEdge(longEdge, shortEdge) {
  const short = shortEdge == null ? longEdge : shortEdge;
  const ratio = short > 0 ? longEdge / short : 1;
  if (longEdge <= MAX_EDGE) return longEdge;
  if (ratio >= THIN_RATIO) return Math.min(longEdge, THIN_EDGE);
  if (longEdge >= LARGE_EDGE) return Math.min(longEdge, LARGE_EDGE);
  if (MAX_EDGE < MIN_LEGIBLE_EDGE) return Math.min(longEdge, MIN_LEGIBLE_EDGE);
  return MAX_EDGE;
}

/**
 * Lay a tall or thin frame into side-by-side strips so a 3000px cap does not
 * crush the short edge under the legible floor. scale is at most 1.
 */
function tileFrame(src, width, height, cap, floor) {
  const tall = height >= width;
  const long = tall ? height : width;
  const short = tall ? width : height;
  let chosen = null;
  for (let n = 2; n <= 16; n += 1) {
    const tileLong = Math.ceil(long / n);
    const across = short * n;
    const compLong = Math.max(across, tileLong);
    const compShort = Math.min(across, tileLong);
    const scale = Math.min(1, cap / compLong);
    if (compShort * scale + 0.01 >= floor) {
      chosen = { n, tileLong, scale };
      break;
    }
  }
  if (!chosen) {
    const scale = Math.min(1, cap / long);
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    return { data: resizeRGBA(src, width, height, dw, dh), width: dw, height: dh };
  }
  const { n, tileLong, scale } = chosen;
  let compW;
  let compH;
  let data;
  if (tall) {
    compW = width * n;
    compH = tileLong;
    data = Buffer.alloc(compW * compH * 4, 255);
    for (let i = 0; i < n; i += 1) {
      const y0 = i * tileLong;
      const rows = Math.min(tileLong, height - y0);
      if (rows <= 0) break;
      for (let row = 0; row < rows; row += 1) {
        const srcStart = (y0 + row) * width * 4;
        const dstStart = (row * compW + i * width) * 4;
        src.copy(data, dstStart, srcStart, srcStart + width * 4);
      }
    }
  } else {
    compW = tileLong;
    compH = height * n;
    data = Buffer.alloc(compW * compH * 4, 255);
    for (let i = 0; i < n; i += 1) {
      const x0 = i * tileLong;
      const cols = Math.min(tileLong, width - x0);
      if (cols <= 0) break;
      for (let row = 0; row < height; row += 1) {
        const srcStart = (row * width + x0) * 4;
        const dstStart = (i * height + row) * compW * 4;
        src.copy(data, dstStart, srcStart, srcStart + cols * 4);
      }
    }
  }
  if (scale >= 0.999) return { data, width: compW, height: compH };
  const dw = Math.max(1, Math.round(compW * scale));
  const dh = Math.max(1, Math.round(compH * scale));
  return { data: resizeRGBA(data, compW, compH, dw, dh), width: dw, height: dh };
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

function jpegCoeffBytes(width, height) {
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  return blocks * 3 * 256 + width * height * 4;
}

/** Largest 8/4/2 shrink whose long edge still covers the target. */
function chooseDivisor(width, height, targetLong) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const shortFloor = Math.min(short, MIN_LEGIBLE_EDGE);
  for (const d of [8, 4, 2]) {
    if (Math.ceil(long / d) >= targetLong && Math.ceil(short / d) >= shortFloor) return d;
  }
  for (const d of [2, 4, 8]) {
    if (Math.ceil(short / d) >= shortFloor) return d;
  }
  return 2;
}

// Three overlapping 48MP decodes peak near 1029MB. Two slots stay under the
// 1024MB function. Further calls wait in this process, and only until the
// request budget, then the scan fails instead of starting another frame.
const LARGE_DECODE_SLOTS = 2;
const LARGE_DECODE_WAIT_MS = 2000;
let largeInFlight = 0;
const largeQueue = [];

function releaseLargeDecode() {
  const next = largeQueue.shift();
  if (next) {
    next.clear();
    next.grant();
    return;
  }
  largeInFlight -= 1;
  if (largeInFlight < 0) largeInFlight = 0;
}

function queueExpiredError() {
  const err = new Error('scan_unavailable');
  err.code = 'scan_unavailable';
  err.status = 503;
  return err;
}

function acquireLargeDecode(budgetMs) {
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : LARGE_DECODE_WAIT_MS;
  if (largeInFlight < LARGE_DECODE_SLOTS) {
    largeInFlight += 1;
    return Promise.resolve(releaseLargeDecode);
  }
  return new Promise((resolve, reject) => {
    const entry = {
      grant() { resolve(releaseLargeDecode); },
      rejectExpired() { reject(queueExpiredError()); },
      timer: null,
      clear() { clearTimeout(entry.timer); },
    };
    entry.timer = setTimeout(() => {
      const i = largeQueue.indexOf(entry);
      if (i < 0) return;
      largeQueue.splice(i, 1);
      entry.rejectExpired();
    }, budget);
    largeQueue.push(entry);
  });
}

async function runWithLargeDecode(work, budgetMs) {
  const release = await acquireLargeDecode(budgetMs);
  try {
    return await work();
  } finally {
    release();
  }
}

function decodeJpeg(buf, meta, targetLong, budgetMs) {
  const heavy = jpegCoeffBytes(meta.width, meta.height) > JPEG_JS_BYTE_BUDGET;
  if (!heavy) {
    try {
      const raw = jpeg.decode(buf, {
        useTArray: true,
        formatAsRGBA: true,
        maxMemoryUsageInMB: 512,
        maxResolutionInMP: 60,
      });
      if (!raw || !raw.width || !raw.height || !raw.data) throw unreadableError();
      return { data: Buffer.from(raw.data), width: raw.width, height: raw.height };
    } catch (err) {
      if (err && (err.status === 422 || err.status === 413)) throw err;
      const msg = String((err && err.message) || '');
      if (!/maxMemoryUsageInMB|maxResolutionInMP|memory/i.test(msg)) throw err;
    }
  }
  const divisor = chooseDivisor(meta.width, meta.height, targetLong || Math.max(meta.width, meta.height));
  return runWithLargeDecode(async () => {
    const raw = await jpegScale.decodeScaledJpeg(buf, divisor);
    if (!raw || !raw.width || !raw.height || !raw.data) throw unreadableError();
    jpegScale.noteRss();
    return raw;
  }, budgetMs);
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
 * @param {{ imageBase64?: string, mimeType?: string, budgetMs?: number }} input
 * @returns {Promise<{ imageBase64: string, mimeType: string, width: number, height: number, bytes: number, passthrough: boolean }>}
 */
async function prepareReceiptImage(input) {
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
  const shortEdge = Math.min(oriented.width, oriented.height);
  const upright = !meta.orientation || meta.orientation === 1;
  if (upright && longEdge <= MAX_EDGE && buf.length <= PASS_THROUGH_BYTES) {
    if (kind === 'jpeg') {
      const stripped = stripJpegApp1(buf);
      if (stripped !== buf) {
        return {
          imageBase64: stripped.toString('base64'),
          mimeType: 'image/jpeg',
          width: meta.width,
          height: meta.height,
          bytes: stripped.length,
          passthrough: false,
        };
      }
    } else if (kind === 'png') {
      const stripped = stripPngText(buf);
      if (stripped !== buf) {
        return {
          imageBase64: stripped.toString('base64'),
          mimeType: 'image/png',
          width: meta.width,
          height: meta.height,
          bytes: stripped.length,
          passthrough: false,
        };
      }
    }
    return {
      imageBase64: cleaned,
      mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
      width: meta.width,
      height: meta.height,
      bytes: buf.length,
      passthrough: true,
    };
  }

  const planLong = targetLongEdge(longEdge, shortEdge);
  let raw;
  try {
    raw = kind === 'jpeg'
      ? await decodeJpeg(buf, meta, planLong, input && input.budgetMs)
      : decodePng(buf);
  } catch (err) {
    if (err && (err.status === 413 || err.status === 422)) throw err;
    throw unreadableError();
  }

  let frame = applyOrientation(raw.data, raw.width, raw.height, meta.orientation || 1);
  const frameLong = Math.max(frame.width, frame.height);
  const frameShort = Math.min(frame.width, frame.height);
  const cap = targetLongEdge(frameLong, frameShort);
  const ratio = frameShort > 0 ? frameLong / frameShort : 1;
  const scale = frameLong > cap ? cap / frameLong : 1;
  const floor = Math.min(frameShort, MIN_LEGIBLE_EDGE);
  if (ratio >= THIN_RATIO && scale < 1 && frameShort * scale < floor - 0.01) {
    frame = tileFrame(frame.data, frame.width, frame.height, cap, floor);
  } else if (scale < 1) {
    const dw = Math.max(1, Math.round(frame.width * scale));
    const dh = Math.max(1, Math.round(frame.height * scale));
    frame = {
      data: resizeRGBA(frame.data, frame.width, frame.height, dw, dh),
      width: dw,
      height: dh,
    };
  }
  jpegScale.noteRss();
  const out = encodeJpeg(frame.data, frame.width, frame.height);
  jpegScale.noteRss();
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
  LARGE_EDGE,
  THIN_EDGE,
  THIN_RATIO,
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
  stripJpegApp1,
  stripPngText,
  LARGE_DECODE_SLOTS,
  LARGE_DECODE_WAIT_MS,
  runWithLargeDecode,
  resetLargeDecodeForTests() {
    while (largeQueue.length) {
      const entry = largeQueue.shift();
      entry.clear();
      entry.rejectExpired();
    }
    largeInFlight = 0;
  },
  largeDecodeInFlightForTests() {
    return largeInFlight;
  },
  resetPeakRssForTests: jpegScale.resetPeakRss,
  peakRssForTests: jpegScale.peakRssBytes,
};
