// Album pages: equal-width masonry columns and a full-screen photo viewer.
(function () {
  const box = document.getElementById('album-photos');
  if (!box) return;
  const items = [...box.querySelectorAll('.album-item')];
  const GAP = 18;
  const twoCols = window.matchMedia('(min-width: 700px)');

  // ---- Masonry: same width for every photo; each goes into the shorter column ----
  // Heights come from the width/height attributes, so this works before images load.
  const ratio = el => {
    const m = el.querySelector('img, video');
    const w = +m.getAttribute('width'), h = +m.getAttribute('height');
    return w && h ? h / w : 0.67;
  };
  function arrange() {
    box.querySelectorAll('.album-col').forEach(c => c.remove());
    if (!twoCols.matches || items.length < 2) {
      box.classList.remove('cols');
      items.forEach(el => box.appendChild(el));  // back to the original order
      return;
    }
    box.classList.add('cols');
    const cols = [0, 1].map(() => { const c = document.createElement('div'); c.className = 'album-col'; box.appendChild(c); return c; });
    pickColumns(items.map(el => ratio(el) + GAP / 480)).forEach((c, i) => cols[c].appendChild(items[i]));
  }

  // Which column each photo goes in. For albums up to 16 photos, try every split and keep
  // the one with the most even column heights, preferring splits that stay closest to the
  // album's order when read left-to-right, top-to-bottom. Bigger albums: shortest column first.
  function pickColumns(h) {
    const n = h.length;
    const greedy = () => { const t = [0, 0]; return h.map(x => { const c = t[0] <= t[1] ? 0 : 1; t[c] += x; return c; }); };
    if (n > 16) return greedy();
    let best = null, bestCost = Infinity;
    for (let mask = 0; mask < (1 << n); mask++) {
      if (mask & 1) continue;  // the first photo always starts the left column
      const t = [0, 0], tops = [];
      for (let i = 0; i < n; i++) { const c = (mask >> i) & 1; tops.push([t[c], c, i]); t[c] += h[i]; }
      const order = tops.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const disorder = order.reduce((sum, [, , i], rank) => sum + Math.abs(rank - i), 0);
      const cost = Math.abs(t[0] - t[1]) + 0.02 * disorder;
      if (cost < bestCost) { bestCost = cost; best = mask; }
    }
    return h.map((_, i) => (best >> i) & 1);
  }
  arrange();
  twoCols.addEventListener('change', arrange);

  // ---- Full-screen viewer ----
  const photos = items.filter(el => el.tagName === 'A');
  if (!photos.length) return;
  const viewer = document.createElement('div');
  viewer.className = 'lightbox';
  viewer.hidden = true;
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', 'Photo viewer');
  viewer.innerHTML =
    '<img class="lightbox-img" alt="">' +
    '<button class="lightbox-btn lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
    '<button class="lightbox-btn lightbox-next" aria-label="Next photo">&#8250;</button>' +
    '<button class="lightbox-btn lightbox-close" aria-label="Close">&times;</button>' +
    '<div class="lightbox-count"></div>';
  document.body.appendChild(viewer);
  const img = viewer.querySelector('.lightbox-img');
  const count = viewer.querySelector('.lightbox-count');
  let current = 0, lastFocus = null;

  function show(i) {
    current = (i + photos.length) % photos.length;
    img.src = photos[current].href;
    img.alt = photos[current].querySelector('img').alt;
    count.textContent = `${current + 1} / ${photos.length}`;
    // Preload the neighbours so arrowing through feels instant
    [current - 1, current + 1].forEach(j => { new Image().src = photos[(j + photos.length) % photos.length].href; });
  }
  function open(i) {
    lastFocus = document.activeElement;
    show(i);
    viewer.hidden = false;
    document.body.classList.add('lightbox-open');
    viewer.querySelector('.lightbox-close').focus();
  }
  function close() {
    viewer.hidden = true;
    document.body.classList.remove('lightbox-open');
    if (lastFocus) lastFocus.focus();
  }

  photos.forEach((a, i) => a.addEventListener('click', e => { e.preventDefault(); open(i); }));
  viewer.querySelector('.lightbox-prev').addEventListener('click', () => show(current - 1));
  viewer.querySelector('.lightbox-next').addEventListener('click', () => show(current + 1));
  viewer.querySelector('.lightbox-close').addEventListener('click', close);
  viewer.addEventListener('click', e => { if (e.target === viewer) close(); });  // click the dark background
  document.addEventListener('keydown', e => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(current - 1);
    else if (e.key === 'ArrowRight') show(current + 1);
  });
  // Swipe left/right on touch screens
  let x0 = null;
  viewer.addEventListener('pointerdown', e => { x0 = e.clientX; });
  viewer.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });
  if (photos.length < 2) viewer.querySelectorAll('.lightbox-prev, .lightbox-next').forEach(b => { b.hidden = true; });
  // A link ending in #photo-3 (from the map on the Photography page) opens that photo
  const deep = location.hash.match(/^#photo-(\d+)$/);
  if (deep && photos[deep[1] - 1]) open(deep[1] - 1);
})();
