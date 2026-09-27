// Prepares the product photos for the website:
// - makes a small WebP thumbnail of every photo in public/images/products (used by the product cards)
// - writes public/data/images.json, the list of photos of each product ID
//
// Runs automatically when `npm run dev` or `npm run build` starts (see vite.config.js),
// or by hand with `npm run images`. Thumbnails already made are reused, so only new
// or changed photos are processed.
//
// Photo names: {ID}.jpg for a single photo, or {ID}_1.jpg, {ID}_2.jpg, ... for several
// (.jpg, .jpeg and .png all work). Photos are shown in order of their number.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTS_DIR = path.join(ROOT, 'public/images/products');
const THUMBS_DIR = path.join(ROOT, 'public/images/thumbs');
const MANIFEST_PATH = path.join(ROOT, 'public/data/images.json');

// Cards are 250px tall and crop the photo to fill the box, so a shortest side of 600px
// stays sharp on phone screens while keeping the framing identical to the original photo.
const THUMB_SHORT_SIDE = 600;
const THUMB_QUALITY = 75;
// Part of every thumbnail name: change it if the settings above change, so browsers
// that cached the old thumbnails download the new ones.
const THUMB_VERSION = `${THUMB_SHORT_SIDE}-q${THUMB_QUALITY}`;

const PHOTO_NAME = /^(.+?)(?:_(\d+))?\.(jpe?g|png)$/i;

export async function prepareImages() {
  const start = Date.now();
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });

  const photos = [];
  for (const file of fs.readdirSync(PRODUCTS_DIR).sort()) {
    const match = file.match(PHOTO_NAME);
    if (!match) {
      if (!file.startsWith('.')) console.warn(`⚠ Ignoring ${file}: expected a name like 0123.jpg or 0123_1.jpg`);
      continue;
    }
    // The thumbnail name includes a fingerprint of the photo, so a replaced photo gets a new thumbnail
    const hash = crypto.createHash('md5')
      .update(THUMB_VERSION)
      .update(fs.readFileSync(path.join(PRODUCTS_DIR, file)))
      .digest('hex')
      .slice(0, 8);
    photos.push({
      file,
      id: match[1],
      order: Number(match[2] || 0),
      thumb: `${path.parse(file).name}-${hash}.webp`
    });
  }

  let created = 0;
  const failed = [];
  await runWithConcurrency(photos, 4, async photo => {
    const thumbPath = path.join(THUMBS_DIR, photo.thumb);
    if (fs.existsSync(thumbPath)) return;
    try {
      const data = await sharp(path.join(PRODUCTS_DIR, photo.file))
        .rotate() // apply the phone's orientation (EXIF), if any
        .resize({ width: THUMB_SHORT_SIDE, height: THUMB_SHORT_SIDE, fit: 'outside', withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
      // Write under a temporary name first, so an interrupted run never leaves a broken thumbnail
      fs.writeFileSync(`${thumbPath}.tmp`, data);
      fs.renameSync(`${thumbPath}.tmp`, thumbPath);
      created++;
    } catch (error) {
      failed.push(photo);
      console.warn(`⚠ Could not make a thumbnail of ${photo.file}, it will not be shown: ${error.message}`);
    }
  });

  const imagesById = {};
  const ready = photos
    .filter(photo => !failed.includes(photo))
    .sort((a, b) => a.id.localeCompare(b.id) || a.order - b.order);
  for (const photo of ready) {
    (imagesById[photo.id] ||= []).push({
      src: `/images/products/${photo.file}`,
      thumb: `/images/thumbs/${photo.thumb}`
    });
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(imagesById));

  // Remove thumbnails of photos that were deleted or replaced
  const current = new Set(ready.map(photo => photo.thumb));
  for (const file of fs.readdirSync(THUMBS_DIR)) {
    if (!current.has(file)) fs.rmSync(path.join(THUMBS_DIR, file));
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ Product photos: ${ready.length} photos of ${Object.keys(imagesById).length} products ready (${created} new thumbnails) in ${seconds}s`);
}

async function runWithConcurrency(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

// Run directly with `node scripts/prepare-images.js` (npm run images)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareImages().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
