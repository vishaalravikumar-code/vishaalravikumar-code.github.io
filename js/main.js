/* ============================================================
   MAIN — orchestrates boot, portrait, city, HUD, nav
   ============================================================ */

let mx = window.innerWidth / 2;
let my = window.innerHeight / 2;
let portrait, city;

// ── Boot sequence ────────────────────────────────────────────
function boot() {
  const bar = document.getElementById('boot-progress');
  bar.style.width = '100%';

  setTimeout(() => {
    document.getElementById('boot').classList.add('hidden');
    revealUI();
  }, 2000);
}

function revealUI() {
  document.querySelectorAll('.corner').forEach(el => el.classList.add('visible'));
  document.getElementById('hud-top').classList.add('visible');
  document.getElementById('hud-bottom').classList.add('visible');
  document.getElementById('info-panel').classList.add('visible');
  document.getElementById('identity').classList.add('visible');
}

// ── Nav nodes ────────────────────────────────────────────────
function buildNav() {
  const nav = document.getElementById('case-nav');
  nav.innerHTML = CASE_STUDIES.map((cs, i) => `
    <a class="cs-node" href="${cs.href}"
       onmouseenter="onNodeEnter(${i}, event)"
       onmouseleave="onNodeLeave(${i})">
      <span class="cs-id">[${cs.id}]</span>
      <span class="cs-title">${cs.title}</span>
      <span class="cs-tag">${cs.tags.split('//')[0].trim()}</span>
    </a>
  `).join('');
}

function onNodeEnter(idx, e) {
  city.setHover(idx, true);
  const cs = CASE_STUDIES[idx];
  const tt = document.getElementById('tooltip');
  document.getElementById('tt-id').textContent = cs.id;
  document.getElementById('tt-title').textContent = cs.desc;
  document.getElementById('tt-tags').textContent = cs.tags;
  tt.style.left = (e.clientX + 18) + 'px';
  tt.style.top  = (e.clientY - 44) + 'px';
  tt.classList.add('show');
}
function onNodeLeave(idx) {
  city.setHover(idx, false);
  document.getElementById('tooltip').classList.remove('show');
}

// ── HUD ──────────────────────────────────────────────────────
function updateHUD() {
  const now = new Date();
  document.getElementById('hud-time').textContent   = now.toTimeString().slice(0, 8);
  document.getElementById('hud-cursor').textContent =
    `${String(Math.round(mx)).padStart(4,'0')}, ${String(Math.round(my)).padStart(4,'0')}`;
}

// ── Mouse ────────────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  mx = e.clientX;
  my = e.clientY;
  city.setMouse(mx, my);

  // Portrait dissolve: proximity to center of screen
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const dist = Math.hypot(mx - cx, my - cy);
  const maxD = Math.min(window.innerWidth, window.innerHeight) * 0.42;
  const dissolveTarget = Math.max(0, 1 - dist / maxD) * 0.92;
  portrait.update(dissolveTarget);

  // Show nav when dissolve is deep enough
  if (dissolveTarget > 0.45) {
    document.getElementById('case-nav').classList.add('visible');
  } else {
    document.getElementById('case-nav').classList.remove('visible');
  }

  document.getElementById('hud-mode').textContent =
    dissolveTarget > 0.5 ? 'MODE: DISSOLVED' : 'MODE: PORTRAIT';
});

// ── Resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => city.resize());

// ── Render loop ──────────────────────────────────────────────
function loop() {
  city.draw();
  portrait.render();
  updateHUD();
  requestAnimationFrame(loop);
}

// ── Init ─────────────────────────────────────────────────────
portrait = new Portrait(document.getElementById('portrait'));
city     = new City(document.getElementById('bg-canvas'));
city.setMouse(mx, my);
buildNav();
boot();
loop();
