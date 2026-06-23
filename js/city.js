/* ============================================================
   CITY — isometric buildings on canvas, parallax grid, particles
   ============================================================ */

class City {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0;
    this.mx = 0; this.my = 0;
    this.tick = 0;
    this.buildings = [];
    this.flows = [];
    this.particles = [];
    this.resize();
    this.initParticles();
  }

  resize() {
    this.W = this.canvas.width  = window.innerWidth;
    this.H = this.canvas.height = window.innerHeight;
    this.initBuildings();
    this.initFlows();
  }

  initBuildings() {
    this.buildings = CASE_STUDIES.map((cs, i) => ({
      ...cs,
      px: cs.cityX * this.W,
      py: cs.cityY * this.H,
      height: 50 + i * 18,
      hover: false,
      glowR: 0,
      pulse: i * (Math.PI * 2 / CASE_STUDIES.length),
    }));
  }

  initFlows() {
    this.flows = [];
    const n = this.buildings.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        this.flows.push({
          from: i, to: j,
          progress: Math.random(),
          speed: 0.0015 + Math.random() * 0.002,
          opacity: 0,
        });
      }
    }
  }

  initParticles() {
    const COLORS = ['#00F7FF', '#FF00AA', '#7A00FF'];
    this.particles = Array.from({ length: 70 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.2 + 0.3,
      base: Math.random() * 0.35 + 0.08,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }

  setMouse(x, y) { this.mx = x; this.my = y; }

  setHover(idx, state) {
    if (this.buildings[idx]) this.buildings[idx].hover = state;
  }

  draw() {
    const { ctx, W, H, tick, mx, my } = this;
    this.tick++;

    ctx.clearRect(0, 0, W, H);
    this._drawGrid(mx, my);
    this._drawParticles();
    this._drawFlows();
    this.buildings.forEach((b, i) => this._drawBuilding(b, i));
  }

  _drawGrid(mx, my) {
    const { ctx, W, H } = this;
    const px = (mx - W / 2) * 0.015;
    const py = (my - H / 2) * 0.015;
    const gs = 58;

    ctx.save();
    ctx.translate(px, py);
    ctx.strokeStyle = 'rgba(0,247,255,0.04)';
    ctx.lineWidth = 0.5;

    // Horizontal
    for (let r = -1; r < Math.ceil(H / gs) + 2; r++) {
      ctx.beginPath();
      ctx.moveTo(-gs * 2, r * gs);
      ctx.lineTo(W + gs * 2, r * gs);
      ctx.stroke();
    }
    // Diagonal (iso feel)
    for (let c = -6; c < Math.ceil(W / gs) * 2 + 6; c++) {
      ctx.beginPath();
      ctx.moveTo(c * gs - H, -gs);
      ctx.lineTo(c * gs + H, H + gs);
      ctx.stroke();
    }
    ctx.restore();

    // Vignette fog
    const fog = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.85);
    fog.addColorStop(0, 'transparent');
    fog.addColorStop(1, 'rgba(8,8,18,0.65)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);
  }

  _drawParticles() {
    const { ctx, W, H, tick } = this;
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.phase += 0.018;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      const a = p.base * (0.6 + 0.4 * Math.sin(p.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  _drawFlows() {
    const { ctx, buildings, tick } = this;
    this.flows.forEach(f => {
      const a = buildings[f.from], b = buildings[f.to];
      if (!a || !b) return;
      const active = a.hover || b.hover;
      f.opacity += ((active ? 0.8 : 0.07) - f.opacity) * 0.06;
      if (f.opacity < 0.005) return;
      f.progress = (f.progress + f.speed) % 1;

      // Connection line
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.strokeStyle = `rgba(0,247,255,${f.opacity * 0.18})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Traveling packet
      const px = a.px + (b.px - a.px) * f.progress;
      const py = a.py + (b.py - a.py) * f.progress;
      ctx.globalAlpha = f.opacity * 0.9;
      ctx.fillStyle = '#00F7FF';
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  _drawBuilding(b, idx) {
    const { ctx, mx, my, tick } = this;
    b.pulse += 0.025;
    const targetGlow = b.hover ? 28 : 0;
    b.glowR += (targetGlow - b.glowR) * 0.1;

    // Parallax offset
    const px = b.px + (mx - this.W / 2) * 0.018;
    const py = b.py + (my - this.H / 2) * 0.018;

    const w = 38, h = b.height, d = 18;

    ctx.save();
    ctx.translate(px, py);

    // Ambient glow beneath building
    if (b.glowR > 0.5) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.glowR * 3.5);
      const [r, gv, bv] = this._hexToRgb(b.color);
      g.addColorStop(0, `rgba(${r},${gv},${bv},0.18)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(-b.glowR * 3.5, -b.glowR * 3.5, b.glowR * 7, b.glowR * 7);
    }

    const alpha  = b.hover ? 'CC' : '55';
    const alphaF = b.hover ? '22' : '0D';
    const lw     = b.hover ? 1.2 : 0.6;

    // Right face
    ctx.beginPath();
    ctx.moveTo(w / 2, -h); ctx.lineTo(w / 2, 0);
    ctx.lineTo(0, d / 2);  ctx.lineTo(0, -h + d / 2);
    ctx.closePath();
    ctx.fillStyle = b.color + '12'; ctx.fill();
    ctx.strokeStyle = b.color + alpha; ctx.lineWidth = lw; ctx.stroke();

    // Left face
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h); ctx.lineTo(-w / 2, 0);
    ctx.lineTo(0, d / 2);   ctx.lineTo(0, -h + d / 2);
    ctx.closePath();
    ctx.fillStyle = b.color + '0A'; ctx.fill();
    ctx.strokeStyle = b.color + (b.hover ? 'AA' : '33'); ctx.lineWidth = lw; ctx.stroke();

    // Top face
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h); ctx.lineTo(0, -h - d / 2);
    ctx.lineTo(w / 2, -h);  ctx.lineTo(0, -h + d / 2);
    ctx.closePath();
    ctx.fillStyle = b.color + (b.hover ? '28' : '10'); ctx.fill();
    ctx.strokeStyle = b.color + (b.hover ? 'FF' : '77'); ctx.lineWidth = lw + 0.3; ctx.stroke();

    // Windows
    const wRows = Math.floor(h / 11);
    for (let wr = 0; wr < wRows; wr++) {
      for (let wc = 0; wc < 3; wc++) {
        const lit = Math.sin(tick * 0.04 + wr * 2.1 + wc * 3.7 + idx) > 0.15;
        const flicker = Math.random() > 0.998;
        if (lit && !flicker) {
          ctx.fillStyle = b.hover ? b.color + 'CC' : b.color + '55';
          ctx.fillRect(-w / 2 + 6 + wc * 10, -h + 8 + wr * 11, 5, 4);
        }
      }
    }

    // Hover label
    if (b.hover) {
      ctx.font = '7px Courier New';
      ctx.textAlign = 'center';
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.fillText(b.id, 0, -h - d / 2 - 10);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }
}
