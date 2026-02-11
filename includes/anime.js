(() => {
  const c = document.getElementById("siteBg");
  if (!c) return;

  const ctx = c.getContext("2d", { alpha: false });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return;

  let W = 0, H = 0, DPR = 1, t = 0;

  const dots = [];
  const DOTS = 90;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    c.width = Math.floor(W * DPR);
    c.height = Math.floor(H * DPR);
    c.style.width = W + "px";
    c.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function seed() {
    dots.length = 0;
    for (let i = 0; i < DOTS; i++) {
      dots.push({
        x: rnd(0, W),
        y: rnd(0, H),
        vx: rnd(-0.18, 0.18),
        vy: rnd(-0.08, 0.22),
        r: rnd(0.8, 1.9),
        a: rnd(0.12, 0.35)
      });
    }
  }

  function base() {
    // fond profond
    ctx.fillStyle = "#050914";
    ctx.fillRect(0,0,W,H);

    // gradient vivant (pro)
    const cx = W*(0.55 + 0.10*Math.sin(t*0.12));
    const cy = H*(0.45 + 0.08*Math.cos(t*0.10));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W,H)*1.1);
    g.addColorStop(0,   "rgba(0,210,255,0.12)");
    g.addColorStop(0.5, "rgba(90,80,255,0.09)");
    g.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // halo secondaire (coin)
    const g2 = ctx.createRadialGradient(W*0.15, H*0.20, 0, W*0.15, H*0.20, Math.max(W,H));
    g2.addColorStop(0, "rgba(0,255,190,0.07)");
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,W,H);
  }

  function hudLines() {
    // lignes HUD fines (pro)
    ctx.lineWidth = 1;

    const step = 70;
    const off = (t*14) % step;

    for (let y = -step; y < H + step; y += step) {
      const yy = y + off;
      ctx.strokeStyle = "rgba(120,180,255,0.035)";
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }

    // “bracket” discret à droite (style UI)
    ctx.strokeStyle = "rgba(0,210,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(W-180, 90);
    ctx.lineTo(W-70, 90);
    ctx.lineTo(W-70, 200);
    ctx.stroke();

    ctx.strokeStyle = "rgba(90,80,255,0.05)";
    ctx.beginPath();
    ctx.arc(W-140, 220, 110, 0, Math.PI*2);
    ctx.stroke();

    // scanline très légère
    const sy = (t*90) % (H+260) - 130;
    const s = ctx.createLinearGradient(0, sy-100, 0, sy+100);
    s.addColorStop(0, "rgba(0,0,0,0)");
    s.addColorStop(0.5, "rgba(0,255,210,0.035)");
    s.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, sy-120, W, 240);
  }

  function particles() {
    // update
    for (const p of dots) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -30) p.x = W + 30;
      if (p.x > W + 30) p.x = -30;
      if (p.y < -30) p.y = H + 30;
      if (p.y > H + 30) p.y = -30;
    }

    // liens discrets
    for (let i = 0; i < dots.length; i++) {
      for (let j = i+1; j < dots.length; j++) {
        const a = dots[i], b = dots[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx,dy);
        if (d < 140) {
          const alpha = (1 - d/140) * 0.06;
          ctx.strokeStyle = `rgba(160,220,255,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }

    // points
    for (const p of dots) {
      ctx.fillStyle = `rgba(200,245,255,${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function vignette() {
    const v = ctx.createRadialGradient(W*0.5, H*0.45, 0, W*0.5, H*0.45, Math.max(W,H)*0.95);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0,0,W,H);
  }

  function grain() {
    ctx.fillStyle = "rgba(255,255,255,0.010)";
    for (let i = 0; i < 260; i++) {
      ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
    }
  }

  function loop() {
    t += 0.016;
    base();
    hudLines();
    particles();
    vignette();
    grain();
    requestAnimationFrame(loop);
  }

  resize();
  seed();
  addEventListener("resize", () => { resize(); seed(); }, { passive:true });

  requestAnimationFrame(loop);
})();