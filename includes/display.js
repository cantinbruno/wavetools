(function () {
  function closeAll() {
    document.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
  }

  function flipIfNeeded(ul) {
    if (!ul) return;
    ul.classList.remove("flip");

    requestAnimationFrame(() => {
      const r = ul.getBoundingClientRect();
      const pad = 8;
      if (r.right > window.innerWidth - pad) ul.classList.add("flip");
      if (r.left < pad) ul.classList.remove("flip");
    });
  }

  // 1) Top level
  document.querySelectorAll(".menu > li.has-submenu > a").forEach(a => {
    a.addEventListener("click", (e) => {
      const li = a.parentElement;
      const sub = li.querySelector(":scope > .submenu");
      if (!sub) return;

      e.preventDefault();

      const willOpen = !li.classList.contains("open");

      // ferme les autres top-level
      document.querySelectorAll(".menu > li.has-submenu.open").forEach(x => {
        if (x !== li) x.classList.remove("open");
      });

      li.classList.toggle("open", willOpen);
      if (willOpen) flipIfNeeded(sub);
    }, { passive: false });
  });

  // 2) Sub level
  document.querySelectorAll(".submenu li.has-submenu > a").forEach(a => {
    a.addEventListener("click", (e) => {
      const li = a.parentElement;
      const sub = li.querySelector(":scope > .submenu");
      if (!sub) return;

      e.preventDefault();

      const willOpen = !li.classList.contains("open");

      // ferme les frères dans le même UL
      Array.from(li.parentElement.children).forEach(sib => {
        if (sib !== li) sib.classList.remove("open");
      });

      li.classList.toggle("open", willOpen);
      if (willOpen) flipIfNeeded(sub);
    }, { passive: false });
  });

  // click dehors => ferme
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".navbar")) closeAll();
  });

  window.addEventListener("resize", () => {
    document.querySelectorAll(".submenu.flip").forEach(s => s.classList.remove("flip"));
    closeAll();
  });
})();