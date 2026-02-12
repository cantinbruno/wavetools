function initMenuAutoClose() {
  const navbar = document.querySelector(".navbar");
  if (!navbar) {
    // le header n'est pas encore chargé → on réessaie
    setTimeout(initMenuAutoClose, 100);
    return;
  }

  const allDetails = document.querySelectorAll(".menu details");

  // Un seul menu ouvert
  allDetails.forEach(d => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;

      allDetails.forEach(other => {
        if (other !== d) other.removeAttribute("open");
      });
    });
  });

  // Clic à côté
  document.addEventListener("click", (e) => {
    if (navbar.contains(e.target)) return;
    allDetails.forEach(d => d.removeAttribute("open"));
  });

  // Échap
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      allDetails.forEach(d => d.removeAttribute("open"));
    }
  });
}

initMenuAutoClose();