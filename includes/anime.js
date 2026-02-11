(() => {
  const c = document.getElementById("siteBg");
  if (!c) return;

  const ctx = c.getContext("2d", { alpha: false });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return;

  let W=0, H=0, DPR=1;
  let t=0;

  const pts = [];
  const COUNT = 110;

  function resize(){
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    c.width = Math.floor(W * DPR);
    c.height = Math.floor(H * DPR);
    c.style.width = W + "px";
    c.style.height = H + "px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function seed(){
    pts.length = 0;
    for(let i=0;i<COUNT;i++){
      pts.push({
        x:rnd(0,W), y:rnd(0,H),
        vx:rnd(-0.25,0.25),
        vy:rnd(0.05,0.55),          // descend doucement
        r:rnd(0.8,2.2),
        a:rnd(0.10,0.45)
      });
    }
  }

  // grille néon animée
  function drawGrid(){
    const grid = 46; // taille cellule
    const off = (t*28) % grid;

    // fond base
    ctx.fillStyle = "#050914";
    ctx.fillRect(0,0,W,H);

    // glow diagonale
    const g = ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0, "rgba(0,210,255,0.10)");
    g.addColorStop(0.5,"rgba(95,80,255,0.08)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // lignes verticales
    ctx.lineWidth = 1;
    for(let x = -grid; x < W + grid; x += grid){
      const xx = x + off;
      ctx.strokeStyle = "rgba(0,210,255,0.07)";
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
      ctx.stroke();
    }

    // lignes horizontales
    for(let y = -grid; y < H + grid; y += grid){
      const yy = y + off;
      ctx.strokeStyle = "rgba(120,90,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }

    // perspective lines (cyber)
    const horizon = H*0.42;
    ctx.strokeStyle = "rgba(0,255,200,0.06)";
    for(let i=0;i<24;i++){
      const px = (i/23)*W;
      ctx.beginPath();
      ctx.moveTo(px, H);
      ctx.lineTo(W*0.5 + (px-W*0.5)*0.2, horizon);
      ctx.stroke();
    }

    // scanline (balayage)
    const sy = (t*120) % (H+300) - 150;
    const s = ctx.createLinearGradient(0, sy-120, 0, sy+120);
    s.addColorStop(0, "rgba(0,0,0,0)");
    s.addColorStop(0.48,"rgba(0,255,220,0.06)");
    s.addColorStop(0.52,"rgba(255,255,255,0.02)");
    s.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, sy-160, W, 320);

    // vignette douce
    const v = ctx.createRadialGradient(W*0.5,H*0.45,0,W*0.5,H*0.45,Math.max(W,H)*0.9);
    v.addColorStop(0,"rgba(0,0,0,0)");
    v.addColorStop(1,"rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0,0,W,H);
  }

  // particules + petites connexions
  function drawParticles(){
    for (const p of pts){
      p.x += p.vx;
      p.y += p.vy;

      if (p.y > H + 40){ p.y = -40; p.x = rnd(0,W); }
      if (p.x < -40) p.x = W+40;
      if (p.x > W+40) p.x = -40;
    }

    // liens proches (léger)
    for (let i=0;i<pts.length;i++){
      for (let j=i+1;j<pts.length;j++){
        const a=pts[i], b=pts[j];
        const dx=a.x-b.x, dy=a.y-b.y;
        const d = Math.hypot(dx,dy);
        if (d < 120){
          const alpha = (1 - d/120) * 0.10;
          ctx.strokeStyle = `rgba(0,210,255,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }

    // points
    for (const p of pts){
      ctx.fillStyle = `rgba(180,240,255,${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fill();
    }
  }

  // micro glitch léger
  function glitch(){
    if (Math.random() < 0.07){
      const y = Math.random()*H;
      const h = 6 + Math.random()*18;
      const x = Math.random()*W*0.15;
      ctx.drawImage(c, 0, y, W, h, x, y, W, h);
    }
  }

  function grain(){
    ctx.fillStyle = "rgba(255,255,255,0.012)";
    for(let i=0;i<380;i++){
      ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
    }
  }

  function loop(){
    t += 0.016;
    drawGrid();
    drawParticles();
    glitch();
    grain();
    requestAnimationFrame(loop);
  }

  resize();
  seed();
  addEventListener("resize", () => { resize(); seed(); }, { passive:true });

  requestAnimationFrame(loop);
})();