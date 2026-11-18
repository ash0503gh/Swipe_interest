// npm run food — turns src/dishes.js into src/food.json, adding each dish's Wikipedia lead photo
// (only freely licensed files hosted on Wikimedia Commons) with its author and licence for credit.
import { writeFile } from 'node:fs/promises';
import { DISHES } from './dishes.js';
import { foodId } from './food.js';

const UA = 'SwipeTogether-dish-photos/1.0 (personal family app)';
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function wiki(params) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikipedia API failed: HTTP ${res.status}`);
  return res.json();
}

// Article title -> lead image file name, following normalisation and redirects.
async function leadImages(titles) {
  const out = new Map();
  for (const batch of chunks(titles, 50)) {
    const d = await wiki({ action: 'query', titles: batch.join('|'), redirects: '1', prop: 'pageimages', piprop: 'name' });
    const hop = new Map([...(d.query.normalized || []), ...(d.query.redirects || [])].map((r) => [r.from, r.to]));
    const pages = new Map(d.query.pages.map((p) => [p.title, p]));
    for (const t of batch) {
      let final = t;
      for (let i = 0; i < 3 && hop.has(final); i++) final = hop.get(final);
      const p = pages.get(final);
      out.set(t, p && !p.missing ? p.pageimage || null : undefined); // undefined = no such article
    }
  }
  return out;
}

async function fileInfo(files) {
  const out = new Map();
  for (const batch of chunks(files, 50)) {
    const d = await wiki({
      action: 'query', titles: batch.map((f) => `File:${f}`).join('|'),
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800',
    });
    for (const p of d.query.pages) {
      const info = p.imageinfo?.[0];
      if (!info || p.imagerepository !== 'shared') continue; // Commons only: free licences
      const meta = info.extmetadata || {};
      out.set(p.title.replace(/^File:/, '').replace(/ /g, '_'), {
        image: info.thumburl || info.url,
        credit: { author: strip(meta.Artist?.value) || 'Unknown', license: strip(meta.LicenseShortName?.value) || 'see source', url: info.descriptionurl },
      });
    }
  }
  return out;
}

const titles = [...new Set(DISHES.map((d) => d.wiki).filter(Boolean))];
const leads = await leadImages(titles);
const files = await fileInfo([...new Set([...leads.values()].filter(Boolean))]);

const problems = [];
const food = DISHES.map((d) => {
  const lead = d.wiki ? leads.get(d.wiki) : null;
  if (d.wiki && lead === undefined) problems.push(`no article: ${d.wiki} (${d.name})`);
  else if (d.wiki && !lead) problems.push(`no photo: ${d.wiki} (${d.name})`);
  const photo = lead ? files.get(lead.replace(/ /g, '_')) : null;
  if (lead && !photo) problems.push(`photo not free/Commons: ${lead} (${d.name})`);
  return {
    id: foodId(d.name),
    kind: 'food',
    title: d.name,
    hindi: d.hindi,
    meal: d.meal,
    minutes: d.minutes,
    overview: d.desc,
    image: photo?.image || null,
    imageCredit: photo?.credit || null,
    genres: [],
    cast: [],
  };
});

const ids = new Set(food.map((f) => f.id));
if (ids.size !== food.length) throw new Error('Two dishes share a name');
await writeFile(new URL('./food.json', import.meta.url), JSON.stringify(food, null, 1) + '\n');
console.log(`${food.length} dishes, ${food.filter((f) => f.image).length} with photos`);
problems.forEach((p) => console.log('  - ' + p));
