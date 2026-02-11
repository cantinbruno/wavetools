(function () {
  function initReveal() {
    const cards = document.querySelectorAll('.wt-card.wt-in-ltr, .wt-card.wt-in-rtl');

    // Debug simple: si 0, c'est que le sélecteur ne matche rien
    // console.log('[WaveTools] cards found:', cards.length);

    if (!cards.length) return;

    cards.forEach(card => card.classList.add('wt-reveal'));

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });

    cards.forEach(card => {
      // évite de ré-observer un bloc déjà révélé
      if (!card.classList.contains('is-visible')) observer.observe(card);
    });
  }

  // 1) au chargement
  document.addEventListener('DOMContentLoaded', initReveal);

  // 2) si ton site utilise des pages en hash (#/outils etc.)
  window.addEventListener('hashchange', () => {
    // laisse le temps au contenu de se rendre
    setTimeout(initReveal, 50);
  });

  // 3) si le contenu est injecté dynamiquement (SPA), on écoute le DOM
  const mo = new MutationObserver(() => {
    // throttle simple
    clearTimeout(window.__wtRevealTimer);
    window.__wtRevealTimer = setTimeout(initReveal, 80);
  });

  mo.observe(document.documentElement, { childList: true, subtree: true });
})();


(() => {
  const c = document.getElementById("siteBg");
  if (!c) return;

  const ctx = c.getContext("2d");
  let W, H, t = 0;

  function resize(){
    W = c.width = window.innerWidth;
    H = c.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  /* =====================
     PARTICULES CYBER
     ===================== */
  const P = [];
  const COUNT = 110;

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  for(let i=0;i<COUNT;i++){
    P.push({
      x:rnd(0,W),
      y:rnd(0,H),
      vx:rnd(-0.25,0.25),
      vy:rnd(-0.25,0.25),
      r:rnd(1.2,2.2)
    });
  }

  function drawParticles(){
    for(const p of P){
      p.x += p.vx;
      p.y += p.vy;

      if(p.x<0||p.x>W) p.vx*=-1;
      if(p.y<0||p.y>H) p.vy*=-1;

      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle="rgba(0,255,255,0.75)";
      ctx.fill();
    }
  }

  /* =====================
     LIAISONS DYNAMIQUES
     ===================== */
  function drawLinks(){
    for(let i=0;i<P.length;i++){
      for(let j=i+1;j<P.length;j++){
        const a=P[i];
        const b=P[j];
        const dx=a.x-b.x;
        const dy=a.y-b.y;
        const d=Math.hypot(dx,dy);

        if(d<150){
          ctx.strokeStyle=`rgba(0,180,255,${1-d/150})`;
          ctx.lineWidth=1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }
  }

  /* =====================
     HALO CYBER (lent)
     ===================== */
  function glow(){
    const gx=W*(0.5+0.15*Math.sin(t*0.2));
    const gy=H*(0.5+0.15*Math.cos(t*0.18));

    const g=ctx.createRadialGradient(gx,gy,0,gx,gy,Math.max(W,H));
    g.addColorStop(0,"rgba(0,255,255,0.12)");
    g.addColorStop(0.5,"rgba(80,0,255,0.06)");
    g.addColorStop(1,"rgba(0,0,0,0)");

    ctx.fillStyle=g;
    ctx.fillRect(0,0,W,H);
  }

  /* =====================
     LOOP
     ===================== */
  function loop(){
    t+=0.01;

    ctx.fillStyle="#050914";
    ctx.fillRect(0,0,W,H);

    glow();
    drawLinks();
    drawParticles();

    requestAnimationFrame(loop);
  }

  loop();
})();

