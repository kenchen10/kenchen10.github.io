// Photography page, All photos view (#photo-all in images.html): shows every photo in a
// random order, in rows that are all the same height (--row-h in the stylesheet).
// Each photo gets the width its shape needs at that height; a row's photos are then
// squeezed or stretched together to fill the width exactly, which crops them a little.
// Row breaks are chosen to keep that squeeze/stretch as small as possible.
// Clicking a photo opens it full-screen here (closing it stays on All photos); the
// viewer's "View album" button goes to the photo on its album page.
(function () {
  const grid = document.getElementById('photo-all');
  if (!grid) return;
  const items = [...grid.children];

  // A fresh random order on every visit
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  grid.append(...items);

  const ratios = items.map(a => parseFloat(a.style.getPropertyValue('--ar')) || 1.5);
  let lastWidth = 0;

  function layout() {
    const width = grid.clientWidth;
    if (!width || width === lastWidth) return;  // hidden, or nothing changed
    lastWidth = width;
    const style = getComputedStyle(grid);
    const rowH = parseFloat(style.getPropertyValue('--row-h')) || 200;
    const gap = parseFloat(style.columnGap) || 0;

    let start = 0;
    while (start < items.length) {
      // Add photos until the row is full, then keep the next one only if squeezing it in
      // distorts the row less than stretching the row without it would.
      let natural = 0, end = start;
      while (end < items.length) {
        const next = natural + ratios[end] * rowH;
        const room = width - gap * (end - start);
        if (next >= room) {
          const roomWithout = room + gap;
          const keep = end === start || Math.log(next / room) < Math.log(roomWithout / natural);
          if (keep) { natural = next; end++; }
          break;
        }
        natural = next;
        end++;
      }
      const last = end >= items.length;
      const room = width - gap * (end - start - 1) - 1;  // 1px to spare so rounding never wraps
      const scale = last ? Math.min(1, room / natural) : room / natural;
      for (let i = start; i < end; i++) {
        const s = items[i].style;
        s.flex = `0 0 ${(ratios[i] * rowH * scale).toFixed(2)}px`;
      }
      if (!last) items[end - 1].style.flexGrow = 1;  // soak up the spare pixel
      start = end;
    }
  }

  new ResizeObserver(layout).observe(grid);

  // ---- Full-screen viewer (same look as the album pages' viewer in assets/album.js) ----
  const viewer = document.createElement('div');
  viewer.className = 'lightbox';
  viewer.hidden = true;
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', 'Photo viewer');
  viewer.innerHTML =
    '<figure class="lightbox-figure"><div class="lightbox-info"><span class="lightbox-caption">' +
    '<span class="lightbox-place"></span><span class="lightbox-date"></span></span>' +
    '<a class="lightbox-album">View album &rarr;</a></div><img class="lightbox-img" alt=""></figure>' +
    '<button class="lightbox-btn lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
    '<button class="lightbox-btn lightbox-next" aria-label="Next photo">&#8250;</button>' +
    '<button class="lightbox-btn lightbox-close" aria-label="Close">&times;</button>' +
    '<div class="lightbox-count"></div>';
  document.body.appendChild(viewer);
  const img = viewer.querySelector('.lightbox-img');
  const place = viewer.querySelector('.lightbox-place');
  const date = viewer.querySelector('.lightbox-date');
  const albumLink = viewer.querySelector('.lightbox-album');
  const count = viewer.querySelector('.lightbox-count');
  let current = 0, lastFocus = null;

  // items is in the shuffled order, so arrowing through follows the grid
  function show(i) {
    current = (i + items.length) % items.length;
    const a = items[current];
    img.src = a.dataset.full;
    img.alt = a.dataset.place;
    place.textContent = a.dataset.place;
    date.textContent = a.dataset.date;
    albumLink.href = a.href;
    count.textContent = `${current + 1} / ${items.length}`;
    // Preload the neighbours so arrowing through feels instant
    [current - 1, current + 1].forEach(j => { new Image().src = items[(j + items.length) % items.length].dataset.full; });
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

  items.forEach((a, i) => a.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;  // new tab: open the album as usual
    e.preventDefault();
    open(i);
  }));
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
})();
