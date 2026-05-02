(function () {
  const INCLUDES_LOADED = 'waveToolsIncludesLoaded';

  function closeAll() {
    document.querySelectorAll('.menu details[open]').forEach(d => d.removeAttribute('open'));
  }

  function initMenu() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    navbar.querySelectorAll('.menu details').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (!d.open) return;

        const all = Array.from(navbar.querySelectorAll('.menu details'));
        all.forEach((other) => {
          const keep =
            other === d ||
            other.contains(d) ||
            d.contains(other);
          if (!keep) other.removeAttribute('open');
        });
      });
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        const path = e.composedPath ? e.composedPath() : null;
        const inside = path ? path.includes(navbar) : navbar.contains(e.target);
        if (!inside) closeAll();
      },
      { capture: true }
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
  }

  function bootMenu() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
      initMenu();
      return;
    }
    document.addEventListener(INCLUDES_LOADED, () => {
      initMenu();
    }, { once: true });
  }

  function boot() {
    bootMenu();
  }

  if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
