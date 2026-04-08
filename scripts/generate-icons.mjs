import sharp from "sharp";
import { mkdirSync } from "fs";

mkdirSync("src/assets", { recursive: true });

const sizes = [16, 32, 48, 128];

// Bookmark icon with breadcrumb trail — SVG template
function makeSVG(size) {
  const s = size;
  const pad = Math.round(s * 0.1);
  const bw = Math.round(s * 0.45); // bookmark width
  const bh = Math.round(s * 0.6);  // bookmark height
  const bx = Math.round(s * 0.1);
  const by = Math.round(s * 0.15);
  const notch = Math.round(bh * 0.2);
  const dotR = Math.max(1, Math.round(s * 0.04));
  const dotSpacing = Math.round(s * 0.1);
  const dotStartX = bx + bw + Math.round(s * 0.08);
  const dotY = by + Math.round(bh * 0.5);

  // Bookmark shape path
  const bmPath = `M${bx},${by} h${bw} v${bh} l${-bw/2},${-notch} l${-bw/2},${notch} Z`;

  // Breadcrumb dots (3 dots trailing right and down)
  let dots = "";
  for (let i = 0; i < 3; i++) {
    const dx = dotStartX + i * dotSpacing;
    const dy = dotY + i * Math.round(s * 0.06);
    const opacity = 1 - i * 0.25;
    dots += `<circle cx="${dx}" cy="${dy}" r="${dotR}" fill="#F59E0B" opacity="${opacity}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${Math.round(s*0.15)}" fill="#1a1a2e"/>
  <path d="${bmPath}" fill="#F59E0B"/>
  <rect x="${bx + Math.round(bw*0.2)}" y="${by + Math.round(bh*0.12)}" width="${Math.round(bw*0.6)}" height="${Math.max(1, Math.round(s*0.03))}" rx="1" fill="#1a1a2e" opacity="0.3"/>
  <rect x="${bx + Math.round(bw*0.2)}" y="${by + Math.round(bh*0.24)}" width="${Math.round(bw*0.4)}" height="${Math.max(1, Math.round(s*0.03))}" rx="1" fill="#1a1a2e" opacity="0.3"/>
  ${dots}
</svg>`;
}

for (const size of sizes) {
  const svg = makeSVG(size);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(`src/assets/icon-${size}.png`);
  console.log(`Generated icon-${size}.png`);
}

console.log("Icons generated.");
