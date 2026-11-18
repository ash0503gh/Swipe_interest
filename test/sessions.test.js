import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'flick-'));
const { createSession, addMember, swipe, undo, publicState, findMember, endSession, SessionHub, MAX_MEMBERS, HttpError } = await import('../src/sessions.js');

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
  assert.throws(() => createSession({ deck: [], filters: {} }), /Nothing matches/);
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
  const hub = new SessionHub({ minGapMs: 0 });
  const s = createSession({ deck, filters: {} });
  addMember(s, 'A');
  await hub.add(s); // saved before add resolves
  const fresh = new SessionHub();
  assert.equal((await fresh.get(s.code.toLowerCase())).members[0].name, 'A');
  s.expiresAt = Date.now() - 1;
  await assert.rejects(hub.get(s.code), /expired/);
  await assert.rejects(hub.get('bad'), /not found/);
});

test('hub coalesces rapid saves and keeps the latest state', async () => {
  const hub = new SessionHub({ minGapMs: 30 });
  const s = createSession({ deck, filters: {} });
  const a = addMember(s, 'A');
  await hub.add(s);
  const saves = [];
  for (const id of deck) {
    swipe(s, a, id, true);
    saves.push(hub.changed(s));
  }
  assert.equal(new Set(saves.slice(1)).size, 1); // later changes share one queued save
  await Promise.all(saves);
  assert.equal((await new SessionHub().get(s.code)).members[0].swipes.length, deck.length);
});

test('no match when only one person is in the session', () => {
  const { s, ms: [a] } = setup(1);
  assert.equal(swipe(s, a, 10, true), null);
  assert.equal(s.matches.length, 0);
  const b = addMember(s, 'Joined later');
  assert.equal(swipe(s, b, 10, true).id, 10); // the solo like still counts once someone agrees
});

test('food sessions match when more than half agree', () => {
  const s = createSession({ deck, filters: { kind: 'food' }, rule: 'majority' });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => addMember(s, n));
  assert.equal(swipe(s, a, 10, true), null); // 1 of 3
  assert.equal(swipe(s, b, 10, true).id, 10); // 2 of 3 is a majority, C hasn't swiped yet
  swipe(s, c, 10, false);
  assert.deepEqual(s.matches.map((m) => m.id), [10]);
  swipe(s, a, 20, true);
  swipe(s, b, 20, false);
  assert.equal(swipe(s, c, 20, false), null); // 1 of 3
  const pair = createSession({ deck, filters: {}, rule: 'majority' });
  const [x, y] = ['X', 'Y'].map((n) => addMember(pair, n));
  swipe(pair, x, 10, true);
  assert.equal(swipe(pair, y, 10, false), null); // with two people, both must agree
  const solo = createSession({ deck, filters: {}, rule: 'majority' });
  assert.equal(swipe(solo, addMember(solo, 'Z'), 10, true), null); // never alone
  assert.equal(publicState(s).rule, 'majority');
  assert.equal(publicState(s).kind, 'food');
});

test('concurrent loads of a stored session share one object', async () => {
  const s = createSession({ deck, filters: {} });
  addMember(s, 'A');
  await new SessionHub({ minGapMs: 0 }).add(s);
  const cold = new SessionHub();
  const [x, y, z] = await Promise.all([cold.get(s.code), cold.get(s.code), cold.get(s.code)]);
  assert.ok(x === y && y === z);
});

test('joining again with the same name continues as that person', () => {
  const { s, ms: [a, b] } = setup(2);
  swipe(s, a, 10, true);
  const again = addMember(s, '  p1 ');
  assert.equal(again, b);
  assert.equal(s.members.length, 2);
  assert.deepEqual(swipe(s, again, 10, true, 7000), { id: 10, at: 7000 }); // no ghost member blocking the match
});

test('anyone can end a session for everyone', async () => {
  const hub = new SessionHub({ minGapMs: 0 });
  const { s, ms: [, b] } = setup(2);
  await hub.add(s);
  endSession(s, b);
  assert.equal(publicState(s).endedBy, 'P1');
  await hub.changed(s);
  await assert.rejects(hub.get(s.code), /P1 ended this session/);
  await assert.rejects(new SessionHub().get(s.code), /P1 ended this session/); // still ended after a restart
});
