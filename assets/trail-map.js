// Album pages with a `trail:`: a minimal map of the route plus an elevation profile.
// Hovering the profile (or the route on the map) shows where you are on both.
// The map library (MapLibre) and the map tiles (OpenFreeMap, no account needed) are
// only loaded when the map is about to scroll into view.
(function () {
  const root = document.getElementById('trail');
  if (!root) return;
  const trail = JSON.parse(document.getElementById('trail-data').textContent);
  const pts = trail.points;  // [lon, lat, elevation m, distance km]
  const mapEl = document.getElementById('trail-map');
  const svg = document.getElementById('trail-profile');
  const NS = 'http://www.w3.org/2000/svg';
  const ACCENT = '#8c2f5a';
  const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
  let map = null;

  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmtKm = d => (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
  const fmtM = m => Math.round(m).toLocaleString('en-US') + ' m';

  // ---- Elevation profile ----
  let cursor = null, xOf, yOf;
  function drawProfile() {
    const W = svg.clientWidth || 600, H = 96, padT = 8, padB = 18, padL = 44, padR = 6;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const total = pts[pts.length - 1][3];
    const eles = pts.map(p => p[2]);
    const lo = Math.min(...eles), hi = Math.max(...eles), span = Math.max(hi - lo, 1);
    xOf = d => padL + (d / total) * (W - padL - padR);
    yOf = e => padT + (1 - (e - lo) / span) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p[3]).toFixed(1)} ${yOf(p[2]).toFixed(1)}`).join(' ');
    el('path', { d: `${line} L${xOf(total)} ${H - padB} L${padL} ${H - padB} Z`, class: 'trail-area' }, svg);
    el('path', { d: line, class: 'trail-line' }, svg);
    [[hi, padT + 4], [lo, H - padB]].forEach(([v, y]) => {
      el('text', { x: padL - 6, y, 'text-anchor': 'end', class: 'trail-axis' }, svg).textContent = fmtM(v);
    });
    el('text', { x: padL, y: H - 3, class: 'trail-axis' }, svg).textContent = '0 km';
    el('text', { x: W - padR, y: H - 3, 'text-anchor': 'end', class: 'trail-axis' }, svg).textContent = fmtKm(total);
    cursor = el('g', { class: 'trail-cursor', visibility: 'hidden' }, svg);
    el('line', { y1: padT, y2: H - padB }, cursor);
    el('circle', { r: 4 }, cursor);
    el('text', { y: padT + 10, class: 'trail-cursor-label' }, cursor);
  }

  function showAt(i) {
    const p = pts[i];
    if (cursor) {
      const x = xOf(p[3]);
      cursor.setAttribute('visibility', 'visible');
      cursor.querySelector('line').setAttribute('x1', x);
      cursor.querySelector('line').setAttribute('x2', x);
      cursor.querySelector('circle').setAttribute('cx', x);
      cursor.querySelector('circle').setAttribute('cy', yOf(p[2]));
      const label = cursor.querySelector('text');
      label.textContent = `${fmtKm(p[3])} · ${fmtM(p[2])}`;
      const right = x > svg.clientWidth - 140;
      label.setAttribute('x', right ? x - 8 : x + 8);
      label.setAttribute('text-anchor', right ? 'end' : 'start');
    }
    if (map && map.getSource('cursor')) map.getSource('cursor').setData({ type: 'Point', coordinates: [p[0], p[1]] });
  }
  function hide() {
    if (cursor) cursor.setAttribute('visibility', 'hidden');
    if (map && map.getSource('cursor')) map.getSource('cursor').setData({ type: 'FeatureCollection', features: [] });
  }
  const nearestByDist = d => {
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p[3] - d) < Math.abs(pts[best][3] - d)) best = i; });
    return best;
  };
  const nearestByLngLat = (lng, lat) => {
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = (p[0] - lng) ** 2 + (p[1] - lat) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };

  svg.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect();
    const x = (e.clientX - box.left) * (svg.viewBox.baseVal.width / box.width);
    const total = pts[pts.length - 1][3];
    const d = Math.max(0, Math.min(total, ((x - xOf(0)) / (xOf(total) - xOf(0))) * total));
    showAt(nearestByDist(d));
  });
  svg.addEventListener('pointerleave', hide);
  drawProfile();
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(drawProfile, 120); });

  // ---- Map ----
  const load = (tag, attrs) => new Promise((ok, fail) => {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.onload = ok; n.onerror = fail;
    document.head.appendChild(n);
  });

  function buildMap() {
    const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p[0], p[1]]) } };
    const ends = { type: 'FeatureCollection', features: [0, pts.length - 1].map((i, k) => ({
      type: 'Feature', properties: { end: k }, geometry: { type: 'Point', coordinates: [pts[i][0], pts[i][1]] } })) };
    map = new maplibregl.Map({
      container: mapEl,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      fitBoundsOptions: { padding: 40 },
      cooperativeGestures: true,      // scrolling the page doesn't get stuck zooming the map
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      // Tint the light basemap towards the site's palette
      map.getStyle().layers.forEach(l => {
        try {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f7f1f3');
          else if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#dfe6ee');
          else if (l.type === 'fill' && /park|wood|forest|grass|landcover/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#e9eee4');
        } catch (e) { /* layer without that property */ }
      });
      map.addSource('trail', { type: 'geojson', data: line });
      map.addSource('ends', { type: 'geojson', data: ends });
      map.addSource('cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'trail-casing', type: 'line', source: 'trail',
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7 } });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail',
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ACCENT, 'line-width': 3.5 } });
      map.addLayer({ id: 'trail-ends', type: 'circle', source: 'ends', paint: {
        'circle-radius': 6, 'circle-stroke-width': 2.5,
        'circle-color': ['case', ['==', ['get', 'end'], 0], ACCENT, '#fff'],
        'circle-stroke-color': ['case', ['==', ['get', 'end'], 0], '#fff', ACCENT] } });
      map.addLayer({ id: 'trail-cursor', type: 'circle', source: 'cursor', paint: {
        'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': ACCENT } });
      // Hovering near the route moves the marker on the map and the profile together
      map.on('mousemove', 'trail-casing', e => showAt(nearestByLngLat(e.lngLat.lng, e.lngLat.lat)));
      map.on('mouseenter', 'trail-casing', () => { map.getCanvas().style.cursor = 'crosshair'; });
      map.on('mouseleave', 'trail-casing', () => { map.getCanvas().style.cursor = ''; hide(); });
    });
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    Promise.all([load('link', { rel: 'stylesheet', href: LIB + '.css' }), load('script', { src: LIB + '.js' })])
      .then(buildMap)
      .catch(() => { mapEl.hidden = true; });  // offline or blocked: keep the profile and stats
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
    io.observe(mapEl);
  } else start();
})();
