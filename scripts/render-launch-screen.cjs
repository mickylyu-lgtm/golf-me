// Renders the iOS launch image (ios/App/App/Assets.xcassets/Splash.imageset)
// from public/icon-source.svg's own gradient, geometry and colors.
//
//   node scripts/render-launch-screen.cjs <outDir>
//
// Writes two 2732px square, opaque PNGs plus small previews:
//   splash-plain-2732.png  the icon's diagonal gradient only (what ships:
//                          EntryOverlay brings the mark in on top of it)
//   splash-logo-2732.png   the same gradient with the current mark centered
//                          at 37.05% of the square, the exact size/position
//                          EntryOverlay (MARK_FRACTION) draws it
// To ship one, copy it over all three files in Splash.imageset.
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const repo = path.join(__dirname, "..");
const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/render-launch-screen.cjs <outDir>");
  process.exit(1);
}
const S = 2732;
const MARK = S * 0.3705;
const src = fs.readFileSync(path.join(repo, "public", "icon-source.svg"), "utf8");
const defs = src.match(/<defs>[\s\S]*<\/defs>/)[0];
// Everything after the icon's full-bleed background rect is the mark itself.
const body = src.split('<rect width="48" height="48" fill="url(#bg)"/>')[1].replace(/<\/svg>\s*$/, "");
const off = (S - MARK) / 2;
const mark = `<svg x="${off}" y="${off}" width="${MARK}" height="${MARK}" viewBox="0 0 48 48">${defs}${body}</svg>`;
const doc = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${defs}` +
  `<rect width="${S}" height="${S}" fill="url(#bg)"/>${inner}</svg>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, svg] of [
    ["plain", doc("")],
    ["logo", doc(mark)],
  ]) {
    const png = await sharp(Buffer.from(svg), { density: 72 }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(path.join(out, `splash-${name}-2732.png`), png);
    // Phone-shaped preview: aspect-fill into 430x932 (iPhone Pro Max points).
    await sharp(png)
      .resize(932, 932)
      .extract({ left: 251, top: 0, width: 430, height: 932 })
      .png()
      .toFile(path.join(out, `preview-${name}-phone.png`));
  }
})();
