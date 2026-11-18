import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookId, filterBooks, sortBooks } from '../src/books.js';
import { BOOKS, GENRES } from '../src/books-list.js';

const list = [
  { id: 1, origin: 'indian', genres: ['Romance'], rating: 3.9, ratingCount: 400, nytRank: null },
  { id: 2, origin: 'international', genres: ['Thriller', 'Mystery'], rating: 4.4, ratingCount: 900, nytRank: null },
  { id: 3, origin: 'international', genres: ['Romance'], rating: null, ratingCount: 0, nytRank: 2 },
  { id: 4, origin: 'indian', genres: ['Mythology'], rating: 4.6, ratingCount: 10, nytRank: null },
  { id: 5, origin: 'international', genres: ['Fantasy'], rating: 4.1, ratingCount: 3000, nytRank: 1 },
];
const ids = (l) => l.map((b) => b.id);

test('book filters: origin and genre', () => {
  assert.deepEqual(ids(filterBooks(list, { origins: ['indian'] })), [1, 4]);
  assert.deepEqual(ids(filterBooks(list, { genres: ['Romance', 'Mystery'] })), [1, 2, 3]);
  assert.deepEqual(ids(filterBooks(list, { origins: ['international'], genres: ['Romance'] })), [3]);
  assert.equal(filterBooks(list, {}).length, 5);
});

test('NYT bestsellers first, then well-rated books', () => {
  assert.deepEqual(ids(sortBooks(list)), [5, 3, 2, 1, 4]);
});

test('curated list is valid and ids are safe', () => {
  const seen = new Set();
  for (const [title, author, origin, genres] of BOOKS) {
    assert.ok(['indian', 'international'].includes(origin), title);
    genres.split('|').forEach((g) => assert.ok(GENRES.includes(g), `${title}: ${g}`));
    const id = bookId(title, author);
    assert.ok(id >= 5e9 && id < 6e9 && !seen.has(id), title);
    seen.add(id);
  }
});
