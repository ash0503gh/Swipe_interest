// npm run food — turns src/dishes.js into src/food.json. Every dish has a hand-checked, freely licensed
// photo: either a Wikimedia Commons file name (looked up here for its URL, author and licence) or an
// object { url, author, license, page, source } picked from Openverse (e.g. Flickr).
import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DISHES } from './dishes.js';
import { foodId } from './food.js';

const UA = 'SwipeTogether-dish-photos/1.0 (personal family app)';
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const key = (file) => file.replace(/^File:/, '').replace(/_/g, ' ');

const missing = DISHES.filter((d) => !d.photo).map((d) => d.name);
if (missing.length) throw new Error(`Every dish needs a photo. Missing: ${missing.join(', ')}`);

async function fileInfo(files) {
  const out = new Map();
  for (const batch of chunks(files, 50)) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    const params = {
      action: 'query', titles: batch.map((f) => `File:${f}`).join('|'), prop: 'imageinfo',
      iiprop: 'url|extmetadata', iiurlwidth: '800', format: 'json', formatversion: '2',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Commons API failed: HTTP ${res.status}`);
    for (const p of (await res.json()).query.pages) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata || {};
      out.set(key(p.title), {
        image: info.thumburl || info.url,
        credit: { author: strip(meta.Artist?.value) || 'Unknown', license: strip(meta.LicenseShortName?.value) || 'see source', url: info.descriptionurl },
      });
    }
  }
  return out;
}

// Phone-sized copies in public/dishes/<slug>.jpg (from dish-images/) are served by the app itself.
// dish-photos.json says where each came from: 'reused' (the dish's Commons photo), 'copy:<dish>'
// (another dish's Commons photo) or 'own' (supplied by the family, e.g. AI-generated: no credit).
export const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ORIGIN = existsSync(new URL('./dish-photos.json', import.meta.url)) ? JSON.parse(readFileSync(new URL('./dish-photos.json', import.meta.url), 'utf8')) : {};
const localFile = (d) => new URL(`../public/dishes/${slug(d.name)}.jpg`, import.meta.url);

const commons = DISHES.filter((d) => typeof d.photo === 'string');
const files = await fileInfo([...new Set(commons.map((d) => key(d.photo)))]);
const broken = commons.filter((d) => !files.has(key(d.photo))).map((d) => `${d.name} (${d.photo})`);
if (broken.length) throw new Error(`Photos not found on Commons: ${broken.join(', ')}`);

const food = DISHES.map((d) => {
  const commonsPhoto = (dish) => ({ ...files.get(key(dish.photo)), credit: { ...files.get(key(dish.photo)).credit, source: 'Wikimedia Commons' } });
  let photo =
    typeof d.photo === 'string'
      ? commonsPhoto(d)
      : { image: d.photo.url, credit: { author: d.photo.author, license: d.photo.license, url: d.photo.page, source: d.photo.source } };
  if (existsSync(localFile(d))) {
    const version = createHash('md5').update(readFileSync(localFile(d))).digest('hex').slice(0, 8);
    const origin = ORIGIN[d.name] || 'reused';
    const credit = origin === 'own' ? null : origin.startsWith('copy:') ? commonsPhoto(DISHES.find((x) => x.name === origin.slice(5))).credit : photo.credit;
    photo = { image: `/dishes/${slug(d.name)}.jpg?v=${version}`, credit };
  }
  return {
    id: foodId(d.name),
    kind: 'food',
    title: d.name,
    hindi: d.hindi,
    meal: d.meal,
    overview: d.desc,
    image: photo.image,
    imageCredit: photo.credit,
    genres: [],
    cast: [],
  };
});
if (new Set(food.map((f) => f.id)).size !== food.length) throw new Error('Two dishes share a name');
await writeFile(new URL('./food.json', import.meta.url), JSON.stringify(food, null, 1) + '\n');
console.log(`${food.length} dishes, all with photos`);
