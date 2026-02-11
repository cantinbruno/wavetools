document.querySelectorAll('.submenu').forEach(menu => {
  const parent = menu.parentElement;

  parent.addEventListener('mouseenter', () => {
    menu.classList.remove('flip');

    const rect = menu.getBoundingClientRect();
    const overflowRight = rect.right > window.innerWidth;

    if (overflowRight) {
      menu.classList.add('flip');
    }
  });
});