// Food mode: a fixed list of pure-veg dishes (built by `npm run food` into food.json).
import { readFileSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const file = new URL('./food.json', import.meta.url);
export const FOOD = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];

// Stable numeric id from the dish name, in a range that can't collide with
// movie ids (positive TMDB ids) or show ids (negative).
export function foodId(name) {
  let h = 5381;
  for (const ch of name) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return 3e9 + (h % 1e9);
}

export const dishesFor = (meal) => FOOD.filter((d) => d.meal === meal);

// Fisher–Yates with a crypto-random source: a new order every session.
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
