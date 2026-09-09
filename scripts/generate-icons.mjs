import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SVG = path.resolve('public/icons/app-icon.svg');
const OUT = path.resolve('public/icons');

const SIZES = [512, 180, 64, 32, 16];

for (const size of SIZES) {
  const outPath = path.join(OUT, `app-icon-${size}.png`);
  await sharp(SVG, { density: 384 }).resize(size, size).png().toFile(outPath);
  console.log(`generated ${outPath}`);
}

console.log('done');
