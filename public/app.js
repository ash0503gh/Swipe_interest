const $app = document.getElementById('app');
const IMG = 'https://image.tmdb.org/t/p/';

// ---------- tiny helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const ICONS = {
  x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  chev: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};
function icon(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap.firstChild;
}

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['x-member-token'] = token;
  const res = await fetch(path, { method, headers, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Network error. Try again.'), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) document.body.append((el = h('div', { class: 'toast', role: 'status' })));
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const buzz = (p) => navigator.vibrate?.(p);
const runtime = (m) => (m ? `${Math.floor(m / 60)}h ${m % 60}m`.replace(/^0h /, '') : null);
const subline = (m) => [m.year, runtime(m.runtime), m.cert].filter(Boolean).join(' · ');
const netflixUrl = (m) => `https://www.netflix.com/search?q=${encodeURIComponent(m.title)}`;
const youtubeUrl = (m) =>
  m.trailer ? `https://www.youtube.com/watch?v=${m.trailer}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.title} ${m.year || ''} trailer`)}`;
const rating = (m) => (m.imdbRating ? h('span', { class: 'imdb' }, 'IMDb', ` ${m.imdbRating.toFixed(1)}`) : null);
const COLORS = ['#ffc857', '#3ddc97', '#7cc4ff', '#ff8fa3', '#c9a7ff', '#ffa45c', '#8be0d4', '#f5e663', '#b2e672', '#ff9de2'];
const avatar = (m, i, cls = '') =>
  h('span', { class: `av ${cls} ${m.online ? '' : 'off'}`, style: `background:${COLORS[i % COLORS.length]}`, title: m.name }, m.name[0].toUpperCase());

function closeLayer(el) {
  el.classList.add('closing');
  setTimeout(() => el.remove(), 200);
}

function sheet(...content) {
  const back = h('div', { class: 'backdrop', onclick: (e) => e.target === back && close() });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    closeLayer(back);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grab' }), ...content));
  document.body.append(back);
  return close;
}

function details(m) {
  const box = h('div', { class: 'trailer' });
  if (m.trailer) {
    const play = h('button', { class: 'play', 'aria-label': 'Play trailer' }, h('span', null, icon('play')));
    play.onclick = () =>
      box.replaceChildren(
        h('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${m.trailer}?autoplay=1&playsinline=1&rel=0`,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: true,
          title: `${m.title} trailer`,
        })
      );
    box.append(h('img', { src: `https://i.ytimg.com/vi/${m.trailer}/hqdefault.jpg`, alt: '' }), play);
  }
  sheet(
    m.trailer ? box : null,
    h('h2', null, m.title),
    h('div', { class: 'sub' }, rating(m), h('span', null, subline(m)), h('span', null, m.genres.slice(0, 3).join(', '))),
    m.overview ? h('p', { class: 'overview' }, m.overview) : null,
    m.director ? h('p', { class: 'credit' }, 'Director  ', h('b', null, m.director)) : null,
    m.cast.length ? h('p', { class: 'credit' }, 'Cast  ', h('b', null, m.cast.join(', '))) : null,
    h('div', { class: 'links' },
      h('a', { class: 'btn primary', href: netflixUrl(m), target: '_blank', rel: 'noopener' }, 'Watch on Netflix'),
      h('a', { class: 'btn ghost', href: youtubeUrl(m), target: '_blank', rel: 'noopener' }, 'YouTube'),
      m.imdbId ? h('a', { class: 'btn ghost', href: `https://www.imdb.com/title/${m.imdbId}/`, target: '_blank', rel: 'noopener' }, 'IMDb') : null
    )
  );
}

// ---------- home ----------

const RATINGS = [{ label: 'Any', v: 0 }, { label: '6+', v: 6 }, { label: '7+', v: 7 }, { label: '8+', v: 8 }];
const YEARS = [
  { label: 'Any', from: 0, to: 0 },
  { label: '2020+', from: 2020, to: 0 },
  { label: '2015+', from: 2015, to: 0 },
  { label: '2010+', from: 2010, to: 0 },
  { label: '2000s', from: 2000, to: 2009 },
  { label: 'Classics', from: 0, to: 1999 },
];
const RUNTIMES = [{ label: 'Any', v: 0 }, { label: 'Under 1½h', v: 90 }, { label: 'Under 2h', v: 120 }, { label: 'Under 2½h', v: 150 }];

