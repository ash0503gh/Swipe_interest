// npm run books — builds src/books.json from the curated list (src/books-list.js) plus, when
// NYT_API_KEY is set, the current New York Times fiction bestseller lists. Covers, first publication
// year, pages, reader ratings and descriptions come from Open Library (Google Books fills gaps while its
// free quota lasts). All free.
import { writeFile } from 'node:fs/promises';
import { BOOKS, GENRES } from './books-list.js';
import { bookId } from './books.js';

const UA = 'SwipeTogether-books/1.0 (personal family app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// NYT titles come in capitals: "THEO OF GOLDEN" -> "Theo of Golden".
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
export const titleCase = (s) =>
  s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function getJSON(url, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': UA } });
    } catch {
      await sleep(3000 * (i + 1)); // dropped connection: try again
      continue;
    }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 && retries === 0) throw Object.assign(new Error('quota'), { quota: true });
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`HTTP ${r.status} ${new URL(url).host}`);
  }
  return null;
}

// Open Library work descriptions: plain text, sometimes with a trailing source/links block.
async function workDescription(key) {
  if (!key) return '';
  const w = await getJSON(`https://openlibrary.org${key}.json`);
  const d = typeof w?.description === 'string' ? w.description : w?.description?.value || '';
  return strip(d.split(/\n-{3,}|\(\[source\]|\[\d\]:/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
}

async function openLibrary(title, author) {
  const u = new URL('https://openlibrary.org/search.json');
  u.searchParams.set('title', title);
  u.searchParams.set('author', author);
  u.searchParams.set('limit', '5');
  u.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,ratings_average,ratings_count');
  let docs = (await getJSON(u))?.docs || [];
  if (!docs.some((d) => d.cover_i)) {
    // Looser search when exact title/author fields miss (punctuation, subtitles, translated titles).
    u.searchParams.delete('title');
    u.searchParams.delete('author');
    u.searchParams.set('q', `${title.replace(/[:&?!]/g, ' ')} ${author.split(' ').at(-1)}`);
    docs = [...docs, ...((await getJSON(u))?.docs || [])];
  }
  return docs.filter((d) => d.cover_i).sort((a, b) => (b.ratings_count || 0) - (a.ratings_count || 0))[0] || docs[0] || null;
}

let googleOff = false; // Google Books' anonymous quota runs out quickly; stop asking once it does
async function googleBooks(title, author) {
  if (googleOff) return { description: '', categories: [] };
  const u = new URL('https://www.googleapis.com/books/v1/volumes');
  u.searchParams.set('q', `intitle:${title} inauthor:${author.split(' ').at(-1)}`);
  u.searchParams.set('maxResults', '6');
  u.searchParams.set('printType', 'books');
  u.searchParams.set('langRestrict', 'en');
  let items = [];
  try {
    items = (await getJSON(u, { retries: 0 }))?.items || [];
  } catch (err) {
    if (!err.quota) throw err;
    googleOff = true;
    console.log('Google Books quota reached; using Open Library descriptions only');
  }
  const vols = items.map((i) => i.volumeInfo).filter((v) => norm(v.title).includes(norm(title).split(' ').slice(0, 3).join(' ')));
  return {
    description: strip(vols.map((v) => v.description || '').sort((a, b) => b.length - a.length)[0] || ''),
    categories: [...new Set(vols.flatMap((v) => v.categories || []))],
    thumb: vols.find((v) => v.imageLinks?.thumbnail)?.imageLinks.thumbnail?.replace('http://', 'https://').replace('&edge=curl', ''),
  };
}

// NYT list entries -> genres from Google Books categories (NYT does not give genres).
const GENRE_WORDS = [
  ['Romance', /romance|love/], ['Thriller', /thriller|suspense/], ['Mystery', /mystery|detective|crime/],
  ['Fantasy', /fantasy|magic/], ['Sci-Fi', /science fiction|dystopi/], ['Historical', /historical|history/],
  ['Horror', /horror/], ['Mythology', /mytholog/], ['Literary', /literary/],
];
const genresFrom = (cats) => {
  const text = cats.join(' ').toLowerCase();
  const g = GENRE_WORDS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return g.length ? g.slice(0, 2) : ['Contemporary'];
};

async function nytBooks() {
  const key = process.env.NYT_API_KEY;
  if (!key) return [];
  const out = new Map();
  for (const list of ['combined-print-and-e-book-fiction', 'hardcover-fiction', 'trade-fiction-paperback']) {
    const d = await getJSON(`https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${encodeURIComponent(key)}`);
    for (const b of d?.results?.books || []) {
      const k = norm(b.title);
      const prev = out.get(k);
      if (!prev || b.rank < prev.rank) out.set(k, { title: titleCase(b.title), author: b.author, rank: b.rank, image: b.book_image, description: b.description });
    }
    await sleep(12500); // NYT allows 5 requests per minute
  }
  return [...out.values()];
}

const indianAuthors = new Set(BOOKS.filter((b) => b[2] === 'indian').map((b) => norm(b[1])));
const curatedTitles = new Set(BOOKS.map((b) => norm(b[0])));
const nyt = (await nytBooks()).filter((b) => !curatedTitles.has(norm(b.title)));
const nytRank = new Map();
const entries = [
  ...BOOKS.map(([title, author, origin, genres, cover]) => ({ title, author, origin, genres: genres.split('|'), cover })),
  ...nyt.map((b) => ({ title: b.title, author: b.author, origin: indianAuthors.has(norm(b.author)) ? 'indian' : 'international', genres: null, nyt: b })),
];
for (const b of nyt) nytRank.set(norm(b.title), b.rank);

const books = [];
const problems = [];
let done = 0;
for (const e of entries) {
  const ol = await openLibrary(e.title, e.author);
  const olText = await workDescription(ol?.key);
  const gb = olText.length > 120 ? { description: '', categories: [] } : await googleBooks(e.title, e.author);
  await sleep(300);
  if (++done % 20 === 0) console.log(`${done}/${entries.length}`);
  const coverId = e.cover || ol?.cover_i; // a pinned cover (English edition, checked by eye) wins
  const image = e.nyt?.image || (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : gb.thumb);
  if (!image) { problems.push(`no cover: ${e.title}`); continue; }
  for (const g of e.genres || []) if (!GENRES.includes(g)) throw new Error(`Unknown genre ${g} for ${e.title}`);
  books.push({
    id: bookId(e.title, e.author),
    kind: 'book',
    title: e.title,
    author: e.author,
    origin: e.origin,
    genres: e.genres || genresFrom(gb.categories),
    year: ol?.first_publish_year || null,
    pages: ol?.number_of_pages_median || null,
    rating: ol?.ratings_count >= 5 ? Math.round(ol.ratings_average * 10) / 10 : null,
    ratingCount: ol?.ratings_count || 0,
    overview: [olText, gb.description, e.nyt?.description].sort((a, b) => (b || '').length - (a || '').length)[0] || '',
    image,
    nytRank: nytRank.get(norm(e.title)) || null,
    cast: [],
  });
}
await writeFile(new URL('./books.json', import.meta.url), JSON.stringify(books, null, 1) + '\n');
console.log(`${books.length} books (${nyt.length} from NYT lists), ${books.filter((b) => b.rating).length} with ratings, ${books.filter((b) => b.overview).length} with descriptions`);
problems.forEach((p) => console.log('  - ' + p));
