(() => {
  const c = document.getElementById('siteBg');
  if (!c) return;

  const ctx = c.getContext('2d');
  if (!ctx) return;

  function preventTouchZoom(e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }

  document.addEventListener('touchstart', preventTouchZoom, { passive: false });
  document.addEventListener('touchmove', preventTouchZoom, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W, H, t = 0;
  const COUNT = 110;
  const MAX_DIST = 150;
  const MAX_DIST_SQ = MAX_DIST * MAX_DIST;
  const FRAME_SPEED = reduceMotion ? 0.005 : 0.01;

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = window.devicePixelRatio || 1;

    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    c.width = Math.floor(width * ratio);
    c.height = Math.floor(height * ratio);

    if (ctx.resetTransform) {
      ctx.resetTransform();
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.scale(ratio, ratio);

    W = width;
    H = height;
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize, { passive: true });
  }

  const P = Array.from({ length: COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: Math.random() * 0.5 - 0.25,
    vy: Math.random() * 0.5 - 0.25,
    r: Math.random() * 1 + 1.2,
  }));

  function drawParticles() {
    for (const p of P) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,255,0.75)';
      ctx.fill();
    }
  }

  function drawLinks() {
    for (let i = 0, len = P.length; i < len; i++) {
      const a = P[i];
      for (let j = i + 1; j < len; j++) {
        const b = P[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSq = dx * dx + dy * dy;

        if (distanceSq < MAX_DIST_SQ) {
          const distance = Math.sqrt(distanceSq);
          ctx.strokeStyle = `rgba(0,180,255,${1 - distance / MAX_DIST})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  function glow() {
    const gx = W * (0.5 + 0.15 * Math.sin(t * 0.2));
    const gy = H * (0.5 + 0.15 * Math.cos(t * 0.18));
    const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H));

    gradient.addColorStop(0, 'rgba(0,255,255,0.12)');
    gradient.addColorStop(0.5, 'rgba(80,0,255,0.06)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }

  function loop() {
    t += FRAME_SPEED;
    ctx.fillStyle = '#050914';
    ctx.fillRect(0, 0, W, H);

    glow();
    drawLinks();
    drawParticles();

    requestAnimationFrame(loop);
  }

  loop();
})();
