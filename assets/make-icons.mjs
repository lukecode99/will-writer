// Regenerates the app icon, splash and favicon from one vector mark.
//
// These three files were 1x1 placeholder PNGs, which Apple rejects outright:
// the App Store icon must be 1024x1024 with NO alpha channel. Everything here
// is flattened onto the navy ground for that reason -- do not "helpfully" add
// transparency back.
//
// Run: node assets/make-icons.mjs
//
// sharp is not a dependency of the app -- it is only needed to regenerate these
// files, so it is resolved leniently. Set SHARP_FROM to a directory that has a
// working install if the ambient one is broken:
//   SHARP_FROM=/path/to/project node assets/make-icons.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadSharp() {
  const roots = [import.meta.url];
  if (process.env.SHARP_FROM) {
    roots.unshift(pathToFileURL(join(process.env.SHARP_FROM, 'noop.js')).href);
  }
  for (const root of roots) {
    try {
      return createRequire(root)('sharp');
    } catch (err) {
      if (root === roots[roots.length - 1]) throw err;
    }
  }
}

const sharp = loadSharp();

const NAVY = '#1B3A6B';
const CREAM = '#F7F9FC';
const FOLD = '#DDE5F0';
const GOLD = '#C9A227';
const GOLD_DARK = '#A8861D';

/**
 * The document mark on a 1024x1024 canvas, centred, without its background.
 * Sheet is 396x560 -- close to A4's 1:1.414 so it reads as a page rather than
 * a card, with the top-right corner turned over.
 */
function mark() {
  const lines = [
    [366, 400, 292],
    [366, 456, 292],
    [366, 512, 234],
    [366, 568, 268],
  ]
    .map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" fill="${NAVY}" opacity="0.22"/>`)
    .join('\n    ');

  return `
    <path d="M 314 232 H 614 L 710 328 V 792 H 314 Z" fill="${CREAM}"/>
    <path d="M 614 232 L 710 328 H 614 Z" fill="${FOLD}"/>
    ${lines}
    <path d="M 366 672 C 400 640, 424 706, 458 674 S 516 638, 552 668"
          fill="none" stroke="${NAVY}" stroke-opacity="0.55"
          stroke-width="14" stroke-linecap="round"/>
    <circle cx="642" cy="700" r="46" fill="${GOLD}"/>
    <circle cx="642" cy="700" r="46" fill="none" stroke="${GOLD_DARK}" stroke-width="6"/>
    <path d="M 642 676 L 649 693 L 667 694 L 653 705 L 658 722 L 642 712 L 626 722 L 631 705 L 617 694 L 635 693 Z"
          fill="${CREAM}" opacity="0.9"/>`;
}

const svg = (w, h, inner) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="${NAVY}"/>${inner}</svg>`,
  );

/** Scales the mark about the centre of its own 1024 canvas. */
const zoom = k => `translate(${512 * (1 - k)} ${512 * (1 - k)}) scale(${k})`;

// App icon: full bleed, no rounding -- iOS applies its own corner radius. The
// mark is enlarged to ~52% of the width so it still reads at 60px on a home
// screen, while keeping enough margin that the rounding never clips the sheet.
const icon = svg(1024, 1024, `<g transform="${zoom(1.34)}">${mark()}</g>`);

// Splash: portrait canvas with the mark at ~40% width, so `resizeMode: contain`
// fits it to the screen without the mark ballooning to the full device width.
const SW = 1242;
const SH = 2688;
const scale = 0.42;
const off = `translate(${(SW - 1024 * scale) / 2} ${(SH - 1024 * scale) / 2}) scale(${scale})`;
const splash = svg(SW, SH, `<g transform="${off}">${mark()}</g>`);

const out = async (buf, name, w, h) => {
  await sharp(buf)
    .resize(w, h)
    .flatten({ background: NAVY }) // strips alpha -- required for the App Store icon
    .png({ compressionLevel: 9 })
    .toFile(join(HERE, name));
  console.log(name, `${w}x${h}`);
};

await out(icon, 'icon.png', 1024, 1024);
await out(splash, 'splash.png', SW, SH);
await out(icon, 'favicon.png', 48, 48);
