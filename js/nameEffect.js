/* ============================================================
   NAME EFFECT
   - Kaleidoscope pattern sampled from the live canvas, clipped
     inside the letterforms of "Vishaal Ravikumar"
   - Slow shimmer sweep left→right on loop
   - Gentle ambient opacity pulse
   ============================================================ */

class NameEffect {
  constructor(nameCanvas, kaleidoCanvas) {
    this.canvas  = nameCanvas;
    this.kCanvas = kaleidoCanvas;
    this.ctx     = nameCanvas.getContext('2d');
    this.shimX   = 0;
    this.tick    = 0;
    this.ready   = false;

    // Wait for Jersey 10 to load before drawing
    document.fonts.ready.then(() => {
      this.ready = true;
      this.resize();
    });
  }

  resize() {
    this.canvas.width  = Math.min(window.innerWidth * 0.85, 900);
    this.canvas.height = 72;
  }

  draw() {
    if (!this.ready) return;
    this.tick++;

    const { ctx, canvas, kCanvas } = this;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ── 1. Draw text as the base mask ────────────────────────
    ctx.save();
    ctx.font = '52px "Jersey 10"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Vishaal Ravikumar', W / 2, H / 2 + 2);
    ctx.restore();

    // ── 2. Clip kaleidoscope into the letterforms ─────────────
    // Sample from the center strip of the kaleido canvas so the
    // fill is always the live animated pattern.
    ctx.save();
    ctx.globalCompositeOperation = 'source-in';

    const kW = kCanvas.width, kH = kCanvas.height;
    // Source: centre 90% wide, top-third of the kaleido canvas
    const sx = kW * 0.05, sy = kH * 0.08;
    const sw = kW * 0.90, sh = kH * 0.28;
    ctx.drawImage(kCanvas, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();

    // ── 3. Shimmer sweep ─────────────────────────────────────
    const shimSpeed = 1.2;
    this.shimX = (this.shimX + shimSpeed) % (W + 260);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const shimmer = ctx.createLinearGradient(this.shimX - 130, 0, this.shimX + 130, 0);
    shimmer.addColorStop(0,   'rgba(255,255,255,0)');
    shimmer.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    shimmer.addColorStop(0.5, 'rgba(255,255,255,0.38)');
    shimmer.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    shimmer.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = shimmer;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // ── 4. Ambient pulse — gentle overall brightness breathe ──
    const pulse = 0.82 + 0.18 * Math.sin(this.tick * 0.018);
    this.canvas.style.opacity = pulse;
  }
}
