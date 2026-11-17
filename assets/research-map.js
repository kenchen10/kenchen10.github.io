// Research Threads: papers over time across three research areas (home page).
// One lane per area, years left to right. Each paper is a vertical "strand" with a
// dot in every lane it belongs to. Data comes from the JSON block #research-map-data,
// built from the `areas` field in _data/publications.yml and _data/otherpubs.yml.
(function () {
  const root = document.getElementById('research-map');
  if (!root) return;
  const papers = JSON.parse(document.getElementById('research-map-data').textContent)
    .filter(p => Array.isArray(p.areas) && p.areas.length);  // papers without `areas` are left out
  const chart = root.querySelector('.threads');
  const scroller = root.querySelector('.threads-scroll');
  const svg = root.querySelector('.threads-svg');
  const labels = root.querySelector('.threads-labels');
  const tip = root.querySelector('.threads-tip');
  const NS = 'http://www.w3.org/2000/svg';

  const AREAS = {
    hardware:   { label: 'Hardware & Displays', color: '#4f8fd0' },
    software:   { label: 'Algorithms & AI',     color: '#e39a2d' },
    perception: { label: 'Human Perception',    color: '#c2457a' },
  };
  const KEYS = Object.keys(AREAS);
  const LANE_Y = { hardware: 20, software: 54, perception: 88 };
  const HEIGHT = 124, YEAR_Y = 118, PAD_X = 14, MIN_WIDTH = 600, YEAR_GAP = 1.8;

  const el = (name, attrs, parent) => {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Lane names sit outside the scrolling area, so they stay put on phones
  labels.innerHTML = KEYS.map(k =>
    `<button type="button" data-area="${k}" aria-pressed="false" title="Show only ${AREAS[k].label} papers below" ` +
    `style="top:${LANE_Y[k]}px; --c:${AREAS[k].color}">${AREAS[k].label}</button>`).join('');

  // Oldest year on the left; within a year, reverse the data's order (the data is newest first)
  const years = [...new Set(papers.map(p => +p.year))].sort((a, b) => a - b);
  const byYear = years.map(y => papers.filter(p => +p.year === y).reverse());

  let strands = [];
  function draw() {
    const width = Math.max(scroller.clientWidth, MIN_WIDTH);
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', HEIGHT);
    svg.innerHTML = '';
    strands = [];

    const slots = papers.length + (years.length - 1) * YEAR_GAP;
    const step = Math.min(30, (width - 2 * PAD_X) / slots);
    let x = PAD_X + (width - 2 * PAD_X - step * slots) / 2 + step / 2;

    KEYS.forEach(k => el('line', { x1: 0, x2: width, y1: LANE_Y[k], y2: LANE_Y[k], class: 'threads-lane', stroke: AREAS[k].color }, svg));

    byYear.forEach((list, yi) => {
      const start = x;
      list.forEach(p => {
        const lanes = KEYS.filter(k => p.areas.includes(k));
        const ys = lanes.map(k => LANE_Y[k]);
        const g = el('a', { href: p.url || '#', class: 'threads-strand' + (p.poster ? ' poster' : ''),
                            'aria-label': `${p.title} (${p.venue})` }, svg);
        el('rect', { x: x - step / 2, y: 4, width: step, height: YEAR_Y - 16, class: 'threads-hit' }, g);
        if (ys.length > 1) el('line', { x1: x, x2: x, y1: Math.min(...ys), y2: Math.max(...ys), class: 'threads-link' }, g);
        lanes.forEach(k =>
          el('circle', { cx: x, cy: LANE_Y[k], r: 6, fill: p.poster ? '#fff' : AREAS[k].color, stroke: AREAS[k].color }, g));
        g.paper = p;
        g.cx = x;
        strands.push(g);
        x += step;
      });
      const label = el('text', { x: (start + x - step) / 2, y: YEAR_Y, class: 'threads-year', 'text-anchor': 'middle' }, svg);
      label.textContent = years[yi];
      if (yi < years.length - 1) {
        const sep = x - step / 2 + (YEAR_GAP * step) / 2;
        el('line', { x1: sep, x2: sep, y1: 6, y2: YEAR_Y - 4, class: 'threads-sep' }, svg);
      }
      x += YEAR_GAP * step;
    });

    strands.forEach(g => {
      g.addEventListener('mouseenter', () => show(g));
      g.addEventListener('focus', () => show(g));
      // Touch: first tap shows the paper, a second tap on the same strand opens it
      g.addEventListener('click', e => { if (touch && active !== g) { e.preventDefault(); show(g); } });
    });
  }

  // Highlighting and the floating card
  let active = null, touch = false;
  const focus = match => {
    root.classList.toggle('threads-focus', !!match);
    strands.forEach(g => {
      g.classList.toggle('on', !!match && match(g.paper));
      g.classList.toggle('current', g === active);
    });
  };
  function show(g) {
    active = g;
    root.dataset.area = '';
    focus(p => p === g.paper);
    const p = g.paper;
    tip.innerHTML =
      (p.image ? `<img src="images/${esc(p.image)}" alt="">` : '') +
      `<div class="threads-tip-title">${esc(p.title)}</div>` +
      `<div class="pub"><span class="badge" style="background-color:${esc(p.tag || '#eee')}">${esc(p.venue)}</span>${p.poster ? ' <em>poster / demo</em>' : ''}</div>` +
      (p.url ? `<a class="links3" href="${esc(p.url)}">Project page &rarr;</a>` : '');
    tip.hidden = false;
    // Hang the card just below the strand's lowest dot, with its arrow pointing at that dot
    const box = chart.getBoundingClientRect();
    const dotX = scroller.getBoundingClientRect().left - box.left + g.cx - scroller.scrollLeft;
    const lowest = Math.max(...KEYS.filter(k => p.areas.includes(k)).map(k => LANE_Y[k]));
    const left = Math.max(0, Math.min(box.width - tip.offsetWidth, dotX - tip.offsetWidth / 2));
    tip.style.left = left + 'px';
    tip.style.top = (scroller.offsetTop + lowest + 16) + 'px';
    tip.style.setProperty('--arrow-x', Math.max(16, Math.min(tip.offsetWidth - 16, dotX - left)) + 'px');
  }
  function hide() { active = null; tip.hidden = true; restore(); }
  // Back to the resting state: the chosen lane stays highlighted while it filters the list
  function restore() {
    root.dataset.area = laneFilter || '';
    focus(laneFilter ? (p => p.areas.includes(laneFilter)) : null);
  }

  scroller.addEventListener('pointerdown', e => { touch = e.pointerType === 'touch'; });
  chart.addEventListener('mouseleave', hide);
  document.addEventListener('pointerdown', e => { if (active && !chart.contains(e.target)) hide(); });
  scroller.addEventListener('scroll', () => { if (active) show(active); });

  // Hovering a lane name highlights every paper in that area
  labels.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-area]');
    if (!t) return;
    hide();
    root.dataset.area = t.dataset.area;
    focus(p => p.areas.includes(t.dataset.area));
  });
  labels.addEventListener('mouseleave', restore);

  // Clicking a lane name filters the paper lists below to that area (click again to clear)
  let laneFilter = null;
  const status = root.querySelector('.threads-filter');
  const rows = document.querySelectorAll('.pub-row[data-areas]');
  const lists = [...document.querySelectorAll('.content-section[data-section="publications"], .content-section[data-section="posters"]')];
  function setLane(area) {
    laneFilter = area;
    labels.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.area === area));
    rows.forEach(r => r.classList.toggle('lane-hidden', !!area && !r.dataset.areas.split(' ').includes(area)));
    // Hide year labels with no papers showing, and a whole list if nothing in it matches
    document.querySelectorAll('.year-bar').forEach(bar => {
      let el = bar.nextElementSibling, any = false;
      while (el && !el.classList.contains('year-bar')) {
        if (el.classList.contains('pub-row') && !el.classList.contains('hidden') && !el.classList.contains('lane-hidden')) any = true;
        el = el.nextElementSibling;
      }
      bar.classList.toggle('lane-hidden', !any);
    });
    lists.forEach(s => s.classList.toggle('lane-hidden', !!area && !s.querySelector('.pub-row:not(.lane-hidden)')));
    status.hidden = !area;
    if (area) status.querySelector('strong').textContent = AREAS[area].label;
    restore();
  }
  labels.addEventListener('click', e => {
    const t = e.target.closest('[data-area]');
    if (t) setLane(laneFilter === t.dataset.area ? null : t.dataset.area);
  });
  status.querySelector('button').addEventListener('click', () => setLane(null));
  // The section buttons (All, Publications, ...) replace this filter
  const toggles = document.getElementById('section-toggles');
  if (toggles) toggles.addEventListener('click', e => { if (e.target.closest('.section-toggle')) setLane(null); });

  draw();
  scroller.scrollLeft = scroller.scrollWidth;  // on phones, start at the newest papers
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { hide(); draw(); }, 150);
  });
})();
