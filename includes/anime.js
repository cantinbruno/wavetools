window.addEventListener("DOMContentLoaded", () => {

  const c = document.getElementById("siteBg");
  if (!c) {
    console.error("siteBg canvas introuvable");
    return;
  }

  const ctx = c.getContext("2d", { alpha: false });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) return;

  let W=0, H=0, DPR=1, t=0;

  const P = [];
  const COUNT = 90;

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
        vx:rnd(-0.18,0.18),
        vy:rnd(-0.14,0.14),
        r:rnd(0.8,2.2),
        a:rnd(0.06,0.28)
      });
    }
  }

  function aurora(){

    ctx.fillStyle = "#050914";
    ctx.fillRect(0,0,W,H);

    // cyan glow
    const a1x = W*(0.22 + 0.10*Math.sin(t*0.25));
    const a1y = H*(0.26 + 0.08*Math.cos(t*0.22));
    let g = ctx.createRadialGradient(a1x,a1y,0,a1x,a1y,Math.max(W,H)*0.9);
    g.addColorStop(0,"rgba(0,212,255,0.20)");
    g.addColorStop(0.55,"rgba(0,212,255,0.06)");
    g.addColorStop(1,"rgba(0,212,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // purple glow
    const a2x = W*(0.80 + 0.08*Math.cos(t*0.20));
    const a2y = H*(0.30 + 0.08*Math.sin(t*0.18));
    g = ctx.createRadialGradient(a2x,a2y,0,a2x,a2y,Math.max(W,H));
    g.addColorStop(0,"rgba(106,92,255,0.17)");
    g.addColorStop(0.60,"rgba(106,92,255,0.05)");
    g.addColorStop(1,"rgba(106,92,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // wave beam
    const yy = H*(0.22 + 0.10*Math.sin(t*0.35));
    const beam = ctx.createLinearGradient(0,yy-260,0,yy+260);
    beam.addColorStop(0,"rgba(0,0,0,0)");
    beam.addColorStop(0.45,"rgba(0,212,255,0.06)");
    beam.addColorStop(0.50,"rgba(255,255,255,0.03)");
    beam.addColorStop(0.55,"rgba(106,92,255,0.06)");
    beam.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0,yy-300,W,600);
  }

  function particles(){
    for(const p of P){
      p.x += p.vx;
      p.y += p.vy;

      if(p.x < -30) p.x = W+30;
      if(p.x > W+30) p.x = -30;
      if(p.y < -30) p.y = H+30;
      if(p.y > H+30) p.y = -30;

      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(170,220,255,${p.a})`;
      ctx.fill();
    }
  }

  function grain(){
    ctx.fillStyle = "rgba(255,255,255,0.012)";
    for(let i=0;i<420;i++){
      ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
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

});