/* =========================================
   WaveTools — Cyber Animated Background
   File: site-bg.js
   ========================================= */

(() => {
  const canvas = document.getElementById("siteBg");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let W=0, H=0, DPR=1;
  let mx=0.5, my=0.5;
  let t=0;

  const P = [];
  const COUNT = reduceMotion ? 0 : 120;

  function resize(){
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function seed(){
    P.length = 0;
    for(let i=0;i<COUNT;i++){
      P.push({
        x:rnd(0,W), y:rnd(0,H),
        vx:rnd(-0.35,0.35),
        vy:rnd(-0.25,0.25),
        r:rnd(0.8,2.2),
        a:rnd(0.12,0.7),
        hue: rnd(185,210) // cyan range
      });
    }
  }

  function onMove(e){
    mx = e.clientX / Math.max(1, W);
    my = e.clientY / Math.max(1, H);
  }

  // micro glitch on hover anywhere
  let glitchTimer = 0;
  window.addEventListener("pointerdown", () => {
    if (reduceMotion) return;
    document.body.classList.add("cyber-glitch");
    clearTimeout(glitchTimer);
    glitchTimer = setTimeout(()=>document.body.classList.remove("cyber-glitch"), 180);
  });

  function drawBackgroundGlow(){
    // base aurora gradients
    const g1 = ctx.createRadialGradient(W*0.22, H*0.22, 0, W*0.22, H*0.22, Math.max(W,H));
    g1.addColorStop(0, "rgba(0,212,255,0.10)");
    g1.addColorStop(0.55, "rgba(0,212,255,0.00)");
    ctx.fillStyle = g1;
    ctx.fillRect(0,0,W,H);

    const g2 = ctx.createRadialGradient(W*0.78, H*0.28, 0, W*0.78, H*0.28, Math.max(W,H));
    g2.addColorStop(0, "rgba(106,92,255,0.10)");
    g2.addColorStop(0.6, "rgba(106,92,255,0.00)");
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,W,H);

    // cursor glow
    const cx = mx * W, cy = my * H;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W,H)*0.35);
    cg.addColorStop(0, "rgba(0,255,168,0.08)");
    cg.addColorStop(1, "rgba(0,255,168,0)");
    ctx.fillStyle = cg;
    ctx.fillRect(0,0,W,H);
  }

  function drawBeam(){
    // neon beam moving slowly
    const y = (H*0.20) + Math.sin(t*0.45) * (H*0.08);
    const beam = ctx.createLinearGradient(0, y, 0, y+120);
    beam.addColorStop(0, "rgba(0,0,0,0)");
    beam.addColorStop(0.3, "rgba(0,212,255,0.06)");
    beam.addColorStop(0.5, "rgba(255,255,255,0.03)");
    beam.addColorStop(0.7, "rgba(106,92,255,0.05)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0, y-80, W, 220);
  }

  function drawParticles(){
    // particles
    for(const p of P){
      p.x += p.vx;
      p.y += p.vy;

      if(p.x < -40) p.x = W+40;
      if(p.x > W+40) p.x = -40;
      if(p.y < -40) p.y = H+40;
      if(p.y > H+40) p.y = -40;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.a})`;
      ctx.fill();
    }

    // connections
    for(let i=0;i<P.length;i++){
      for(let j=i+1;j<P.length;j++){
        const a=P[i], b=P[j];
        const dx=a.x-b.x, dy=a.y-b.y;
        const dist=Math.hypot(dx,dy);
        if(dist < 135){
          const alpha=(1 - dist/135) * 0.14;
          ctx.strokeStyle = `rgba(160,220,255,${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }
  }

  // occasional glitch slice (canvas only)
  function glitchSlice(){
    if (reduceMotion) return;
    if (Math.random() > 0.06) return;

    const sliceY = rnd(0, H);
    const sliceH = rnd(8, 32);
    const shiftX = rnd(-18, 18);

    const img = ctx.getImageData(0, sliceY, W, sliceH);
    ctx.putImageData(img, shiftX, sliceY);

    // tiny RGB split look using translucent overlays
    ctx.fillStyle = "rgba(0,212,255,0.03)";
    ctx.fillRect(0, sliceY, W, sliceH);

    ctx.fillStyle = "rgba(106,92,255,0.03)";
    ctx.fillRect(0, sliceY+2, W, sliceH);
  }

  function loop(){
    t += 0.016;

    ctx.clearRect(0,0,W,H);

    // base dark
    ctx.fillStyle = "rgba(5,9,20,1)";
    ctx.fillRect(0,0,W,H);

    drawBackgroundGlow();
    drawBeam();
    drawParticles();
    glitchSlice();

    requestAnimationFrame(loop);
  }

  resize();
  seed();
  window.addEventListener("resize", () => { resize(); seed(); });
  window.addEventListener("pointermove", onMove, { passive:true });

  if (!reduceMotion) requestAnimationFrame(loop);
  else loop();
})();