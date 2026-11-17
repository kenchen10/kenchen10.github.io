// Timeline page: on wide screens, entries with an `image:` get that picture in a
// right-hand collage, joined to the entry by a thin line. Pictures are packed into
// two lanes (whichever lets a picture sit closest to its entry) and get a small,
// stable "random" tilt and offset, so the panel feels hand-arranged but tidy.
// On narrow screens (or without JavaScript) pictures stay inline under their entries.
(function () {
  const wrap = document.getElementById('timeline-wrap');
  if (!wrap) return;
  const list = wrap.querySelector('.timeline-list');
  const panel = wrap.querySelector('.timeline-panel');
  const svg = wrap.querySelector('.timeline-links');
  const NS = 'http://www.w3.org/2000/svg';
  const wide = window.matchMedia('(min-width: 901px)');
  const GAP = 8;  // minimum vertical space between pictures in the same lane

  // Small deterministic random numbers from a string, so the layout is the same on every visit
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  // One collage picture per entry, linking to the first link in the entry if it has one
  const cards = [...list.querySelectorAll('.tl-item[data-image]')].map(item => {
    const card = document.createElement('a');
    card.className = 'timeline-card';
    const link = item.querySelector('.tl-text a');
    if (link) card.href = link.href;
    const img = item.querySelector('.tl-thumb img').cloneNode();
    card.appendChild(img);
    panel.appendChild(card);
    card.item = item;
    const rand = seeded(img.getAttribute('src'));
    card.jitter = { rot: (rand() - 0.5) * 6, dx: (rand() - 0.5) * 16, dy: (rand() - 0.5) * 10, lane: rand() };
    card.style.setProperty('--rot', card.jitter.rot.toFixed(2) + 'deg');
    const on = v => () => [card, item, card.path, card.dot].forEach(el => el && el.classList.toggle('hl', v));
    [card, item].forEach(el => { el.addEventListener('mouseenter', on(true)); el.addEventListener('mouseleave', on(false)); });
    img.addEventListener('load', layout);
    return card;
  });

  function layout() {
    const active = wide.matches && cards.length > 0;
    wrap.classList.toggle('panel-on', active);
    svg.innerHTML = '';
    if (!active) return;

    const box = wrap.getBoundingClientRect();
    const listRight = list.getBoundingClientRect().right - box.left;
    const panelBox = panel.getBoundingClientRect();
    const panelLeft = panelBox.left - box.left;
    const cardW = cards[0].offsetWidth;
    const laneX = [0, panelBox.width - cardW];  // left lane, right lane
    const laneBottom = [-Infinity, -Infinity];
    let bottom = 0;

    cards.forEach(card => {
      // End of the entry's text (its last line, if it wraps)
      const range = document.createRange();
      range.selectNodeContents(card.item.querySelector('.tl-text'));
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      const x = last.right - box.left + 6;
      const y = (last.top + last.bottom) / 2 - box.top;

      // Put the picture in whichever lane lets it sit closest to its entry
      // (ties go to a lane picked at random for this picture)
      const h = card.offsetHeight;
      const want = y - h / 2 + card.jitter.dy;
      const tops = laneX.map((_, i) => Math.max(0, want, laneBottom[i] + GAP));
      let lane = tops[0] === tops[1] ? (card.jitter.lane < 0.5 ? 0 : 1) : (tops[0] < tops[1] ? 0 : 1);
      const top = tops[lane];
      const left = Math.min(panelBox.width - cardW, Math.max(0, laneX[lane] + card.jitter.dx));
      card.style.top = top + 'px';
      card.style.left = left + 'px';
      laneBottom[lane] = top + h;
      bottom = Math.max(bottom, top + h);

      // Line: along the entry's row, across the gap, to the picture's left edge
      // (drawn underneath the pictures, so it tucks behind any in the left lane)
      const endX = panelLeft + left;
      const endY = top + h / 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M ${x} ${y} H ${listRight + 10} L ${panelLeft - 10} ${endY} H ${endX}`);
      path.setAttribute('class', 'timeline-link');
      svg.appendChild(path);
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', 2.5);
      dot.setAttribute('class', 'timeline-link-dot');
      svg.appendChild(dot);
      card.path = path;
      card.dot = dot;
    });
    panel.style.minHeight = bottom + 'px';
  }

  layout();
  wide.addEventListener('change', layout);
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(layout, 100); });
  if (document.fonts) document.fonts.ready.then(layout);  // text widths change once the font loads
})();
