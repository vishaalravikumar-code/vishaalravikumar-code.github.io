// Browser-only runtime: runs the same core.js as the Node server, with SQLite (sql.js / WebAssembly)
// persisted in this browser's localStorage, and a tiny router standing in for Express.
import { createCore } from './core.js';

const LS_DB = 'ac_db_v1', LS_CFG = 'ac_cfg_v1';
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function boot() {
  await loadScript('sql-wasm.js');
  const SQL = await window.initSqlJs({ locateFile: f => f });
  let saved = null; try { saved = localStorage.getItem(LS_DB); } catch {}
  const raw = new SQL.Database(saved ? fromB64(saved) : undefined);

  let timer = null, warned = false;
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(LS_DB, toB64(raw.export())); } catch (e) { if (!warned) { warned = true; window.toast?.('Could not save in this browser (storage full or blocked). Download a backup from Settings.', true); } } }, 250); };
  const norm = p => p.map(v => (v === undefined ? null : v));
  const db = {
    exec(sql) { raw.exec(sql); persist(); },
    prepare(sql) {
      return {
        all(...p) { const st = raw.prepare(sql); try { st.bind(norm(p)); const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; } finally { st.free(); } },
        get(...p) { const st = raw.prepare(sql); try { st.bind(norm(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
        run(...p) { raw.run(sql, norm(p)); const id = raw.exec('SELECT last_insert_rowid()')[0].values[0][0]; persist(); return { lastInsertRowid: id, changes: raw.getRowsModified() }; },
      };
    },
  };

  // ---- settings (stored in this browser) ----
  const CFG = { port: 0, company: 'Audio Crest', city: 'Chennai', phone: '', payDetails: '', gst: 18, hour: 9, reviewUrl: '', reviewDelay: 3, auth: true, smtp: false, static: true, from: '' };
  try { Object.assign(CFG, JSON.parse(localStorage.getItem(LS_CFG) || '{}'), { auth: true, smtp: false, static: true }); } catch {}

  // ---- minimal Express-compatible router ----
  const routes = [];
  const add = method => (pattern, handler) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:[A-Za-z]+/g, m => (keys.push(m.slice(1)), '([^/]+)')) + '$'); routes.push({ method, re, keys, handler }); };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  function dispatch(method, rawUrl, body) {
    const url = rawUrl.split('?')[0];
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(url); if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      return new Promise(resolve => {
        let status = 200;
        const res = { status(c) { status = c; return res; }, json(o) { resolve({ status, body: o }); return res; }, send(o) { resolve({ status, body: o }); return res; }, setHeader() {} };
        try { const out = r.handler({ params, body: body || {}, query: {} }, res); if (out && out.catch) out.catch(e => resolve({ status: 500, body: { error: e.message } })); }
        catch (e) { resolve({ status: 500, body: { error: e.message } }); }
      });
    }
    return Promise.resolve({ status: 404, body: { error: 'Not found' } });
  }

  const core = createCore({ db, CFG, transport: null, app });

  window.localFetch = async (url, opts = {}) => {
    if (url === '/api/logout') { try { sessionStorage.removeItem('ac_ok'); } catch {} location.reload(); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    const r = await dispatch((opts.method || 'GET').toUpperCase(), url, opts.body ? JSON.parse(opts.body) : undefined);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };

  await loadScript('app.js');
  core.schedulerTick(); setInterval(core.schedulerTick, 30 * 60 * 1000);

  // ---- Settings & backup (injected into the sidebar) ----
  const foot = document.querySelector('.side-foot');
  if (foot) {
    foot.append(el('<div style="margin-top:6px"><a href="#" id="settings" style="color:var(--mute)">Settings &amp; backup</a></div>'));
    document.getElementById('settings').onclick = e => { e.preventDefault(); document.querySelector('.side')?.classList.remove('open'); openSettings(); };
  }
  function openSettings() {
    const f = (k, l, ph = '') => `<div class="full"><label>${l}</label><input name="${k}" value="${esc(CFG[k])}" placeholder="${esc(ph)}"></div>`;
    window.modal(`<h2>Settings &amp; backup</h2>
      <div class="note">This version runs entirely in your browser. Your data is saved <b>only in this browser on this device</b>. It is not shared between devices, and clearing site data erases it. Download a backup regularly. Emails cannot be sent from here: they are written to the Emails tab so you can preview and copy them.</div>
      <form id="sf" class="f">${f('company', 'Business name')}${f('phone', 'Phone (shown in emails)', '+91 …')}${f('payDetails', 'Payment details (shown in reminders)', 'Bank / UPI …')}${f('reviewUrl', 'Google review link', 'https://g.page/r/…/review')}
      <div><label>Default GST %</label><input name="gst" type="number" min="0" value="${CFG.gst}"></div><div><label>Review request delay (days)</label><input name="reviewDelay" type="number" min="0" value="${CFG.reviewDelay}"></div>
      <div class="full actions" style="justify-content:space-between"><span><button type="button" class="btn" id="dl">⬇ Download backup</button> <label class="btn" style="display:inline-block;cursor:pointer;margin:0">⬆ Restore backup<input id="up" type="file" accept=".db,.sqlite" hidden></label></span>
      <span><button type="button" class="btn" data-act="close-modal">Cancel</button> <button class="btn primary">Save</button></span></div></form>`);
    document.getElementById('sf').onsubmit = e => {
      e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
      const next = { company: b.company || 'Audio Crest', phone: b.phone, payDetails: b.payDetails, reviewUrl: b.reviewUrl.trim(), gst: +b.gst || 0, reviewDelay: +b.reviewDelay || 0 };
      try { localStorage.setItem(LS_CFG, JSON.stringify(next)); } catch {}
      location.reload();
    };
    document.getElementById('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([raw.export()], { type: 'application/octet-stream' })); a.download = `audiocrest-backup-${new Date().toISOString().slice(0, 10)}.db`; a.click(); };
    document.getElementById('up').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      if (!confirm('Replace ALL data in this browser with the backup file? This cannot be undone.')) return;
      try { const bytes = new Uint8Array(await file.arrayBuffer()); new SQL.Database(bytes).exec('SELECT count(*) FROM clients'); localStorage.setItem(LS_DB, toB64(bytes)); location.reload(); }
      catch { window.toast('That file is not a valid Audio Crest backup', true); }
    };
  }
}
