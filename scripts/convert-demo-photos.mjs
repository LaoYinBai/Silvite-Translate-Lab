import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const jobs = [
  {
    src: 'C:/Users/wxb27/Pictures/29bccceaa6cd42dde94aedf5f1bbd950.png',
    out: 'public/demo/comic.jpg',
    orig: 'assets/demo/comic-src.png',
  },
  {
    src: 'C:/Users/wxb27/Downloads/modi_poster_real_qr.png',
    out: 'public/demo/poster.jpg',
    orig: 'assets/demo/poster-src.png',
  },
];

for (const job of jobs) {
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  fs.mkdirSync(path.dirname(job.orig), { recursive: true });

  const meta = await sharp(job.src).metadata();
  await sharp(job.src).jpeg({ quality: 84, mozjpeg: true }).toFile(job.out);
  fs.copyFileSync(job.src, job.orig);

  const kb = Math.round(fs.statSync(job.out).size / 1024);
  console.log(`${job.out}: ${meta.width}x${meta.height} -> ${kb} KB`);
}
console.log('done');
