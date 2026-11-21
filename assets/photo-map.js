// Photography page: switch between the album grid, a grid of every photo, and a map of where
// each photo was taken.
// Photos come from the JSON block #photo-map-data (every photo with `coords` in
// _data/images.yml). Nearby photos are grouped into one pin showing the newest photo and
// a count; clicking a pin zooms in, or lists its photos once they can't be split further.
// The map library (MapLibre) and tiles (OpenFreeMap) load the first time the map is shown.
(function () {
  const mapEl = document.getElementById('photo-map');
  if (!mapEl) return;
  const albumsEl = document.getElementById('photo-albums');
  const buttons = [...document.querySelectorAll('.photo-views [data-view]')];
  const photos = JSON.parse(document.getElementById('photo-map-data').textContent);
  const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
  let map = null, started = false, popup = null;

  // ---- Albums | All photos | Map switch ----
  const views = { albums: albumsEl, all: document.getElementById('photo-all'), map: mapEl };
  const viewFromHash = () => (location.hash === '#map' ? 'map' : location.hash === '#all' ? 'all' : 'albums');
  function setView(view, push) {
    Object.entries(views).forEach(([name, el]) => { if (el) el.hidden = name !== view; });
    buttons.forEach(b => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    if (push) history.replaceState(null, '', view === 'albums' ? location.pathname + location.search : '#' + view);
    if (view === 'map') { start(); if (map) map.resize(); }
  }
  buttons.forEach(b => b.addEventListener('click', () => setView(b.dataset.view, true)));
  window.addEventListener('hashchange', () => setView(viewFromHash(), false));

  // ---- Map ----
  const load = (tag, attrs) => new Promise((ok, fail) => {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.onload = ok; n.onerror = fail;
    document.head.appendChild(n);
  });
  function start() {
    if (started) return;
    started = true;
    Promise.all([load('link', { rel: 'stylesheet', href: LIB + '.css' }), load('script', { src: LIB + '.js' })])
      .then(buildMap)
      .catch(() => { mapEl.classList.add('photo-map-failed'); mapEl.textContent = 'The map couldn’t be loaded.'; });
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function buildMap() {
    const lons = photos.map(p => p.lon), lats = photos.map(p => p.lat);
    map = new maplibregl.Map({
      container: mapEl,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      fitBoundsOptions: { padding: 60, maxZoom: 12 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      // Tint the light basemap towards the site's palette (same as the trail maps)
      map.getStyle().layers.forEach(l => {
        try {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f7f1f3');
          else if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#dfe6ee');
          else if (l.type === 'fill' && /park|wood|forest|grass|landcover/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#e9eee4');
        } catch (e) { /* layer without that property */ }
      });
      map.addSource('photos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: photos.map((p, i) => ({
          type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) },
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 16,
        clusterProperties: { first: ['min', ['get', 'i']] },  // the newest photo in the group is its cover
      });
      // An invisible layer, so the source's features can be queried for the photo pins
      map.addLayer({ id: 'photos-anchor', type: 'circle', source: 'photos', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
      map.on('render', updatePins);
      // Start with the credits folded behind their (i) button; they cover a lot of a phone screen
      const credits = mapEl.querySelector('.maplibregl-ctrl-attrib');
      if (credits) credits.classList.remove('maplibregl-compact-show');
    });
  }

  // Photo pins are HTML markers, kept in sync with the clusters on screen
  const pins = {};
  let shown = {};
  function updatePins() {
    if (!map.isSourceLoaded('photos')) return;
    const next = {};
    map.querySourceFeatures('photos').forEach(f => {
      const pr = f.properties;
      const key = pr.cluster ? 'c' + pr.cluster_id : 'p' + pr.i;
      if (next[key]) return;
      if (!pins[key]) pins[key] = makePin(f);
      next[key] = pins[key];
      if (!shown[key]) pins[key].addTo(map);
    });
    Object.keys(shown).forEach(k => { if (!next[k]) shown[k].remove(); });
    shown = next;
  }

  function makePin(f) {
    const pr = f.properties;
    const cover = photos[pr.cluster ? pr.first : pr.i];
    const n = pr.cluster ? pr.point_count : 1;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'photo-pin';
    el.style.backgroundImage = `url("${cover.thumb}")`;
    el.setAttribute('aria-label', n > 1 ? `${n} photos` : `Photo from ${cover.title}`);
    if (n > 1) el.innerHTML = `<span class="photo-pin-count">${n}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); openPin(f); });
    return new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates);
  }

  async function openPin(f) {
    const pr = f.properties;
    if (!pr.cluster) return showList([pr.i], f.geometry.coordinates);
    const src = map.getSource('photos');
    const leaves = (await src.getClusterLeaves(pr.cluster_id, 1000, 0)).map(l => l.properties.i);
    const lons = leaves.map(i => photos[i].lon), lats = leaves.map(i => photos[i].lat);
    const spread = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
    if (spread < 1e-4 || map.getZoom() >= 15) return showList(leaves, f.geometry.coordinates);  // same spot: list them
    // Zoom in just far enough for the group to split, centred on the middle of its photos
    const zoom = await src.getClusterExpansionZoom(pr.cluster_id);
    map.easeTo({ center: [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
                 zoom: Math.max(zoom, map.getZoom() + 1), duration: 600 });
  }

  // Popup listing photos, grouped by album, each linking to the photo on its album page
  function showList(idx, lngLat) {
    const groups = [];
    idx.sort((a, b) => a - b).forEach(i => {
      const p = photos[i];
      let g = groups.find(x => x.album === p.album);
      if (!g) groups.push(g = { album: p.album, title: p.title, date: p.date, items: [] });
      g.items.push(p);
    });
    const html = groups.map(g =>
      `<div class="photo-pop-album"><a class="photo-pop-title" href="${esc(g.items[0].href.split('#')[0])}">${esc(g.title)}</a>` +
      `<span class="photo-pop-date">${esc(g.date)}</span></div>` +
      `<div class="photo-pop-grid">${g.items.map(p =>
        `<a href="${esc(p.href)}"><img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy"></a>`).join('')}</div>`
    ).join('');
    if (popup) popup.remove();
    const width = Math.min(330, mapEl.clientWidth - 40);
    popup = new maplibregl.Popup({ anchor: 'bottom', offset: 30, maxWidth: width + 'px', className: 'photo-pop', closeButton: false, focusAfterOpen: false })
      .setLngLat(lngLat).setHTML(`<div class="photo-pop-body">${html}</div>`).addTo(map);
    popup.getElement().style.width = width + 'px';
    // Pan the map so the whole popup is visible
    requestAnimationFrame(() => {
      const m = mapEl.getBoundingClientRect(), p = popup.getElement().getBoundingClientRect(), pad = 12;
      const dx = p.left < m.left + pad ? p.left - m.left - pad : p.right > m.right - pad ? p.right - m.right + pad : 0;
      const dy = p.top < m.top + pad ? p.top - m.top - pad : p.bottom > m.bottom - pad ? p.bottom - m.bottom + pad : 0;
      if (dx || dy) map.panBy([dx, dy], { duration: 300 });
    });
  }

  if (location.hash === '#map' || location.hash === '#all') setView(viewFromHash(), false);  // e.g. coming back from an album
})();
