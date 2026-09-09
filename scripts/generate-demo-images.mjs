import sharp from 'sharp';
import fs from 'node:fs/promises';

const files = [
  { svg: 'assets/demo/poster.svg', png: 'public/demo/poster.png' },
  { svg: 'assets/demo/comic.svg', png: 'public/demo/comic.png' },
];

await fs.mkdir('public/demo', { recursive: true });

for (const { svg, png } of files) {
  await sharp(svg).png().toFile(png);
  console.log(`generated ${png}`);
}

console.log('done');
