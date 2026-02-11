/* =========================================
   WaveTools — Simple Animated Background
   File: site-bg.js
   (Canvas 2D, no WebGL)
   ========================================= */

(() => {
  const canvas = document.getElementById("siteBg");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) return;

  let W=0, H=0, DPR=1;
  let t=0;

  // petites particules (discrètes)
  const P = [];
  const COUNT = 55;

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
        vx:rnd(-0.10,0.10),
        vy:rnd(-0.08,0.08),
        r:rnd(0.8,2.0),
        a:rnd(0.08,0.32)
      });
    }
  }

  // “Aurora” : 3 nappes colorées qui bougent (pas de gros pixels/bandes)
  function aurora(){
    // fond profond
    ctx.fillStyle = "rgba(5,9,20,1)";
    ctx.fillRect(0,0,W,H);

    // nappe cyan
    const a1x = W*(0.20 + 0.08*Math.sin(t*0.25));
    const a1y = H*(0.25 + 0.06*Math.cos(t*0.22));
    const g1 = ctx.createRadialGradient(a1x, a1y, 0, a1x, a1y, Math.max(W,H)*0.75);
    g1.addColorStop(0, "rgba(0,212,255,0.12)");
    g1.addColorStop(0.55, "rgba(0,212,255,0.03)");
    g1.addColorStop(1, "rgba(0,212,255,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0,0,W,H);

    // nappe violette
    const a2x = W*(0.78 + 0.07*Math.cos(t*0.18));
    const a2y = H*(0.28 + 0.07*Math.sin(t*0.20));
    const g2 = ctx.createRadialGradient(a2x, a2y, 0, a2x, a2y, Math.max(W,H)*0.80);
    g2.addColorStop(0, "rgba(106,92,255,0.11)");
    g2.addColorStop(0.60, "rgba(106,92,255,0.03)");
    g2.addColorStop(1, "rgba(106,92,255,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,W,H);

    // nappe verte très légère (juste un accent)
    const a3x = W*(0.55 + 0.06*Math.sin(t*0.16));
    const a3y = H*(0.88 + 0.04*Math.cos(t*0.15));
    const g3 = ctx.createRadialGradient(a3x, a3y, 0, a3x, a3y, Math.max(W,H)*0.60);
    g3.addColorStop(0, "rgba(0,255,168,0.06)");
    g3.addColorStop(1, "rgba(0,255,168,0)");
    ctx.fillStyle = g3;
    ctx.fillRect(0,0,W,H);

    // “vague” douce (beam large)
    const y = H*(0.22 + 0.08*Math.sin(t*0.35));
    const beam = ctx.createLinearGradient(0, y-140, 0, y+140);
    beam.addColorStop(0, "rgba(0,0,0,0)");
    beam.addColorStop(0.40, "rgba(0,212,255,0.04)");
    beam.addColorStop(0.50, "rgba(255,255,255,0.02)");
    beam.addColorStop(0.60, "rgba(106,92,255,0.035)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0, y-180, W, 360);
  }

  function particles(){
    for(const p of P){
      p.x += p.vx; p.y += p.vy;
      if(p.x < -20) p.x = W+20;
      if(p.x > W+20) p.x = -20;
      if(p.y < -20) p.y = H+20;
      if(p.y > H+20) p.y = -20;

      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(170,220,255,${p.a})`;
      ctx.fill();
    }
  }

  // Grain léger pour casser le banding (sans image externe)
  function grain(){
    // on dessine quelques points aléatoires transparents
    const n = 350;
    ctx.fillStyle = "rgba(255,255,255,0.015)";
    for(let i=0;i<n;i++){
      const x = Math.random()*W;
      const y = Math.random()*H;
      ctx.fillRect(x,y,1,1);
    }
  }

  function loop(){
    t += 0.016;

    aurora();
    particles();
    grain();

    requestAnimationFrame(loop);
  }

  resize();
  seed();
  window.addEventListener("resize", () => { resize(); seed(); });

  requestAnimationFrame(loop);
})();