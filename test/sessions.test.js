import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'flick-'));
const { createSession, addMember, swipe, undo, publicState, findMember, SessionHub, MAX_MEMBERS, HttpError } = await import('../src/sessions.js');

const deck = [10, 20, 30, 40];
const setup = (n = 3) => {
  const s = createSession({ deck, filters: {}, now: 1000 });
  const ms = Array.from({ length: n }, (_, i) => addMember(s, `P${i}`));
  return { s, ms };
};

test('match only when every member swipes right', () => {
  const { s, ms: [a, b, c] } = setup();
  assert.equal(swipe(s, a, 10, true), null);
  assert.equal(swipe(s, b, 10, true), null);
  const m = swipe(s, c, 10, true, 5000);
  assert.deepEqual(m, { id: 10, at: 5000 });
  assert.deepEqual(s.matches, [{ id: 10, at: 5000 }]);
});

test('one left swipe blocks the match', () => {
  const { s, ms: [a, b, c] } = setup();
  swipe(s, a, 10, true);
  swipe(s, b, 10, false);
  assert.equal(swipe(s, c, 10, true), null);
  assert.equal(s.matches.length, 0);
});

test('swipes must follow deck order; repeats are ignored', () => {
  const { s, ms: [a] } = setup(1);
  assert.throws(() => swipe(s, a, 20, true), HttpError);
  swipe(s, a, 10, false);
  assert.equal(swipe(s, a, 10, false), null); // double submit
  assert.equal(a.swipes.length, 1);
  assert.throws(() => swipe(s, a, 10, true), /Out of sync/);
});

test('session keeps going after a match and collects more', () => {
  const { s, ms: [a, b] } = setup(2);
  for (const id of deck) {
    swipe(s, a, id, id !== 30);
    swipe(s, b, id, true);
  }
  assert.deepEqual(s.matches.map((m) => m.id), [10, 20, 40]);
});

test('a late joiner decides the match on movies others liked', () => {
  const { s, ms: [a, b] } = setup(2);
  swipe(s, a, 10, true);
  swipe(s, b, 10, true); // match before C joins
  swipe(s, a, 20, true);
  const c = addMember(s, 'Late');
  swipe(s, b, 20, true); // not a match: C hasn't voted
  assert.deepEqual(s.matches.map((m) => m.id), [10]);
  swipe(s, c, 10, false); // past match stays
  assert.equal(swipe(s, c, 20, true).id, 20);
});

test('undo removes the last swipe but never a matched one', () => {
  const { s, ms: [a, b] } = setup(2);
  swipe(s, a, 10, true);
  undo(s, a);
  assert.equal(a.swipes.length, 0);
  assert.throws(() => undo(s, a), /Nothing to undo/);
  swipe(s, a, 10, true);
  swipe(s, b, 10, true);
  assert.throws(() => undo(s, a), /already a match/);
  swipe(s, a, 20, false);
  undo(s, a);
  assert.equal(a.swipes.length, 1);
});

test('member limit and name rules', () => {
  const s = createSession({ deck, filters: {} });
  for (let i = 0; i < MAX_MEMBERS; i++) addMember(s, `P${i}`);
  assert.throws(() => addMember(s, 'Eleven'), /full/);
  assert.throws(() => addMember(createSession({ deck, filters: {} }), '   '), /Name is required/);
  assert.throws(() => createSession({ deck: [], filters: {} }), /No movies match/);
});

test('public state hides tokens and votes', () => {
  const { s, ms: [a] } = setup(2);
  swipe(s, a, 10, true);
  const st = publicState(s, new Set([a.id]));
  const json = JSON.stringify(st);
  assert.ok(!json.includes(a.token));
  assert.deepEqual(st.members.map((m) => [m.position, m.online]), [[1, true], [0, false]]);
  assert.equal(findMember(s, a.token), a);
  assert.equal(findMember(s, 'nope'), null);
});

test('hub persists sessions and rejects expired ones', async () => {
  const hub = new SessionHub({ saveDelayMs: 0 });
  const s = createSession({ deck, filters: {} });
  addMember(s, 'A');
  hub.add(s);
  await hub.flush();
  const fresh = new SessionHub();
  assert.equal((await fresh.get(s.code.toLowerCase())).members[0].name, 'A');
  s.expiresAt = Date.now() - 1;
  await assert.rejects(hub.get(s.code), /expired/);
  await assert.rejects(hub.get('bad'), /not found/);
});