async function homePage() {
  const meta = await api('/api/catalog').catch(() => null);
  const f = { languages: [], genres: [], rating: RATINGS[0], year: YEARS[0], runtime: RUNTIMES[0], kidsSafe: false };
  const toFilters = () => ({
    languages: f.languages, genres: f.genres, minRating: f.rating.v, yearFrom: f.year.from, yearTo: f.year.to, maxRuntime: f.runtime.v, kidsSafe: f.kidsSafe,
  });

  const name = h('input', { class: 'input', placeholder: 'Your name', maxlength: 24, value: ls.get('fs:name') || '', autocomplete: 'given-name', enterkeyhint: 'go' });
  const count = h('div', { class: 'count' });
  const sum = h('span', { class: 'sum' });
  const start = h('button', { class: 'btn primary block' }, 'Start a movie night');
  let lastCount = meta?.total ?? 0;

  const langName = (code) => meta.languages.find((l) => l.code === code)?.name || code;
  function summary() {
    const parts = [
      f.languages.length ? f.languages.map(langName).join(', ') : null,
      f.genres.length ? f.genres.join(', ') : null,
      f.rating.v ? `IMDb ${f.rating.label}` : null,
      f.year.label !== 'Any' ? f.year.label : null,
      f.runtime.v ? f.runtime.label : null,
      f.kidsSafe ? 'Family' : null,
    ].filter(Boolean);
    sum.textContent = parts.join(' · ') || 'All movies';
  }

  let countTimer;
  function changed() {
    summary();
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const { count: n } = await api('/api/catalog/count', { method: 'POST', body: { filters: toFilters() } }).catch(() => ({ count: lastCount }));
      lastCount = n;
      count.replaceChildren(h('b', null, n.toLocaleString('en-IN')), n === 1 ? ' movie on Netflix India' : ' movies on Netflix India');
      start.disabled = n === 0;
    }, 150);
  }

  function chipRow(options, isOn, toggle, limit) {
    const row = h('div', { class: 'chips' });
    let all = false;
    const draw = () => {
      const shown = limit && !all ? options.slice(0, limit) : options;
      row.replaceChildren(
        ...shown.map((o) =>
          h('button', { type: 'button', class: `chip ${isOn(o) ? 'on' : ''}`, onclick: () => { toggle(o); draw(); changed(); } }, o.label)
        )
      );
      if (limit && options.length > limit && !all) row.append(h('button', { type: 'button', class: 'chip more', onclick: () => { all = true; draw(); } }, 'More'));
    };
    draw();
    return row;
  }
  const multi = (list) => [(o) => list.includes(o.value), (o) => (list.includes(o.value) ? list.splice(list.indexOf(o.value), 1) : list.push(o.value))];
  const group = (label, row) => h('div', null, h('div', { class: 'label' }, label), row);

  const filters = meta?.total
    ? h('details', { class: 'filters' },
        h('summary', null, h('span', null, 'Filters'), sum, h('span', { class: 'chev' }, icon('chev'))),
        h('div', { class: 'body' },
          group('Language', chipRow(meta.languages.map((l) => ({ label: l.name, value: l.code })), ...multi(f.languages), 10)),
          group('Genre', chipRow(meta.genres.map((g) => ({ label: g, value: g })), ...multi(f.genres))),
          group('IMDb rating', chipRow(RATINGS, (o) => f.rating === o, (o) => (f.rating = o))),
          group('Released', chipRow(YEARS, (o) => f.year === o, (o) => (f.year = o))),
          group('Length', chipRow(RUNTIMES, (o) => f.runtime === o, (o) => (f.runtime = o))),
          group('Audience', chipRow([{ label: 'Family-friendly only' }], () => f.kidsSafe, () => (f.kidsSafe = !f.kidsSafe)))
        )
      )
    : null;

  start.onclick = async () => {
    const n = name.value.trim();
    if (!n) return name.focus(), toast('Add your name first');
    start.disabled = true;
    try {
      const { code, token } = await api('/api/sessions', { method: 'POST', body: { name: n, filters: toFilters() } });
      ls.set('fs:name', n);
      ls.set(`fs:${code}`, token);
      location.assign(`/s/${code}`);
    } catch (e) {
      toast(e.message);
      start.disabled = false;
    }
  };
  name.onkeydown = (e) => e.key === 'Enter' && start.click();

  const code = h('input', { class: 'input', placeholder: 'Code', maxlength: 6, autocapitalize: 'characters', autocomplete: 'off', enterkeyhint: 'go' });
  const go = () => {
    const c = code.value.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(c)) location.assign(`/s/${c}`);
    else toast('Codes are 6 letters or numbers');
  };
  code.onkeydown = (e) => e.key === 'Enter' && go();

  if (!meta?.total) start.disabled = true;
  $app.replaceChildren(
    h('div', { class: 'home fade-in' },
      h('h1', { class: 'wordmark' }, 'FlickSwipe', h('span', null, '.')),
      h('p', { class: 'tagline' }, 'Everyone swipes. One movie wins.'),
      name,
      filters,
      start,
      meta?.total ? count : h('div', { class: 'count' }, 'Movie list is being prepared. Check back in a few minutes.'),
      h('div', { class: 'divider' }, 'or join one'),
      h('div', { class: 'join-row' }, code, h('button', { class: 'btn ghost', onclick: go }, 'Join')),
      h('p', { class: 'foot' },
        meta?.updatedAt ? `Netflix India list updated ${new Date(meta.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. ` : '',
        h('br'),
        'Movie data from TMDB, ratings from IMDb. This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with Netflix.'
      )
    )
  );
  if (meta?.total) changed();
}

