(function () {
  'use strict';

  var body = document.body;
  var currentRoute = body.getAttribute('data-page') || 'home';

  document.querySelectorAll('[data-route]').forEach(function (link) {
    if (link.getAttribute('data-route') === currentRoute) {
      link.setAttribute('aria-current', 'page');
    }
  });

  document.querySelectorAll('[data-year]').forEach(function (element) {
    element.textContent = String(new Date().getFullYear());
  });

  var traceGrid = document.querySelector('[data-trace-grid]');
  if (traceGrid) {
    var cells = document.createDocumentFragment();
    var seed = 1741;
    for (var index = 0; index < 364; index += 1) {
      seed = (seed * 9301 + 49297) % 233280;
      var level = Math.floor((seed / 233280) * 5);
      var cell = document.createElement('span');
      cell.className = 'trace-cell';
      cell.setAttribute('data-level', String(level));
      cell.setAttribute('aria-hidden', 'true');
      cells.appendChild(cell);
    }
    traceGrid.appendChild(cells);
  }

  var revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var observer = new IntersectionObserver(function (entries, instance) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          instance.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach(function (item) { observer.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add('is-visible'); });
  }

  var canvas = document.getElementById('apple-starfield');
  if (canvas && window.AppleStarfield) {
    var field = new window.AppleStarfield(canvas, canvas.getAttribute('data-source'));
    field.start();
    window.addEventListener('pagehide', function () { field.destroy(); }, { once: true });
  }
}());
