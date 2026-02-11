(function(){
  function flipIfNeeded(sub){
    sub.classList.remove('flip');
    requestAnimationFrame(() => {
      const r = sub.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) sub.classList.add('flip');
      if (r.left < 8) sub.classList.remove('flip');
    });
  }

  document.querySelectorAll('.menu li.has-submenu').forEach(li => {
    const sub = li.querySelector(':scope > .submenu');
    if (!sub) return;

    li.addEventListener('mouseenter', () => flipIfNeeded(sub));
    li.addEventListener('focusin',   () => flipIfNeeded(sub));
    li.addEventListener('click',     () => flipIfNeeded(sub), {passive:true});
  });

  window.addEventListener('resize', () => {
    document.querySelectorAll('.submenu.flip').forEach(s => s.classList.remove('flip'));
  });
})();