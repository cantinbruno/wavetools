(() => {
  const c = document.getElementById("siteBg");
  if (!c) return;

  const ctx = c.getContext("2d", { alpha: false });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return;

  let W=0, H=0, DPR=1;
  let t=0;

  // Ripples (anneaux)
  const rings = [];
  const MAX_RINGS = 8;

  // Souris (optionnel : ajoute des ripples au move)
  let lastRing = 0;

  function resize(){
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;

    c.width  = Math.floor(W * DPR);
    c.height = Math.floor(H * DPR);
    c.style.width  = W + "px";
    c.style.height = H + "px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  function addRing(x, y){
    rings.push({
      x, y,
      r: 0,
      speed: 2.2 + Math.random()*1.6,
      life: 1.0
    });
    while(rings.length > MAX_RINGS) rings.shift();
  }

  function onMove(e){
    const now = performance.now();
    if (now - lastRing > 140) { // fréquence ripple
      lastRing = now;
      addRing(e.clientX, e.clientY);
    }
  }

  // Vagues horizontales (sonar)
  function drawWaves(){
    // fond
    ctx.fillStyle = "#050914";
    ctx.fillRect(0,0,W,H);

    // dégradé animé
    const gx = W*(0.5 + 0.15*Math.sin(t*0.18));
    const gy = H*(0.45 + 0.12*Math.cos(t*0.15));
    const g = ctx.createRadialGradient(gx,gy,0,gx,gy,Math.max(W,H)*1.05);
    g.addColorStop(0, "rgba(0,212,255,0.16)");
    g.addColorStop(0.55,"rgba(106,92,255,0.11)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // vague = lignes sinusoïdales
    ctx.lineWidth = 1;

    const lineCount = 26;             // nombre de lignes
    const spacing = H / (lineCount);  // espacement vertical
    const amp = 14 + 10*Math.sin(t*0.4); // amplitude
    const freq = 0.012;               // fréquence horizontale
    const speed = t * 1.6;            // vitesse

    for(let i=0;i<lineCount;i++){
      const y0 = i*spacing + (Math.sin(t*0.2+i)*6);

      // opacité graduelle
      const alpha = 0.10 + (i/lineCount)*0.14;

      // couleur entre cyan -> violet
      const hue = 195 + i*1.4 + Math.sin(t*0.25)*10;

      ctx.strokeStyle = `hsla(${hue}, 92%, 60%, ${alpha})`;
      ctx.beginPath();

      // échantillonnage de la courbe
      for(let x=0; x<=W; x+=10){
        const y = y0 + Math.sin(x*freq + speed + i*0.35) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // “beam” vertical doux
    const bx = W*(0.5 + 0.25*Math.sin(t*0.22));
    const beam = ctx.createLinearGradient(bx-220,0,bx+220,0);
    beam.addColorStop(0,"rgba(0,0,0,0)");
    beam.addColorStop(0.45,"rgba(0,212,255,0.06)");
    beam.addColorStop(0.50,"rgba(255,255,255,0.025)");
    beam.addColorStop(0.55,"rgba(106,92,255,0.05)");
    beam.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(bx-260, 0, 520, H);
  }

  function drawRings(){
    // spawn automatique de temps en temps
    if (Math.random() < 0.015) {
      addRing(Math.random()*W, Math.random()*H);
    }

    for (let i = rings.length - 1; i >= 0; i--){
      const R = rings[i];
      R.r += R.speed;
      R.life -= 0.0065;

      if (R.life <= 0){
        rings.splice(i,1);
        continue;
      }

      const alpha = Math.max(0, R.life) * 0.18;

      // anneau cyan
      ctx.strokeStyle = `rgba(0,212,255,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(R.x, R.y, R.r, 0, Math.PI*2);
      ctx.stroke();

      // anneau violet léger décalé (effet double)
      ctx.strokeStyle = `rgba(106,92,255,${alpha*0.8})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(R.x+2, R.y+1, R.r*0.92, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  function grain(){
    // anti-banding discret
    ctx.fillStyle = "rgba(255,255,255,0.010)";
    for(let i=0;i<420;i++){
      ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
    }
  }

  function loop(){
    t += 0.020;  // vitesse
    drawWaves();
    drawRings();
    grain();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize, { passive:true });
  window.addEventListener("pointermove", onMove, { passive:true });

  requestAnimationFrame(loop);
})();