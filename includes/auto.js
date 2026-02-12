(function () {
  function closeAll() {
    document.querySelectorAll(".menu details[open]").forEach(d => d.removeAttribute("open"));
  }

  function initMenu() {
    const navbar = document.querySelector(".navbar");
    if (!navbar) {
      setTimeout(initMenu, 100);
      return;
    }

    // 1) Un seul "bloc" ouvert, sans fermer parents/enfants
    navbar.querySelectorAll(".menu details").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (!d.open) return;

        const all = Array.from(navbar.querySelectorAll(".menu details"));

        all.forEach((other) => {
          const keep =
            other === d ||          // lui-même
            other.contains(d) ||    // parent
            d.contains(other);      // enfant

          if (!keep) other.removeAttribute("open");
        });
      });
    });

    // 2) Fermer au touch/clic en dehors (pointerdown = top sur mobile)
    document.addEventListener(
      "pointerdown",
      (e) => {
        const path = e.composedPath ? e.composedPath() : null;
        const inside = path ? path.includes(navbar) : navbar.contains(e.target);

        if (!inside) closeAll();
      },
      { capture: true }
    );

    // 3) Échap = fermer
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });
  }

  initMenu();
})();