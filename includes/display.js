(function(){
  const menu = document.querySelector(".menu");
  if (!menu) return;

  const mqMobile = window.matchMedia("(max-width: 980px)");

  function closeAll(root = menu){
    root.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
  }

  function flipIfNeeded(sub){
    if (!sub) return;
    sub.classList.remove("flip");
    requestAnimationFrame(() => {
      const r = sub.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) sub.classList.add("flip");
      if (r.left < 8) sub.classList.remove("flip");
    });
  }

  // Délégation : click/tap sur un parent
  menu.addEventListener("click", (e) => {
    const a = e.target.closest("li.has-submenu > a");
    if (!a) return;

    const li = a.parentElement;

    // Sur mobile : toujours toggle (évite le hover iOS)
    if (mqMobile.matches){
      e.preventDefault();
      e.stopPropagation();

      const isOpen = li.classList.contains("open");

      // ferme les frères du même niveau
      li.parentElement.querySelectorAll(":scope > li.has-submenu.open")
        .forEach(x => { if (x !== li) x.classList.remove("open"); });

      li.classList.toggle("open", !isOpen);

      // flip (utile si tu changes de placement)
      const sub = li.querySelector(":scope > .submenu");
      flipIfNeeded(sub);
      return;
    }

    // Desktop : si le lien est un "#", on toggle aussi (pratique)
    if (a.getAttribute("href") === "#" || a.getAttribute("href") === ""){
      e.preventDefault();
      e.stopPropagation();

      const isOpen = li.classList.contains("open");
      li.parentElement.querySelectorAll(":scope > li.has-submenu.open")
        .forEach(x => { if (x !== li) x.classList.remove("open"); });
      li.classList.toggle("open", !isOpen);

      const sub = li.querySelector(":scope > .submenu");
      flipIfNeeded(sub);
    }
  }, { passive: false });

  // Hover desktop => flip auto (confort)
  menu.querySelectorAll("li.has-submenu").forEach(li => {
    const sub = li.querySelector(":scope > .submenu");
    if (!sub) return;
    li.addEventListener("mouseenter", () => {
      if (!mqMobile.matches) flipIfNeeded(sub);
    });
    li.addEventListener("focusin", () => flipIfNeeded(sub));
  });

  // Click hors menu => ferme tout (mobile + desktop)
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeAll();
  });

  // Resize => reset
  window.addEventListener("resize", () => {
    menu.querySelectorAll(".submenu.flip").forEach(s => s.classList.remove("flip"));
    if (mqMobile.matches) closeAll();
  });
})();