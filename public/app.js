const $app = document.getElementById('app');
const IMG = 'https://image.tmdb.org/t/p/';
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('touchstart', () => {}, { passive: true }); // lets :active styles work on iOS
// No page zoom: iOS Safari ignores user-scalable=no, so block pinch gestures directly.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

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
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.3" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="8" cy="17" r="2.3" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  ticket: '<path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 9v6" stroke="currentColor" stroke-width="2" stroke-dasharray="1.5 2"/>',
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
  if (!el) document.body.append((el = h('div', { class: 'toast glass', role: 'status' })));
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Vibration where supported; on iOS 18+ Safari, toggling a hidden switch gives a light haptic tap.
let hapticLabel;
function haptic(pattern = 10) {
  if (navigator.vibrate) return navigator.vibrate(pattern);
  if (!isIOS) return;
  if (!hapticLabel) {
    const input = h('input', { type: 'checkbox', switch: true, id: 'haptic', style: 'display:none' });
    hapticLabel = h('label', { for: 'haptic', style: 'display:none' });
    document.body.append(input, hapticLabel);
  }
  hapticLabel.click();
}

const runtime = (m) => (m ? `${Math.floor(m / 60)}h ${m % 60}m`.replace(/^0h /, '') : null);
const subline = (m) => [m.year, runtime(m.runtime), m.cert].filter(Boolean).join(' · ');
const netflixUrl = (m) => `https://www.netflix.com/search?q=${encodeURIComponent(m.title)}`;
const youtubeUrl = (m) =>
  m.trailer ? `https://www.youtube.com/watch?v=${m.trailer}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.title} ${m.year || ''} trailer`)}`;
const rating = (m) => (m.imdbRating ? h('span', { class: 'imdb' }, 'IMDb', h('b', null, m.imdbRating.toFixed(1))) : null);
const COLORS = ['#ffc857', '#3ddc97', '#7cc4ff', '#ff8fa3', '#c9a7ff', '#ffa45c', '#8be0d4', '#f5e663', '#b2e672', '#ff9de2'];
const avatar = (m, i, cls = '') =>
  h('span', { class: `av ${cls} ${m.online ? '' : 'off'}`, style: `background:${COLORS[i % COLORS.length]}`, title: m.name }, m.name[0].toUpperCase());

function closeLayer(el) {
  el.classList.add('closing');
  setTimeout(() => el.remove(), 220);
}

function sheet(...content) {
  const back = h('div', { class: 'backdrop', onclick: (e) => e.target === back && close() });
  const panel = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grab' }), ...content);
  let closed = false;
  const close = ({ dragged = false } = {}) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    if (!dragged) return closeLayer(back);
    // Continue from where the finger let go instead of replaying the closing animation.
    panel.style.transition = 'transform 0.26s cubic-bezier(.4,0,1,1)';
    panel.style.transform = 'translateY(105%)';
    back.style.transition = 'background-color 0.26s';
    back.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    setTimeout(() => back.remove(), 280);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  pullToClose(panel, back, close);
  back.append(panel);
  document.body.append(back);
  return close;
}

// iOS-style dismissal: drag a sheet down (when its content is scrolled to the top) and let go
// past a quarter of its height, or flick it, to close; otherwise it springs back.
function pullToClose(panel, back, close) {
  let startY = null, lastY = 0, lastT = 0, speed = 0, dy = 0, dragging = false;
  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('iframe')) return;
    startY = lastY = e.touches[0].clientY;
    lastT = performance.now();
    speed = dy = 0;
    dragging = false;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const y = e.touches[0].clientY;
    if (!dragging) {
      if (y - startY > 4 && panel.scrollTop <= 0) {
        dragging = true;
        panel.style.transition = 'none';
      } else if (Math.abs(y - startY) > 4) {
        startY = null; // the content scrolls instead
        return;
      } else return;
    }
    e.preventDefault();
    const now = performance.now();
    speed = (y - lastY) / Math.max(1, now - lastT);
    lastY = y;
    lastT = now;
    dy = Math.max(0, y - startY);
    panel.style.transform = `translateY(${dy}px)`;
    back.style.backgroundColor = `rgba(0, 0, 0, ${0.55 * (1 - Math.min(1, dy / panel.offsetHeight))})`;
  }, { passive: false });
  const end = () => {
    if (startY == null) return;
    startY = null;
    if (!dragging) return;
    if (dy > panel.offsetHeight * 0.25 || speed > 0.5) return close({ dragged: true });
    panel.style.transition = 'transform 0.4s cubic-bezier(.3,1.3,.5,1)';
    panel.style.transform = '';
    back.style.backgroundColor = '';
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
}

// Slowly drifting wall of posters behind the start and join screens.
function posterWall(posters = []) {
  const cols = [0, 1, 2].map((c) => {
    const list = posters.filter((_, i) => i % 3 === c);
    return h('div', { class: 'wall-col' }, [...list, ...list].map((p) => h('img', { src: `${IMG}w185${p}`, alt: '' })));
  });
  return h('div', { class: 'wall', 'aria-hidden': 'true' }, h('div', { class: 'wall-grid' }, cols), h('div', { class: 'wall-shade' }));
}

function confetti(host) {
  if (reduceMotion) return;
  const c = h('canvas', { class: 'confetti' });
  host.append(c);
  const dpr = devicePixelRatio || 1;
  const W = (c.width = innerWidth * dpr);
  const H = (c.height = innerHeight * dpr);
  const ctx = c.getContext('2d');
  const colors = ['#ffc857', '#3ddc97', '#ff5c7a', '#7cc4ff', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.4,
    vx: (Math.random() - 0.5) * 16 * dpr,
    vy: (-Math.random() * 18 - 6) * dpr,
    r: (5 + Math.random() * 5) * dpr,
    a: Math.random() * 6.28,
    va: (Math.random() - 0.5) * 0.3,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.5 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.globalAlpha = Math.max(0, 1 - k / 2.6);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (k < 2.6 && c.isConnected) requestAnimationFrame(frame);
    else c.remove();
  })(t0);
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
    h('div', { class: 'meta' }, rating(m), h('span', null, subline(m))),
    m.genres.length ? h('div', { class: 'tags' }, m.genres.slice(0, 4).map((g) => h('span', null, g))) : null,
    m.overview ? h('p', { class: 'overview' }, m.overview) : null,
    m.director ? h('p', { class: 'credit' }, h('span', null, 'Director'), h('b', null, m.director)) : null,
    m.cast.length ? h('p', { class: 'credit' }, h('span', null, 'Cast'), h('b', null, m.cast.join(', '))) : null,
    h('div', { class: 'links' },
      h('a', { class: 'btn primary', href: netflixUrl(m), target: '_blank', rel: 'noopener' }, 'Watch on Netflix'),
      h('a', { class: 'btn glass', href: youtubeUrl(m), target: '_blank', rel: 'noopener' }, 'YouTube'),
      m.imdbId ? h('a', { class: 'btn glass', href: `https://www.imdb.com/title/${m.imdbId}/`, target: '_blank', rel: 'noopener' }, 'IMDb') : null
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

