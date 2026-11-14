// Background: each game's emoji drifts slowly and randomly behind the page.
// Pure CSS animation (see .bg-emoji in style.css), so it costs almost nothing.
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'bg-layer';
  layer.setAttribute('aria-hidden', 'true');
  const rand = (a, b) => a + Math.random() * (b - a);
  const COPIES = 4; // emojis per game; raise for more, lower for less clutter

  for (const g of window.GAMES) {
    for (let i = 0; i < COPIES; i++) {
      const el = document.createElement('span');
      el.className = 'bg-emoji';
      el.textContent = g.emoji;
      const s = el.style;
      s.left = rand(0, 95) + '%';
      s.top = rand(0, 95) + '%';
      s.fontSize = rand(28, 64) + 'px';
      s.setProperty('--dx', rand(-25, 25) + 'vw');
      s.setProperty('--dy', rand(-25, 25) + 'vh');
      s.setProperty('--rot', rand(-40, 40) + 'deg');
      s.animationDuration = rand(40, 80) + 's';
      s.animationDelay = -rand(0, 80) + 's'; // start mid-flight, not all in sync
      layer.appendChild(el);
    }
  }
  document.body.prepend(layer);
})();
