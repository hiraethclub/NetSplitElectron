'use strict';

// Generates build/icon.png (512x512) — a simple, original app icon:
// a dark rounded panel with an accent ring-and-dot echoing the app's
// "connections" glyph. No third-party branding. Run: node scripts/generate-icon.js
//
// Implements a tiny PNG encoder (truecolor+alpha) so no image libraries are
// needed in the build environment.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 512;

// Palette
const BG = [0x14, 0x16, 0x1b];        // near-black panel
const PANEL = [0x1e, 0x1e, 0x1e];     // slightly lighter inner panel
const ACCENT = [0x5b, 0x8d, 0xef];    // friendly blue

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Signed distance helpers for antialiased edges.
function coverage(dist, edge) {
  // dist < 0 inside; return 0..1 coverage across a 1.5px edge.
  return Math.max(0, Math.min(1, 0.5 - dist / edge));
}

function roundedRectDist(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
}

const px = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2, cy = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let rgb = BG;
    let alpha = 0;

    // Outer rounded panel (icon body).
    const panelDist = roundedRectDist(x + 0.5, y + 0.5, cx, cy, 236, 236, 108);
    const panelCov = coverage(panelDist, 2);
    if (panelCov > 0) {
      // subtle vertical gradient on the panel
      const t = y / SIZE;
      rgb = mix(PANEL, BG, t * 0.5);
      alpha = panelCov;
    }

    // Accent ring (outer radius 150, thickness ~34) + center dot (r 34).
    const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
    const ringDist = Math.abs(d - 150) - 17;   // ring band
    const ringCov = coverage(ringDist, 2);
    const dotCov = coverage(d - 34, 2);         // center dot
    const accentCov = Math.max(ringCov, dotCov) * (panelCov > 0 ? 1 : 0);
    if (accentCov > 0) {
      rgb = mix(rgb, ACCENT, accentCov);
      alpha = Math.max(alpha, accentCov);
    }

    const i = (y * SIZE + x) * 4;
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
    px[i + 3] = Math.round(alpha * 255);
  }
}

// --- Minimal PNG encoder ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// Filtered scanlines (filter byte 0 per row).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Wrote', out, `(${png.length} bytes, ${SIZE}x${SIZE})`);
