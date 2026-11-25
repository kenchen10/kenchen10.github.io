// Mural page: a map with a pin on the 2nd Ave F stop, at the corner of E Houston St and 2nd Ave.
// The pin's position is in data-lon / data-lat on #mural-map. The map library (MapLibre)
// and tiles (OpenFreeMap) load when the map is about to scroll into view.
(function () {
  const mapEl = document.getElementById('mural-map');
  if (!mapEl) return;
  const station = [+mapEl.dataset.lon, +mapEl.dataset.lat];
  const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';

  const load = (tag, attrs) => new Promise((ok, fail) => {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.onload = ok; n.onerror = fail;
    document.head.appendChild(n);
  });

  function buildMap() {
    const map = new maplibregl.Map({
      container: mapEl,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: station,
      zoom: 14.5,
      cooperativeGestures: true,      // scrolling the page doesn't get stuck zooming the map
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
      // Start with the credits folded behind their (i) button
      const credits = mapEl.querySelector('.maplibregl-ctrl-attrib');
      if (credits) credits.classList.remove('maplibregl-compact-show');
    });

    // Pin in the F train's orange, with its tip on the intersection
    const pin = document.createElement('div');
    pin.className = 'mural-pin';
    pin.title = '2nd Ave F stop, E Houston St & 2nd Ave';
    pin.innerHTML = '<svg width="36" height="46" viewBox="0 0 36 46" aria-hidden="true">' +
      '<path d="M18 45C14 36 2 29 2 17.5a16 16 0 0 1 32 0C34 29 22 36 18 45Z" fill="#ff6319" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
      '<text x="18" y="24.5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="#fff">F</text></svg>';
    new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat(station).addTo(map);
  }

  function start() {
    Promise.all([load('link', { rel: 'stylesheet', href: LIB + '.css' }), load('script', { src: LIB + '.js' })])
      .then(buildMap)
      .catch(() => { mapEl.classList.add('mural-map-failed'); mapEl.textContent = 'The map couldn’t be loaded.'; });
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
    io.observe(mapEl);
  } else start();
})();
