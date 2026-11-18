// Makes src/lib/intro-land.ts: where the land is, on a 2.5° grid, from the water mask the
// globe already ships (public/textures/earth-water.png, white = water). The opening scene draws
// one dot per land cell. Run: node scripts/make-intro-land.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 144; // 2.5° of longitude per cell, from -180
const H = 72; // 2.5° of latitude per cell, from +90
const { data, info } = await sharp("public/textures/earth-water.png").resize(W, H, { fit: "fill", kernel: "cubic" }).greyscale().raw().toBuffer({ resolveWithObject: true });
const bits = new Uint8Array(Math.ceil((W * H) / 8));
let land = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (data[i * info.channels] < 140) {
      bits[i >> 3] |= 1 << (i & 7);
      land++;
    }
  }
const b64 = Buffer.from(bits).toString("base64");
writeFileSync(
  "src/lib/intro-land.ts",
  `// Made by scripts/make-intro-land.mjs from public/textures/earth-water.png: don't edit by hand.
/** Land on a ${W}×${H} grid (2.5° cells, west to east from -180°, north to south from 90°), one bit each, base64. */
export const LAND_W = ${W};
export const LAND_H = ${H};
export const LAND_BITS = "${b64}";
`,
);
console.log(`${land} land cells of ${W * H}, ${b64.length} characters`);