function chips(options, isOn, toggle, onChange, cls = 'chips') {
  const row = h('div', { class: cls });
  const draw = () =>
    row.replaceChildren(
      ...options.map((o) =>
        h('button', { type: 'button', class: `chip ${isOn(o) ? 'on' : ''}`, onclick: () => { haptic(); toggle(o); draw(); onChange(); } }, o.label)
      )
    );
  draw();
  return row;
}
const toggleIn = (list, v) => (list.includes(v) ? list.splice(list.indexOf(v), 1) : list.push(v));

function joinSheet() {
  const input = h('input', { class: 'input code-input', placeholder: 'ABC123', maxlength: 6, autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  const go = () => {
    const c = input.value.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(c)) location.assign(`/s/${c}`);
    else toast('Codes are 6 letters or numbers');
  };
  input.onkeydown = (e) => e.key === 'Enter' && go();
  sheet(
    h('h3', null, 'Join a movie night'),
    h('p', { class: 'lead' }, 'Enter the code from your invite.'),
    input,
    h('button', { class: 'btn primary block', style: 'margin-top:12px', onclick: go }, 'Join')
  );
  setTimeout(() => input.focus(), 350);
}

async function homePage() {
  const meta = await api('/api/catalog').catch(() => null);
  const ready = meta?.total > 0;
  const f = { cinemas: [], genres: [], rating: RATINGS[0], year: YEARS[0], runtime: RUNTIMES[0], kidsSafe: false };
  const toFilters = () => ({
    cinemas: f.cinemas, genres: f.genres, minRating: f.rating.v, yearFrom: f.year.from, yearTo: f.year.to, maxRuntime: f.runtime.v, kidsSafe: f.kidsSafe,
  });
  const extraCount = () => [f.rating.v, f.year.label !== 'Any', f.runtime.v, f.kidsSafe].filter(Boolean).length;

  const name = h('input', { class: 'input', placeholder: 'Your name', maxlength: 24, value: ls.get('fs:name') || '', autocomplete: 'given-name', enterkeyhint: 'done' });
  const start = h('button', { class: 'btn primary block cta' }, ready ? 'Start' : 'Preparing movie list…');
  const moreBadge = h('span', { class: 'badge' });
  start.disabled = !ready;

  let countTimer;
  function changed() {
    const n = extraCount();
    moreBadge.textContent = n || '';
    moreBadge.hidden = !n;
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const r = await api('/api/catalog/count', { method: 'POST', body: { filters: toFilters() } }).catch(() => null);
      if (!r) return;
      start.disabled = r.count === 0;
      start.replaceChildren(r.count ? 'Start' : 'No movies match');
    }, 120);
  }

  const tiles = h('div', { class: 'tiles' });
  const drawTiles = () =>
    tiles.replaceChildren(
      ...(meta?.cinemas || []).map((c) =>
        h('button', { type: 'button', class: `tile ${f.cinemas.includes(c.id) ? 'on' : ''}`, onclick: () => { haptic(); toggleIn(f.cinemas, c.id); drawTiles(); changed(); } },
          h('span', { class: 'tick' }, icon('check')),
          h('span', { class: 'tile-name' }, c.name),
          h('span', { class: 'tile-sub' }, c.sub)
        )
      )
    );
  drawTiles();

  const genres = chips((meta?.genres || []).map((g) => ({ label: g, v: g })), (o) => f.genres.includes(o.v), (o) => toggleIn(f.genres, o.v), changed, 'chips scroller');

  function moreSheet() {
    const group = (label, row) => h('div', { class: 'group' }, h('div', { class: 'label' }, label), row);
    const close = sheet(
      h('h3', null, 'More filters'),
      group('IMDb rating', chips(RATINGS, (o) => f.rating === o, (o) => (f.rating = o), changed)),
      group('Released', chips(YEARS, (o) => f.year === o, (o) => (f.year = o), changed)),
      group('Length', chips(RUNTIMES, (o) => f.runtime === o, (o) => (f.runtime = o), changed)),
      group('Audience', chips([{ label: 'Family-friendly only' }], () => f.kidsSafe, () => (f.kidsSafe = !f.kidsSafe), changed)),
      h('button', { class: 'btn primary block', onclick: () => close() }, 'Done'),
      h('p', { class: 'fine' },
        meta?.updatedAt ? `Netflix India list updated ${new Date(meta.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. ` : '',
        'Movie data from TMDB, ratings from IMDb. This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with Netflix.'
      )
    );
  }

  start.onclick = async () => {
    const n = name.value.trim();
    if (!n) return name.focus(), toast('Add your name first');
    start.disabled = true;
    haptic();
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
  name.onkeydown = (e) => e.key === 'Enter' && name.blur();

  $app.replaceChildren(
    posterWall(meta?.posters),
    h('div', { class: 'home' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('ticket')), 'FlickSwipe'),
      h('h1', { class: 'headline' }, 'Movie night,', h('br'), h('span', null, 'decided together.')),
      h('p', { class: 'lead' }, 'Everyone swipes on what’s streaming on Netflix India. When you all say yes, it’s a match.'),
      name,
      ready ? h('div', { class: 'label' }, 'Cinema') : null,
      ready ? tiles : null,
      ready ? h('div', { class: 'label' }, 'Genre') : null,
      ready ? genres : null,
      h('div', { class: 'row-links' },
        ready ? h('button', { class: 'link', onclick: moreSheet }, icon('sliders'), 'More filters', moreBadge) : h('span'),
        h('button', { class: 'link', onclick: joinSheet }, 'Join with a code')
      ),
      h('div', { class: 'cta-wrap' }, start)
    )
  );
  if (ready) changed();
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