// ---------- session ----------

function message(title, text) {
  $app.replaceChildren(
    h('div', { class: 'center fade-in' }, h('h1', null, title), h('p', null, text), h('a', { class: 'btn primary', href: '/' }, 'Start a new one'))
  );
}

async function sessionPage(code) {
  const token = ls.get(`fs:${code}`);
  let info;
  try {
    info = await api(`/api/sessions/${code}`, { token });
  } catch (e) {
    return e.status === 404 ? message('Session ended', 'This movie night has expired or never existed.') : message('Hmm', e.message);
  }
  if (!info.me) return joinPage(code, info);
  swipePage(code, token, info);
}

function joinPage(code, info) {
  const name = h('input', { class: 'input', placeholder: 'Your name', maxlength: 24, value: ls.get('fs:name') || '', autocomplete: 'given-name', enterkeyhint: 'go' });
  const btn = h('button', { class: 'btn primary block' }, 'Join');
  btn.onclick = async () => {
    const n = name.value.trim();
    if (!n) return name.focus(), toast('Add your name first');
    btn.disabled = true;
    try {
      const { token } = await api(`/api/sessions/${code}/join`, { method: 'POST', body: { name: n } });
      ls.set('fs:name', n);
      ls.set(`fs:${code}`, token);
      sessionPage(code);
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  };
  name.onkeydown = (e) => e.key === 'Enter' && btn.click();
  $app.replaceChildren(
    h('div', { class: 'center fade-in' },
      h('div', { class: 'avatars', style: 'justify-content:center' }, info.members.map((m, i) => avatar({ ...m, online: true }, i))),
      h('h1', null, `Join ${info.host}'s movie night`),
      h('p', null, `${info.deckSize} Netflix India movies. Swipe right on what you'd watch. When everyone agrees, it's a match.`),
      name,
      btn
    )
  );
  name.focus();
}

function swipePage(code, token, info) {
  const S = {
    state: info,
    myId: info.me.id,
    pos: info.me.position,
    queue: [],
    loading: false,
    busy: false,
    seen: new Set(info.matches.map((m) => m.id)),
    movies: new Map(),
    matchQueue: [],
  };
  const path = `/api/sessions/${code}`;

  // --- layout ---
  const codeBtn = h('button', { class: 'pill code', onclick: invite }, code, icon('share'));
  const avatars = h('button', { class: 'avatars', onclick: showMembers, 'aria-label': 'People' });
  const matchesBtn = h('button', { class: 'pill matches', onclick: showMatches });
  const stack = h('div', { class: 'stack' });
  const hint = h('div', { class: 'hint' });
  const undoBtn = h('button', { class: 'round small', 'aria-label': 'Undo', onclick: doUndo }, icon('undo'));
  const nopeBtn = h('button', { class: 'round nope', 'aria-label': 'Nope', onclick: () => decide(false) }, icon('x'));
  const likeBtn = h('button', { class: 'round like', 'aria-label': 'Like', onclick: () => decide(true) }, icon('heart'));
  $app.replaceChildren(
    h('div', { class: 'swipe fade-in' },
      h('header', { class: 'bar' }, codeBtn, h('div', { class: 'spacer' }), avatars, matchesBtn),
      stack,
      hint,
      h('div', { class: 'controls' }, nopeBtn, undoBtn, likeBtn)
    )
  );

  function renderTop() {
    const ms = S.state.members;
    const shown = ms.slice(0, 4).map((m, i) => avatar(m, i));
    if (ms.length > 4) shown.push(h('span', { class: 'av more' }, `+${ms.length - 4}`));
    avatars.replaceChildren(...shown);
    const n = S.state.matches.length;
    if (matchesBtn.dataset.n !== String(n)) {
      matchesBtn.replaceChildren(icon('heart'), String(n));
      if (matchesBtn.dataset.n) {
        matchesBtn.classList.remove('bump');
        void matchesBtn.offsetWidth;
        matchesBtn.classList.add('bump');
      }
      matchesBtn.dataset.n = String(n);
    }
  }

  function renderHint() {
    const others = S.state.members.filter((m) => m.id !== S.myId);
    const deck = S.state.deckSize;
    undoBtn.disabled = S.pos === 0;
    nopeBtn.disabled = likeBtn.disabled = S.pos >= deck;
    if (S.pos >= deck) return (hint.textContent = '');
    if (!others.length) return (hint.textContent = 'Share the code so others can join');
    const swiped = others.filter((m) => m.position > S.pos).length;
    hint.textContent = `${swiped} of ${others.length} ${others.length === 1 ? 'other has' : 'others have'} swiped this · ${S.pos + 1}/${deck}`;
  }

  // --- cards ---
  const els = new Map(); // movie id -> card element (not counting cards flying away)

  function cardEl(m) {
    const el = h('div', { class: 'card' },
      m.poster ? h('img', { class: 'poster', src: `${IMG}w780${m.poster}`, alt: '', draggable: 'false' }) : h('div', { class: 'noposter' }, m.title),
      h('div', { class: 'stamp like' }, 'LIKE'),
      h('div', { class: 'stamp nope' }, 'NOPE'),
      m.trailer ? h('div', { class: 'tag' }, icon('play'), 'Trailer') : null,
      h('div', { class: 'shade' },
        h('div', { class: 'title' }, m.title),
        h('div', { class: 'sub' }, m.gone ? 'Left Netflix India since this session started' : subline(m)),
        h('div', { class: 'row' }, rating(m), h('span', { class: 'genres' }, m.genres.slice(0, 3).join(', '))),
        m.cast.length ? h('div', { class: 'cast' }, m.cast.slice(0, 3).join(', ')) : null
      )
    );
    drag(el, m);
    return el;
  }

  function renderStack(enterFromLeft = false) {
    const want = S.queue.slice(0, 2);
    for (const [id, el] of els) if (!want.some((m) => m.id === id)) (el.remove(), els.delete(id));
    stack.querySelector('.done')?.remove();
    want.forEach((m, i) => {
      let el = els.get(m.id);
      if (!el) {
        el = cardEl(m);
        els.set(m.id, el);
        stack.prepend(el); // newer cards go underneath
      }
      el.classList.toggle('top', i === 0);
      el.classList.toggle('next', i === 1);
      if (i === 0) stack.append(el);
    });
    if (enterFromLeft && want[0]) {
      const el = els.get(want[0].id);
      el.style.transition = 'none';
      el.style.transform = 'translateX(-120%) rotate(-18deg)';
      void el.offsetWidth;
      el.style.transition = '';
      el.style.transform = '';
    }
    if (!want.length) {
      const done = S.pos >= S.state.deckSize;
      stack.append(
        h('div', { class: 'done' },
          done ? h('h2', null, "That's every movie") : h('div', { class: 'spinner' }),
          done ? h('p', null, 'Matches show up as the others finish swiping.') : null,
          done ? h('button', { class: 'btn ghost', onclick: showMatches }, `See matches (${S.state.matches.length})`) : null
        )
      );
    }
  }

  function drag(el, m) {
    let x0 = 0, y0 = 0, dx = 0, dy = 0, active = false;
    const next = () => stack.querySelector('.card.next');
    const stamps = (v) => {
      el.querySelector('.stamp.like').style.opacity = Math.max(0, Math.min(1, v / 90));
      el.querySelector('.stamp.nope').style.opacity = Math.max(0, Math.min(1, -v / 90));
    };
    el.addEventListener('pointerdown', (e) => {
      if (!el.classList.contains('top') || S.busy) return;
      active = true;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = dy = 0;
      el.setPointerCapture(e.pointerId);
      el.style.transition = 'none';
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      dx = e.clientX - x0;
      dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 16}deg)`;
      stamps(dx);
      const n = next();
      if (n) {
        const p = Math.min(1, Math.abs(dx) / 140);
        n.style.transition = 'none';
        n.style.transform = `scale(${0.94 + 0.06 * p}) translateY(${14 - 14 * p}px)`;
        n.style.opacity = 0.7 + 0.3 * p;
      }
    });
    const end = () => {
      if (!active) return;
      active = false;
      el.style.transition = '';
      const n = next();
      if (n) n.style.transition = n.style.transform = n.style.opacity = '';
      if (Math.hypot(dx, dy) < 6) {
        el.style.transform = '';
        return details(m);
      }
      if (Math.abs(dx) > Math.min(110, el.offsetWidth * 0.28)) return decide(dx > 0, dy);
      el.style.transform = '';
      stamps(0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  async function decide(like, dy = 0) {
    const m = S.queue[0];
    if (!m || S.busy) return;
    S.busy = true;
    buzz(8);
    const el = els.get(m.id);
    els.delete(m.id);
    if (el) {
      const dir = like ? 1 : -1;
      el.classList.remove('top');
      el.style.zIndex = 3;
      el.style.transition = 'transform 0.4s cubic-bezier(.3,.6,.4,1), opacity 0.4s';
      el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${dy * 0.35 - 30}px) rotate(${dir * 28}deg)`;
      el.querySelector(like ? '.stamp.like' : '.stamp.nope').style.opacity = 1;
      setTimeout(() => el.remove(), 420);
    }
    S.queue.shift();
    S.pos++;
    renderStack();
    renderHint();
    setTimeout(() => (S.busy = false), 180);
    fill();
    try {
      const r = await api(`${path}/swipe`, { method: 'POST', token, body: { movieId: m.id, like } });
      if (r.match) showMatch(r.match.id);
    } catch (e) {
      toast(e.message);
      resync();
    }
  }

  async function doUndo() {
    if (S.busy || S.pos === 0) return;
    S.busy = true;
    try {
      const r = await api(`${path}/undo`, { method: 'POST', token });
      const [m] = await api(`${path}/cards?from=${r.me.position}&n=1`, { token });
      S.pos = r.me.position;
      S.queue.unshift(m);
      buzz(5);
      renderStack(true);
      renderHint();
    } catch (e) {
      toast(e.message);
    } finally {
      S.busy = false;
    }
  }

  async function fill() {
    if (S.loading || S.queue.length >= 6) return;
    const from = S.pos + S.queue.length;
    if (from >= S.state.deckSize) return renderStack();
    S.loading = true;
    try {
      const cards = await api(`${path}/cards?from=${from}&n=10`, { token });
      if (from === S.pos + S.queue.length) {
        S.queue.push(...cards);
        cards.forEach((c) => c.poster && (new Image().src = `${IMG}w780${c.poster}`));
      }
    } catch (e) {
      toast(e.message);
    } finally {
      S.loading = false;
    }
    renderStack();
  }

  async function resync() {
    try {
      const fresh = await api(path, { token });
      Object.assign(S.state, fresh);
      S.pos = fresh.me.position;
      S.queue = [];
      renderTop();
      renderHint();
      fill();
    } catch (e) {
      toast(e.message);
    }
  }

  // --- matches ---
  async function movies(ids) {
    const missing = ids.filter((id) => !S.movies.has(id));
    if (missing.length) (await api('/api/movies', { method: 'POST', body: { ids: missing } })).forEach((m) => S.movies.set(m.id, m));
    return ids.map((id) => S.movies.get(id));
  }

  async function showMatch(id) {
    if (S.seen.has(id)) return;
    S.seen.add(id);
    S.matchQueue.push(id);
    if (S.matchQueue.length === 1) nextMatch();
  }

  async function nextMatch() {
    const id = S.matchQueue[0];
    if (id == null) return;
    const [m] = await movies([id]).catch(() => [null]);
    if (!m) return S.matchQueue.shift(), nextMatch();
    buzz([30, 60, 30]);
    const done = () => {
      closeLayer(ov);
      S.matchQueue.shift();
      setTimeout(nextMatch, 250);
    };
    const ov = h('div', { class: 'overlay' },
      h('div', { class: 'match' },
        h('p', { class: 'kicker' }, "It's a match"),
        m.poster ? h('img', { src: `${IMG}w500${m.poster}`, alt: '' }) : null,
        h('h2', null, m.title),
        h('p', null, 'Everyone swiped right.'),
        h('a', { class: 'btn primary', href: netflixUrl(m), target: '_blank', rel: 'noopener' }, 'Watch on Netflix'),
        h('button', { class: 'btn ghost', onclick: () => { done(); details(m); } }, icon('play'), 'Trailer & details'),
        h('button', { class: 'btn text', onclick: done }, 'Keep swiping')
      )
    );
    document.body.append(ov);
  }

  async function showMatches() {
    const list = h('div', { class: 'list' }, h('div', { class: 'spinner', style: 'margin:20px auto' }));
    const close = sheet(h('h3', null, 'Matches'), list);
    const ms = [...S.state.matches].reverse();
    if (!ms.length) return list.replaceChildren(h('p', { class: 'empty' }, 'No matches yet. Keep swiping!'));
    const items = await movies(ms.map((x) => x.id)).catch(() => []);
    list.replaceChildren(
      ...items.map((m) =>
        h('button', { class: 'item', onclick: () => { close(); details(m); } },
          m.poster ? h('img', { src: `${IMG}w185${m.poster}`, alt: '' }) : h('span', { class: 'ph' }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, m.title), h('div', { class: 's' }, subline(m))),
          rating(m)
        )
      )
    );
  }

  function showMembers() {
    sheet(
      h('h3', null, `${S.state.members.length} watching`),
      h('div', { class: 'list' },
        S.state.members.map((m, i) =>
          h('div', { class: 'item member' },
            avatar({ ...m, online: true }, i),
            h('div', { class: 'grow' },
              h('div', { class: 't' }, m.id === S.myId ? `${m.name} (you)` : m.name),
              h('div', { class: 's' }, `${Math.min(m.id === S.myId ? S.pos : m.position, S.state.deckSize)} of ${S.state.deckSize} swiped`)
            ),
            h('span', { class: `dot ${m.online ? 'on' : ''}`, title: m.online ? 'Online' : 'Away' })
          )
        )
      ),
      h('button', { class: 'btn primary block', style: 'margin-top:16px', onclick: invite }, icon('share'), 'Invite people')
    );
  }

  async function invite() {
    const url = `${location.origin}/s/${code}`;
    const text = `Help pick tonight's movie! Join with code ${code}`;
    if (navigator.share) {
      try {
        return await navigator.share({ title: 'FlickSwipe', text, url });
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch {
      toast(url);
    }
  }

  // --- live updates ---
  const events = new EventSource(`${path}/events?token=${encodeURIComponent(token)}`);
  events.onmessage = (e) => {
    const st = JSON.parse(e.data);
    Object.assign(S.state, st);
    renderTop();
    renderHint();
    if (!S.queue.length) renderStack();
    st.matches.forEach((m) => showMatch(m.id));
  };

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input') || document.querySelector('.backdrop, .overlay')) return;
    if (e.key === 'ArrowRight') decide(true);
    else if (e.key === 'ArrowLeft') decide(false);
    else if (e.key === 'Backspace' || e.key === 'z') doUndo();
  });

  renderTop();
  renderHint();
  fill();
}

// ---------- route ----------

const route = location.pathname.match(/^\/s\/([A-Za-z0-9]{6})\/?$/);
if (route) sessionPage(route[1].toUpperCase());
else homePage();
