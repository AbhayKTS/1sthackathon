/**
 * RevengersHack Network Background
 * GPU-accelerated particle network canvas — fixed viewport, draws only visible area.
 * Fades in after hero. Camera travel + scroll interaction + R-bolt logo formation.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("rh-net-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  /* ── Config ──────────────────────────────────────────────── */
  const CFG = {
    COUNT: 520,
    CONNECT_DIST: 140,
    CONNECT_MAX: 4,
    BASE_SPEED: 0.18,
    GLOW_ALPHA: 0.5,
    LINE_ALPHA: 0.15,
    NODE_R: 1.7,
    NODE_R_LIT: 3.0,
    CAM_DRIFT: 0.005,
    LOGO_INTERVAL_MS: 22000,
    LOGO_FORM_MS: 4500,
    LOGO_HOLD_MS: 3200,
    LOGO_SCATTER_MS: 1800,
    LOGO_DRIFT_K: 0.022,
  };

  /* ── Resize ───────────────────────────────────────────────── */
  let W = 0, H = 0;
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    canvas.style.width  = "100%";
    canvas.style.height = "100%";
  }
  resize();
  window.addEventListener("resize", () => { resize(); randomizeParticles(); });

  /* ── R + Lightning bolt logo shape (normalised 0→1) ─────────
     Based on the RevengersHack logo: bold italic R + diagonal bolt */
  function buildLogoShape() {
    const pts = [];
    function line(x1, y1, x2, y2, steps) {
      for (let t = 0; t <= 1; t += 1 / steps) {
        pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
      }
    }
    function arc(cx, cy, rx, ry, a0, a1, steps) {
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (a1 - a0) * i / steps;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
    }

    // ── R vertical left spine
    line(0.15, 0.08, 0.15, 0.90, 18);
    // ── R top cross bar
    line(0.15, 0.08, 0.50, 0.08, 8);
    // ── R bump outer arc
    arc(0.50, 0.30, 0.16, 0.22, -Math.PI / 2, Math.PI / 2, 14);
    // ── R bump middle bar (comes back to spine level)
    line(0.50, 0.52, 0.15, 0.52, 8);
    // ── R diagonal leg (from mid-right down to bottom-right)
    line(0.42, 0.52, 0.72, 0.90, 12);

    // ── Lightning bolt (diagonal slash, 2 edges)
    // Left edge
    line(0.44, 0.08, 0.30, 0.46, 9);
    line(0.30, 0.46, 0.46, 0.46, 5);
    line(0.46, 0.46, 0.32, 0.88, 10);
    // Right edge (slight width)
    line(0.54, 0.08, 0.40, 0.46, 9);
    line(0.40, 0.46, 0.54, 0.46, 5);
    line(0.54, 0.46, 0.40, 0.88, 10);

    return pts;
  }
  const LOGO_SHAPE = buildLogoShape();

  /* ── Particles ────────────────────────────────────────────── */
  // Particles live in a large virtual world around the viewport
  // Each particle has worldX/worldY (relative to a "camera") and gets projected
  const WORLD = 3000; // virtual space size

  class Particle {
    constructor(init = false) {
      this.worldX = (Math.random() - 0.5) * WORLD;
      this.worldY = (Math.random() - 0.5) * WORLD;
      this.z = 0.4 + Math.random() * 1.6; // depth
      this.vx = (Math.random() - 0.5) * CFG.BASE_SPEED;
      this.vy = (Math.random() - 0.5) * CFG.BASE_SPEED;
      this.baseR = CFG.NODE_R + Math.random() * 0.8;
      this.alpha = 0.35 + Math.random() * 0.55;
      // Logo state
      this.forming = false;
      this.tx = 0; this.ty = 0; // screen-space target during logo
    }
    // Projected screen coords
    sx(camX) { return W / 2 + (this.worldX - camX) * this.z; }
    sy(camY) { return H / 2 + (this.worldY - camY) * this.z; }
  }

  let particles = [];
  function randomizeParticles() {
    particles = [];
    for (let i = 0; i < CFG.COUNT; i++) particles.push(new Particle(true));
  }
  randomizeParticles();

  /* ── Camera ───────────────────────────────────────────────── */
  let camX = 0, camY = 0;
  let camVX = 0, camVY = 0;

  /* ── Scroll ───────────────────────────────────────────────── */
  let scrollY = window.scrollY;
  let lastScrollY = scrollY;
  window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });

  /* ── Logo formation ───────────────────────────────────────── */
  let logoPhase = "idle"; // "form" | "hold" | "scatter"
  let logoT0 = 0;
  let logoParticles = [];
  let nextLogoAt = Date.now() + CFG.LOGO_INTERVAL_MS;

  function startLogo() {
    if (logoPhase !== "idle") return;
    const heroH = window.innerHeight;
    if (scrollY < heroH * 1.2) return; // only after hero
    logoPhase = "form";
    logoT0 = Date.now();

    const LOGO_W = Math.min(W * 0.32, 260);
    const LOGO_H = LOGO_W * 1.1;
    const CX = W * 0.5, CY = H * 0.48;

    const count = Math.min(LOGO_SHAPE.length, Math.floor(CFG.COUNT * 0.6));
    logoParticles = [];
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const sp = LOGO_SHAPE[i % LOGO_SHAPE.length];
      p.tx = CX + (sp.x - 0.45) * LOGO_W;
      p.ty = CY + (sp.y - 0.5) * LOGO_H;
      p.forming = true;
      logoParticles.push(p);
    }
  }

  function tickLogo(now) {
    if (logoPhase === "idle") {
      if (now >= nextLogoAt) startLogo();
      return;
    }
    const elapsed = now - logoT0;

    if (logoPhase === "form") {
      // Drift particles toward logo targets (screen space)
      for (const p of logoParticles) {
        const sx = p.sx(camX), sy = p.sy(camY);
        // Project target back to world space
        const wtx = camX + (p.tx - W / 2) / p.z;
        const wty = camY + (p.ty - H / 2) / p.z;
        p.worldX += (wtx - p.worldX) * CFG.LOGO_DRIFT_K;
        p.worldY += (wty - p.worldY) * CFG.LOGO_DRIFT_K;
      }
      if (elapsed > CFG.LOGO_FORM_MS) {
        logoPhase = "hold";
        logoT0 = now;
      }
    } else if (logoPhase === "hold") {
      if (elapsed > CFG.LOGO_HOLD_MS) {
        logoPhase = "scatter";
        logoT0 = now;
        for (const p of logoParticles) {
          p.vx = (Math.random() - 0.5) * CFG.BASE_SPEED * 3.5;
          p.vy = (Math.random() - 0.5) * CFG.BASE_SPEED * 3.5;
        }
      }
    } else if (logoPhase === "scatter") {
      if (elapsed > CFG.LOGO_SCATTER_MS) {
        for (const p of logoParticles) {
          p.forming = false;
          p.vx = (Math.random() - 0.5) * CFG.BASE_SPEED;
          p.vy = (Math.random() - 0.5) * CFG.BASE_SPEED;
        }
        logoParticles = [];
        logoPhase = "idle";
        nextLogoAt = now + CFG.LOGO_INTERVAL_MS;
      }
    }
  }

  /* ── Visibility pause ─────────────────────────────────────── */
  let hidden = false;
  document.addEventListener("visibilitychange", () => { hidden = document.hidden; });

  /* ── Main loop ────────────────────────────────────────────── */
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (hidden) return;
    const dt = Math.min((ts - last) / 16.67, 2.5);
    last = ts;
    const now = Date.now();

    /* -- Hero / footer alpha -------------------------------- */
    const heroH = window.innerHeight;
    const pastHero = Math.max(0, (scrollY - heroH * 0.5) / (heroH * 0.8));
    const heroAlpha = Math.min(1, pastHero);

    const docH = document.documentElement.scrollHeight;
    const toEnd = docH - (scrollY + window.innerHeight);
    const footerAlpha = Math.min(1, Math.max(0, toEnd / (window.innerHeight * 1.2)));

    const masterAlpha = heroAlpha * footerAlpha;
    canvas.style.opacity = masterAlpha.toFixed(3);

    if (masterAlpha < 0.01) return;

    /* -- Camera drift from scroll --------------------------- */
    const delta = scrollY - lastScrollY;
    lastScrollY = scrollY;
    camVX += (Math.random() - 0.5) * CFG.CAM_DRIFT * dt;
    camVY += delta * 0.000_5 * dt;
    camVX *= 0.96; camVY *= 0.94;
    camX += camVX; camY += camVY;

    /* -- Logo tick ------------------------------------------ */
    tickLogo(now);

    /* -- Clear & draw -------------------------------------- */
    ctx.clearRect(0, 0, W, H);

    // Footer density fade (reduce drawn particles near end)
    const densityCut = 0.3 + footerAlpha * 0.7;

    /* Update + collect visible */
    const visible = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Skip some in footer zone
      if (i > CFG.COUNT * 0.45 && Math.random() > densityCut) continue;

      if (p.forming && logoPhase !== "scatter") {
        /* held by logo engine */
      } else if (logoPhase === "scatter" && p.forming) {
        p.worldX += p.vx * dt * 3;
        p.worldY += p.vy * dt * 3;
        p.vx *= 0.97; p.vy *= 0.97;
      } else {
        p.worldX += p.vx * dt;
        p.worldY += p.vy * dt;
        // Wrap in virtual world
        const half = WORLD / 2;
        if (p.worldX >  half) p.worldX -= WORLD;
        if (p.worldX < -half) p.worldX += WORLD;
        if (p.worldY >  half) p.worldY -= WORLD;
        if (p.worldY < -half) p.worldY += WORLD;
      }

      const sx = p.sx(camX), sy = p.sy(camY);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      visible.push({ p, sx, sy });
    }

    // Draw connections
    ctx.lineWidth = 0.55;
    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      let c = 0;
      for (let j = i + 1; j < visible.length && c < CFG.CONNECT_MAX; j++) {
        const b = visible[j];
        const dx = a.sx - b.sx, dy = a.sy - b.sy;
        const d2 = dx * dx + dy * dy;
        const maxD = CFG.CONNECT_DIST * (1 + (a.p.z + b.p.z) * 0.15);
        if (d2 < maxD * maxD) {
          const fade = (1 - Math.sqrt(d2) / maxD) * CFG.LINE_ALPHA * footerAlpha;
          const lit = a.p.forming && b.p.forming && logoPhase !== "scatter";
          ctx.strokeStyle = lit
            ? `rgba(220,40,40,${Math.min(1, fade * 2.5)})`
            : `rgba(178,34,34,${fade})`;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
          c++;
        }
      }
    }

    // Draw nodes
    for (const { p, sx, sy } of visible) {
      const lit = p.forming && logoPhase !== "scatter";
      const r = lit ? CFG.NODE_R_LIT : p.baseR;
      const al = (lit ? 0.92 : p.alpha) * footerAlpha;

      // Glow
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 5);
      g.addColorStop(0, `rgba(200,20,20,${al * CFG.GLOW_ALPHA})`);
      g.addColorStop(1, "rgba(178,34,34,0)");
      ctx.beginPath();
      ctx.arc(sx, sy, r * 5, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = lit ? `rgba(255,55,55,${al})` : `rgba(178,34,34,${al})`;
      ctx.fill();
    }
  }

  requestAnimationFrame(loop);

})();