async function joinPage(code, info) {
  const meta = await api('/api/catalog').catch(() => null);
  const name = h('input', { class: 'input', placeholder: 'Your name', maxlength: 24, value: ls.get('fs:name') || '', autocomplete: 'given-name', enterkeyhint: 'go' });
  const btn = h('button', { class: 'btn primary block' }, 'Join');
  btn.onclick = async () => {
    const n = name.value.trim();
    if (!n) return name.focus(), toast('Add your name first');
    btn.disabled = true;
    haptic();
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
    posterWall(meta?.posters),
    h('div', { class: 'center fade-in' },
      h('div', { class: 'avatars big' }, info.members.map((m, i) => avatar({ ...m, online: true }, i))),
      h('h1', null, `Join ${info.host}'s movie night`),
      h('p', null, 'Swipe right on what you’d watch on Netflix India. When everyone agrees, it’s a match.'),
      name,
      btn
    )
  );
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
  const amb = [h('div', { class: 'amb' }), h('div', { class: 'amb' })];
  const inviteBtn = h('button', { class: 'pill glass', onclick: invite }, icon('share'), 'Invite');
  const people = h('button', { class: 'pill glass people', onclick: showMembers });
  const matchesBtn = h('button', { class: 'pill glass matches', onclick: showMatches });
  const stack = h('div', { class: 'stack' });
  const undoBtn = h('button', { class: 'round glass small', 'aria-label': 'Undo', onclick: doUndo }, icon('undo'));
  const nopeBtn = h('button', { class: 'round glass nope', 'aria-label': 'Pass', onclick: () => decide(false) }, icon('x'));
  const likeBtn = h('button', { class: 'round glass like', 'aria-label': 'Like', onclick: () => decide(true) }, icon('heart'));
  $app.replaceChildren(
    h('div', { class: 'ambient', 'aria-hidden': 'true' }, amb),
    h('div', { class: 'swipe fade-in' },
      h('header', { class: 'bar' }, inviteBtn, h('div', { class: 'spacer' }), people, matchesBtn),
      stack,
      h('div', { class: 'controls' }, nopeBtn, undoBtn, likeBtn)
    )
  );

  let ambIdx = 0;
  let ambPoster;
  function setAmbient(poster) {
    if (poster === ambPoster) return;
    ambPoster = poster;
    ambIdx ^= 1;
    amb[ambIdx].style.backgroundImage = poster ? `url(${IMG}w342${poster})` : '';
    amb[ambIdx].classList.add('on');
    amb[ambIdx ^ 1].classList.remove('on');
  }

  function renderTop() {
    const ms = S.state.members;
    people.replaceChildren(h('span', { class: 'avatars' }, ms.slice(0, 3).map((m, i) => avatar(m, i))), String(ms.length));
    people.setAttribute('aria-label', `${ms.length} ${ms.length === 1 ? 'person' : 'people'} in this session`);
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

  // Nothing about other people's votes or progress is shown while swiping.
  function renderControls() {
    undoBtn.disabled = S.pos === 0;
    nopeBtn.disabled = likeBtn.disabled = S.pos >= S.state.deckSize;
  }

  // --- cards ---
  const els = new Map(); // movie id -> card element (not counting cards flying away)

  function cardEl(m) {
    const el = h('div', { class: 'card' },
      m.poster ? h('img', { class: 'poster', src: `${IMG}w780${m.poster}`, alt: '', draggable: 'false' }) : h('div', { class: 'noposter' }, m.title),
      h('div', { class: 'tint like' }),
      h('div', { class: 'tint nope' }),
      h('div', { class: 'stamp like' }, icon('heart')),
      h('div', { class: 'stamp nope' }, icon('x')),
      m.trailer ? h('div', { class: 'tag' }, icon('play'), 'Trailer') : null,
      h('div', { class: 'shade' },
        h('div', { class: 'title' }, m.title),
        h('div', { class: 'meta' }, rating(m), h('span', null, m.gone ? 'Left Netflix India since this session started' : subline(m))),
        m.genres.length ? h('div', { class: 'genres' }, m.genres.slice(0, 3).join(' · ')) : null,
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
    setAmbient(want[0]?.poster);
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
          done ? h('h2', null, 'That’s every movie') : h('div', { class: 'spinner' }),
          done ? h('p', null, 'Matches appear as the others finish swiping.') : null,
          done ? h('button', { class: 'btn glass', onclick: showMatches }, `See matches (${S.state.matches.length})`) : null
        )
      );
    }
  }

  function drag(el, m) {
    let x0 = 0, y0 = 0, dx = 0, dy = 0, active = false, armed = 0;
    const next = () => stack.querySelector('.card.next');
    const feedback = (v) => {
      const like = Math.max(0, Math.min(1, v / 100));
      const nope = Math.max(0, Math.min(1, -v / 100));
      el.querySelector('.stamp.like').style.cssText = `opacity:${like};transform:scale(${0.6 + 0.4 * like})`;
      el.querySelector('.stamp.nope').style.cssText = `opacity:${nope};transform:scale(${0.6 + 0.4 * nope})`;
      el.querySelector('.tint.like').style.opacity = like * 0.5;
      el.querySelector('.tint.nope').style.opacity = nope * 0.5;
    };
    el.addEventListener('pointerdown', (e) => {
      if (!el.classList.contains('top') || S.busy) return;
      active = true;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = dy = armed = 0;
      try { el.setPointerCapture(e.pointerId); } catch {} // the pointer may already be gone
      el.style.transition = 'none';
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      dx = e.clientX - x0;
      dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 16}deg)`;
      feedback(dx);
      const past = Math.abs(dx) > threshold() ? Math.sign(dx) : 0;
      if (past && past !== armed) haptic(); // tick when crossing the decision line
      armed = past;
      const n = next();
      if (n) {
        const p = Math.min(1, Math.abs(dx) / 140);
        n.style.transition = 'none';
        n.style.transform = `scale(${0.94 + 0.06 * p}) translateY(${14 - 14 * p}px)`;
        n.style.opacity = 0.6 + 0.4 * p;
      }
    });
    const threshold = () => Math.min(110, el.offsetWidth * 0.28);
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
      if (Math.abs(dx) > threshold()) return decide(dx > 0, dy);
      el.style.transform = '';
      feedback(0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  async function decide(like, dy = 0) {
    const m = S.queue[0];
    if (!m || S.busy) return;
    S.busy = true;
    haptic(8);
    const el = els.get(m.id);
    els.delete(m.id);
    if (el) {
      const dir = like ? 1 : -1;
      el.classList.remove('top');
      el.style.zIndex = 3;
      el.style.transition = 'transform 0.42s cubic-bezier(.3,.6,.4,1), opacity 0.42s';
      el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${dy * 0.35 - 30}px) rotate(${dir * 28}deg)`;
      el.querySelector(like ? '.stamp.like' : '.stamp.nope').style.cssText = 'opacity:1;transform:scale(1)';
      setTimeout(() => el.remove(), 440);
    }
    S.queue.shift();
    S.pos++;
    renderStack();
    renderControls();
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
      haptic(5);
      renderStack(true);
      renderControls();
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
      renderControls();
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

  function showMatch(id) {
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
    haptic([30, 60, 30]);
    const done = () => {
      closeLayer(ov);
      S.matchQueue.shift();
      setTimeout(nextMatch, 250);
    };
    const ov = h('div', { class: 'overlay' },
      m.poster ? h('div', { class: 'overlay-bg', style: `background-image:url(${IMG}w342${m.poster})` }) : null,
      h('div', { class: 'match' },
        h('p', { class: 'kicker' }, 'It’s a match'),
        m.poster ? h('img', { src: `${IMG}w500${m.poster}`, alt: '' }) : null,
        h('h2', null, m.title),
        h('p', null, 'Everyone swiped right.'),
        h('a', { class: 'btn primary', href: netflixUrl(m), target: '_blank', rel: 'noopener' }, 'Watch on Netflix'),
        h('button', { class: 'btn glass', onclick: () => { done(); details(m); } }, icon('play'), 'Trailer & details'),
        h('button', { class: 'btn text', onclick: done }, 'Keep swiping')
      )
    );
    document.body.append(ov);
    confetti(ov);
  }

  async function showMatches() {
    const list = h('div', { class: 'list' }, h('div', { class: 'spinner', style: 'margin:20px auto' }));
    const close = sheet(h('h3', null, 'Matches'), list);
    const ms = [...S.state.matches].reverse();
    if (!ms.length) return list.replaceChildren(h('p', { class: 'empty' }, 'No matches yet. When everyone swipes right on the same movie, it lands here.'));
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
      h('h3', null, `${S.state.members.length} in this movie night`),
      h('p', { class: 'lead' }, `Session code ${code}`),
      h('div', { class: 'list' },
        S.state.members.map((m, i) =>
          h('div', { class: 'item member' },
            avatar({ ...m, online: true }, i),
            h('div', { class: 'grow' },
              h('div', { class: 't' }, m.id === S.myId ? `${m.name} (you)` : m.name),
              h('div', { class: 's' }, (m.id === S.myId ? S.pos : m.position) >= S.state.deckSize ? 'Finished swiping' : m.online ? 'Swiping' : 'Away')
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
    const text = `Help pick tonight’s movie! Join with code ${code}`;
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
  // Only stay connected while the app is on screen: an open connection keeps the server billed.
  let events = null;
  function listen() {
    events = new EventSource(`${path}/events?token=${encodeURIComponent(token)}`);
    events.onmessage = (e) => {
      const st = JSON.parse(e.data);
      Object.assign(S.state, st);
      renderTop();
      renderControls();
      if (!S.queue.length) renderStack();
      st.matches.forEach((m) => showMatch(m.id));
    };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      events?.close();
      events = null;
    } else if (!events) {
      listen();
    }
  });
  if (!document.hidden) listen();

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input') || document.querySelector('.backdrop, .overlay')) return;
    if (e.key === 'ArrowRight') decide(true);
    else if (e.key === 'ArrowLeft') decide(false);
    else if (e.key === 'Backspace' || e.key === 'z') doUndo();
  });

  renderTop();
  renderControls();
  fill();
}

// ---------- route ----------

const route = location.pathname.match(/^\/s\/([A-Za-z0-9]{6})\/?$/);
if (route) sessionPage(route[1].toUpperCase());
else homePage();
