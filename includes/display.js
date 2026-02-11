(function(){
  const mq = window.matchMedia("(max-width: 980px)");

  function closeAll(root){
    root.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
  }

  function setupMobile(){
    // toggle au tap (mobile)
    document.querySelectorAll(".menu li.has-submenu > a").forEach(a => {
      a.addEventListener("click", (e) => {
        if (!mq.matches) return; // desktop => laisse hover
        e.preventDefault();
        e.stopPropagation();

        const li = a.parentElement;
        const isOpen = li.classList.contains("open");

        // ferme les siblings du même niveau
        const siblings = li.parentElement.querySelectorAll(":scope > li.has-submenu.open");
        siblings.forEach(s => { if (s !== li) s.classList.remove("open"); });

        li.classList.toggle("open", !isOpen);
      }, { passive: false });
    });

    // tap hors menu => ferme
    document.addEventListener("click", () => {
      if (!mq.matches) return;
      closeAll(document);
    });
  }

  // flip (desktop + mobile si besoin) - optionnel
  function flipIfNeeded(sub){
    sub.classList.remove("flip");
    requestAnimationFrame(() => {
      const r = sub.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) sub.classList.add("flip");
      if (r.left < 8) sub.classList.remove("flip");
    });
  }

  function setupFlip(){
    document.querySelectorAll(".menu li.has-submenu").forEach(li => {
      const sub = li.querySelector(":scope > .submenu");
      if (!sub) return;

      li.addEventListener("mouseenter", () => { if (!mq.matches) flipIfNeeded(sub); });
      li.addEventListener("focusin",   () => flipIfNeeded(sub));
      li.addEventListener("click",     () => flipIfNeeded(sub), { passive:true });
    });

    window.addEventListener("resize", () => {
      document.querySelectorAll(".submenu.flip").forEach(s => s.classList.remove("flip"));
      if (mq.matches) closeAll(document);
    });
  }

  setupMobile();
  setupFlip();
})();