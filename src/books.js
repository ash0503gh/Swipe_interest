// Books mode: English fiction bestsellers (built by `npm run books` into books.json).
import { readFileSync, existsSync } from 'node:fs';

const file = new URL('./books.json', import.meta.url);
export const BOOK_LIST = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];

// Stable id from title + author, in a range clear of movies (positive), shows (negative) and food (3e9+).
export function bookId(title, author) {
  let h = 5381;
  for (const ch of `${title}|${author}`) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return 5e9 + (h % 1e9);
}

// Within a filter any choice matches; filters combine with AND.
export function filterBooks(books, f = {}) {
  return books.filter(
    (b) => (!f.origins?.length || f.origins.includes(b.origin)) && (!f.genres?.length || b.genres.some((g) => f.genres.includes(g)))
  );
}

// Current NYT bestsellers first (by rank), then by reader rating (well-rated with enough votes first).
export function sortBooks(books) {
  const score = (b) => (b.rating && b.ratingCount >= 50 ? b.rating : b.rating ? b.rating - 1 : 0);
  return [...books].sort((a, b) => (a.nytRank ?? 99) - (b.nytRank ?? 99) || score(b) - score(a) || b.ratingCount - a.ratingCount);
}

export function bookGenres() {
  const count = new Map();
  for (const b of BOOK_LIST) b.genres.forEach((g) => count.set(g, (count.get(g) || 0) + 1));
  return [...count].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
