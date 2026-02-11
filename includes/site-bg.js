(() => {
  const canvas = document.getElementById("siteBg");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W=0, H=0, DPR=1;
  let t=0;
  let mx=0.5, my=0.5;
  let scrollT=0, scrollV=0;

  const P = [];
  const COUNT = reduceMotion ? 0 : 90;

  function resize(){
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function seed(){
    P.length = 0;
    for(let i=0;i<COUNT;i++){
      P.push({
        x:rnd(0,W), y:rnd(0,H),
        vx:rnd(-0.22,0.22), vy:rnd(-0.18,0.18),
        r:rnd(0.7,2.2),
        a:rnd(0.12,0.60),
        hue:rnd(185,210)
      });
    }
  }

  // champ “liquide” shader-like (sans WebGL)
  function field(x, y, time){
    const nx = x / W, ny = y / H;

    const a = Math.sin((nx*10 + time*0.90) + Math.sin(ny*6 - time*0.60));
    const b = Math.cos((ny*9  - time*0.75) + Math.cos(nx*7 + time*0.50));
    const c = Math.sin((nx*5  + ny*4) * 2 + time*0.40);

    const dx = nx - mx, dy = ny - my;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const swirl = Math.cos(dist*18 - time*2.1) * Math.exp(-dist*6.0);

    const par = Math.sin((nx*3 - ny*2) + scrollV*1.0);

    return (a*0.45 + b*0.35 + c*0.25 + swirl*0.85 + par*0.18);
  }

  function onPointerMove(e){
    mx = e.clientX / Math.max(1, W);
    my = e.clientY / Math.max(1, H);
  }

  function onScroll(){
    scrollT = (window.scrollY || 0) / 700;
  }

  function loop(){
    if (reduceMotion){
      ctx.clearRect(0,0,W,H);
      const g = ctx.createRadialGradient(W*0.25, H*0.2, 0, W*0.25, H*0.2, Math.max(W,H));
      g.addColorStop(0, "rgba(0,212,255,0.10)");
      g.addColorStop(0.5, "rgba(106,92,255,0.07)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0,0,W,H);
      return;
    }

    scrollV += (scrollT - scrollV) * 0.06;
    t += 0.016;

    ctx.clearRect(0,0,W,H);

    // tuiles = perf (plus petit = plus beau)
    const tile = (W < 900) ? 8 : 6;

    for (let y=0; y<H; y+=tile){
      for (let x=0; x<W; x+=tile){
        const v = field(x + tile*0.5, y + tile*0.5, t);
        const hue = 190 + v * 35; 
        const alpha = 0.08 + Math.min(0.42, Math.abs(v) * 0.22);
        ctx.fillStyle = `hsla(${hue}, 95%, 60%, ${alpha})`;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // fog doux
    const fog = ctx.createRadialGradient(W*0.28, H*0.22, 0, W*0.28, H*0.22, Math.max(W,H));
    fog.addColorStop(0, "rgba(0,212,255,0.10)");
    fog.addColorStop(0.45,"rgba(106,92,255,0.07)");
    fog.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(0,0,W,H);

    // particules
    for(const p of P){
      p.x += p.vx; p.y += p.vy;
      if(p.x < -30) p.x = W+30;
      if(p.x > W+30) p.x = -30;
      if(p.y < -30) p.y = H+30;
      if(p.y > H+30) p.y = -30;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.a})`;
      ctx.fill();
    }

    // liens
    for(let i=0;i<P.length;i++){
      for(let j=i+1;j<P.length;j++){
        const a=P[i], b=P[j];
        const dx=a.x-b.x, dy=a.y-b.y;
        const dist=Math.hypot(dx,dy);
        if(dist < 130){
          const alpha = (1 - dist/130) * 0.12;
          ctx.strokeStyle = `rgba(170,220,255,${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(loop);
  }

  resize();
  seed();
  onScroll();

  window.addEventListener("resize", () => { resize(); seed(); });
  window.addEventListener("scroll", onScroll, { passive:true });
  window.addEventListener("pointermove", onPointerMove, { passive:true });

  requestAnimationFrame(loop);
})();