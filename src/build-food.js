// npm run food — turns src/dishes.js into src/food.json. Every dish names a hand-checked photo
// on Wikimedia Commons (free licences only); this adds the image URL plus author and licence for credit.
import { writeFile } from 'node:fs/promises';
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

const files = await fileInfo([...new Set(DISHES.map((d) => key(d.photo)))]);
const broken = DISHES.filter((d) => !files.has(key(d.photo))).map((d) => `${d.name} (${d.photo})`);
if (broken.length) throw new Error(`Photos not found on Commons: ${broken.join(', ')}`);

const food = DISHES.map((d) => {
  const photo = files.get(key(d.photo));
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
