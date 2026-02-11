(() => {
  const c = document.getElementById("siteBg");
  if (!c) return;

  const ctx = c.getContext("2d", { alpha: false });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return;

  let W=0, H=0, DPR=1;
  let t=0;

  // souris
  let mx = 0.5, my = 0.5;

  // particules
  const P = [];
  const COUNT = 120;

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

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function seed(){
    P.length = 0;
    for(let i=0;i<COUNT;i++){
      P.push({
        x:rnd(0,W), y:rnd(0,H),
        vx:rnd(-0.25,0.25),
        vy:rnd(-0.20,0.20),
        r:rnd(0.9,2.4),
        a:rnd(0.08,0.35),
        hue: rnd(185, 210)
      });
    }
  }

  function onMove(e){
    mx = e.clientX / Math.max(1, W);
    my = e.clientY / Math.max(1, H);
  }

  // champ liquide (shader-like)
  function field(x, y, time){
    const nx = x / W, ny = y / H;

    const a = Math.sin(nx*10 + time*1.0) * Math.cos(ny*6 - time*0.8);
    const b = Math.cos(ny*9 - time*0.9) * Math.sin(nx*7 + time*0.7);
    const c = Math.sin((nx*4 + ny*3) * 2 + time*0.6);

    // swirl souris
    const dx = nx - mx, dy = ny - my;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const swirl = Math.cos(dist*18 - time*3.0) * Math.exp(-dist*6.0);

    return a*0.35 + b*0.35 + c*0.22 + swirl*0.65;
  }

  function drawLiquid(){
    // base
    ctx.fillStyle = "#050914";
    ctx.fillRect(0,0,W,H);

    // rendu par tuiles (qualité/perf)
    const tile = (W < 900) ? 7 : 5;

    for (let y=0; y<H; y+=tile){
      for (let x=0; x<W; x+=tile){
        const v = field(x + tile*0.5, y + tile*0.5, t);

        // couleurs WaveTools : cyan -> bleu -> violet
        const hue = 190 + v * 38;
        const alpha = 0.06 + Math.min(0.40, Math.abs(v) * 0.22);

        ctx.fillStyle = `hsla(${hue}, 95%, 60%, ${alpha})`;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // halos soft (pour éviter le banding)
    const g1 = ctx.createRadialGradient(W*0.22, H*0.22, 0, W*0.22, H*0.22, Math.max(W,H));
    g1.addColorStop(0, "rgba(0,212,255,0.10)");
    g1.addColorStop(0.55, "rgba(0,212,255,0.03)");
    g1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g1; ctx.fillRect(0,0,W,H);

    const g2 = ctx.createRadialGradient(W*0.78, H*0.25, 0, W*0.78, H*0.25, Math.max(W,H));
    g2.addColorStop(0, "rgba(106,92,255,0.10)");
    g2.addColorStop(0.6, "rgba(106,92,255,0.03)");
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2; ctx.fillRect(0,0,W,H);

    // halo souris
    const cx = mx*W, cy = my*H;
    const gm = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W,H)*0.30);
    gm.addColorStop(0, "rgba(0,255,168,0.08)");
    gm.addColorStop(1, "rgba(0,255,168,0)");
    ctx.fillStyle = gm; ctx.fillRect(0,0,W,H);

    // beam vague (très animé)
    const yy = H*(0.25 + 0.12*Math.sin(t*0.9));
    const beam = ctx.createLinearGradient(0, yy-220, 0, yy+220);
    beam.addColorStop(0, "rgba(0,0,0,0)");
    beam.addColorStop(0.45, "rgba(0,212,255,0.05)");
    beam.addColorStop(0.50, "rgba(255,255,255,0.03)");
    beam.addColorStop(0.55, "rgba(106,92,255,0.05)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0, yy-260, W, 520);
  }

  function drawNetwork(){
    // particules + attraction souris
    const cx = mx*W, cy = my*H;

    for(const p of P){
      // attraction douce vers la souris
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d = Math.hypot(dx,dy);
      if (d < 260){
        p.vx += (dx / (d+1)) * 0.006;
        p.vy += (dy / (d+1)) * 0.006;
      }

      // friction
      p.vx *= 0.985;
      p.vy *= 0.985;

      p.x += p.vx;
      p.y += p.vy;

      // wrap
      if(p.x < -40) p.x = W+40;
      if(p.x > W+40) p.x = -40;
      if(p.y < -40) p.y = H+40;
      if(p.y > H+40) p.y = -40;
    }

    // liens
    for(let i=0;i<P.length;i++){
      for(let j=i+1;j<P.length;j++){
        const a=P[i], b=P[j];
        const dx=a.x-b.x, dy=a.y-b.y;
        const dist=Math.hypot(dx,dy);
        if(dist < 140){
          const alpha = (1 - dist/140) * 0.16;
          ctx.strokeStyle = `rgba(170,220,255,${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }

    // points
    for(const p of P){
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.a})`;
      ctx.fill();
    }
  }

  function grain(){
    // anti-banding
    ctx.fillStyle = "rgba(255,255,255,0.012)";
    for(let i=0;i<500;i++){
      ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
    }
  }

  function loop(){
    t += 0.022; // PLUS animé que ta version actuelle
    drawLiquid();
    drawNetwork();
    grain();
    requestAnimationFrame(loop);
  }

  resize();
  seed();

  window.addEventListener("resize", () => { resize(); seed(); }, { passive:true });
  window.addEventListener("pointermove", onMove, { passive:true });

  requestAnimationFrame(loop);
})();