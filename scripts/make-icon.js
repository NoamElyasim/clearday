#!/usr/bin/env node
// Generates build/icon.png (512x512), the source icon electron-builder converts
// into .ico / .icns at package time. Kept as a script rather than a binary blob
// so the icon is editable and the repo stays text-only.
//
//   node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 3; // supersamples per axis — cheap antialiasing

// Rounded-box signed distance: negative inside, positive outside.
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function over(dst, src, a) {
  for (let i = 0; i < 3; i++) dst[i] = dst[i] * (1 - a) + src[i] * a;
  dst[3] = dst[3] * (1 - a) + a;
}

// A frosted tile holding three task rows: two filled with status colours,
// one waiting in grey with a red priority ring — the board in miniature.
const GRAD_TOP = [0x5B, 0x8D, 0xEF];
const GRAD_BOT = [0x2B, 0x4F, 0xB8];
const ROWS = [
  { y: 176, fill: [0x2E, 0x9E, 0x5B] },   // Done
  { y: 256, fill: [0xC2, 0x7C, 0x0E] },   // In Progress
  { y: 336, fill: [0x7C, 0x85, 0x91], ring: [0xFF, 0x45, 0x3A] }, // To Do, high priority
];
const WHITE = [0xFF, 0xFF, 0xFF];
// Inside the 824/1024 safe area macOS icons are drawn to.
const TILE_HALF = 206, TILE_R = 92;

const buf = Buffer.alloc(SIZE * SIZE * 4);
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const px = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS;
        const fy = y + (sy + 0.5) / SS;
        const s = [0, 0, 0, 0];

        const dTile = sdRoundBox(fx, fy, 256, 256, TILE_HALF, TILE_HALF, TILE_R);
        if (dTile < 1) {
          const t = (fy - 50) / 412;
          const c = GRAD_TOP.map((v, i) => v * (1 - t) + GRAD_BOT[i] * t);
          over(s, c, cover(dTile));
          // Glass sheen across the top third.
          const sheen = Math.max(0, 1 - Math.abs(fy - 120) / 90) ** 2 * 0.18;
          if (dTile < 0) over(s, WHITE, sheen);
        }

        for (const r of ROWS) {
          const dRow = sdRoundBox(fx, fy, 256, r.y, 150, 28, 28);
          over(s, r.fill, cover(dRow));
          // Round status button on the left, text line in white.
          const dBtn = Math.abs(Math.hypot(fx - 136, fy - r.y) - 11) - 3.5;
          over(s, WHITE, cover(dBtn) * 0.95);
          const dTxt = sdRoundBox(fx, fy, 214, r.y, 52, 6, 6);
          over(s, WHITE, cover(dTxt) * 0.9);
          if (r.ring) {
            const ringD = Math.hypot(fx - 368, fy - r.y);
            over(s, r.ring, Math.max(0, 1 - Math.abs(ringD - 12) / 9) * 0.45);  // glow
            over(s, r.ring, cover(Math.abs(ringD - 12) - 3.5));
          }
        }

        for (let i = 0; i < 4; i++) px[i] += s[i];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    for (let i = 0; i < 4; i++) buf[o + i] = Math.round(Math.min(255, (px[i] / n) * (i === 3 ? 255 : 1)));
  }
}

// ─── PNG encoding ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // colour type: RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
