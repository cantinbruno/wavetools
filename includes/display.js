(function () {
  const isMobile = () => window.matchMedia("(max-width: 980px)").matches;

  function closeAll(root = document) {
    root.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
  }

  function setup() {
    const menu = document.querySelector(".menu");
    if (!menu) return;

    // Nettoie anciens états
    closeAll(document);

    // Toggle au tap sur mobile
    menu.querySelectorAll("li.has-submenu > a").forEach(a => {
      a.addEventListener("click", (e) => {
        if (!isMobile()) return; // desktop -> laisse hover fonctionner

        const li = a.parentElement; // li.has-submenu
        const isOpen = li.classList.contains("open");

        // 1er tap : ouvre, empêche navigation
        if (!isOpen) {
          e.preventDefault();

          // ferme les frères au même niveau
          const siblings = Array.from(li.parentElement.children).filter(x => x !== li);
          siblings.forEach(s => s.classList.remove("open"));

          li.classList.add("open");
          return;
        }

        // 2e tap : laisse naviguer (ne rien faire)
      }, { passive: false });
    });

    // Tap en dehors -> ferme
    document.addEventListener("click", (e) => {
      if (!isMobile()) return;
      if (!menu.contains(e.target)) closeAll(document);
    });

    // Resize -> reset
    window.addEventListener("resize", () => {
      closeAll(document);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();