/**
 * Inlined UUID v7 implementation (RFC 9562).
 * Sourced from uuid package to avoid ESM/resolve issues with Webpack 4.
 */

const byteToHex = [];
for (let i = 0; i < 256; i += 1) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

let getRandomValues;
const rnds8 = new Uint8Array(16);

function rng() {
  if (!getRandomValues) {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
      throw new Error(
        'crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported'
      );
    }
    getRandomValues = crypto.getRandomValues.bind(crypto);
  }
  return getRandomValues(rnds8);
}

const state = {};

function updateV7State(now, rnds) {
  state.msecs = state.msecs ?? -Infinity;
  state.seq = state.seq ?? 0;
  if (now > state.msecs) {
    state.seq = (rnds[6] << 23) | (rnds[7] << 16) | (rnds[8] << 8) | rnds[9];
    state.msecs = now;
  } else {
    state.seq = (state.seq + 1) | 0;
    if (state.seq === 0) {
      state.msecs += 1;
    }
  }
  return state;
}

function v7Bytes(rnds, msecs, seq, buf, offset = 0) {
  if (rnds.length < 16) {
    throw new Error('Random bytes length must be >= 16');
  }
  let out = buf;
  let outOffset = offset;
  if (!out) {
    out = new Uint8Array(16);
    outOffset = 0;
  } else if (outOffset < 0 || outOffset + 16 > out.length) {
    throw new RangeError(
      `UUID byte range ${outOffset}:${outOffset + 15} is out of buffer bounds`
    );
  }
  const m = msecs ?? Date.now();
  const s =
    seq ?? ((rnds[6] * 0x7f) << 24) | (rnds[7] << 16) | (rnds[8] << 8) | rnds[9];
  out[outOffset++] = (m / 0x10000000000) & 0xff;
  out[outOffset++] = (m / 0x100000000) & 0xff;
  out[outOffset++] = (m / 0x1000000) & 0xff;
  out[outOffset++] = (m / 0x10000) & 0xff;
  out[outOffset++] = (m / 0x100) & 0xff;
  out[outOffset++] = m & 0xff;
  out[outOffset++] = 0x70 | ((s >>> 28) & 0x0f);
  out[outOffset++] = (s >>> 20) & 0xff;
  out[outOffset++] = 0x80 | ((s >>> 14) & 0x3f);
  out[outOffset++] = (s >>> 6) & 0xff;
  out[outOffset++] = ((s << 2) & 0xff) | (rnds[10] & 0x03);
  out[outOffset++] = rnds[11];
  out[outOffset++] = rnds[12];
  out[outOffset++] = rnds[13];
  out[outOffset++] = rnds[14];
  out[outOffset++] = rnds[15];
  return out;
}

/**
 * Generate a UUID v7 string (time-ordered, RFC 9562).
 * @returns {string} UUID v7 string, e.g. "018f3a2b-7c3d-7000-8000-000000000000"
 */
export function uuidv7() {
  const now = Date.now();
  const rnds = rng();
  updateV7State(now, rnds);
  const bytes = v7Bytes(rnds, state.msecs, state.seq, null, 0);
  return unsafeStringify(bytes);
}

export default uuidv7;
