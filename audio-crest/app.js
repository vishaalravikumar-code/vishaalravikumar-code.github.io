const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fdate = d => d ? new Date(d.length > 10 ? d.replace(' ', 'T') + 'Z' : d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const plusDays = n => ymd(new Date(Date.now() + n * 864e5));
const STAGE_LABEL = { lead: 'Lead', quoted: 'Quoted', won: 'Won · Ordered', installation: 'Installation', completed: 'Completed', lost: 'Lost' };
let CFG = {}, view = 'dashboard', openClient = null, payFilter = 'all', clientQuery = '', catQuery = '', catCat = '', PRODUCTS = [], stockAll = false, delFilter = 'open';

async function api(path, method = 'GET', body) {
  const r = await (window.localFetch || fetch)('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  if (!r.ok) { toast(j.error || 'Something went wrong', true); throw new Error(j.error); }
  return j;
}
let tt;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }
const tag = s => `<span class="tag ${esc(s)}">${esc(STAGE_LABEL[s] || s)}</span>`;

// ---------- modal / drawer ----------
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function closeDrawer() { $('#drawer').hidden = true; openClient = null; render(); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (!$('#drawer').hidden) closeDrawer(); } });

// ---------- views ----------
async function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const main = $('#main');
  const T = { dashboard: ['Dashboard', 'Where your money and leads stand today'], pipeline: ['Pipeline', 'Every client from first enquiry to final payment'], clients: ['Clients', 'Everyone you have quoted or sold to'], payments: ['Payments', 'Instalments due, paid and overdue'], stock: ['Stock', 'What you hold, what has gone out and what is still to be delivered'], catalog: ['Catalog', 'Brands, models and services you can add to quotations'], emails: ['Emails', 'Quotations, reminders and follow-ups'] }[view];
  $('#title').textContent = T[0]; $('#sub').textContent = T[1];
  main.classList.toggle('wide', view === 'pipeline');
  const seq = ++renderSeq, v = view;   // ignore stale results if the user switched pages while this one was loading
  const views = { dashboard: vDashboard, pipeline: vPipeline, clients: vClients, payments: vPayments, emails: vEmails, catalog: vCatalog, stock: vStock };
  const html = await views[v]();
  if (seq !== renderSeq) return;
  main.innerHTML = html;
  if (v === 'pipeline') wireDnD();
}
let renderSeq = 0;

async function vDashboard() {
  const d = await api('/dashboard');
  const max = Math.max(1, ...Object.values(d.stageCounts));
  const stages = CFG.stages.map(s => `<div class="bar"><span class="n">${STAGE_LABEL[s]}</span><span class="t"><i style="width:${(d.stageCounts[s] || 0) / max * 100}%"></i></span><span class="c">${d.stageCounts[s] || 0}</span></div>`).join('');
  const up = d.upcoming.length ? `<table><tr><th>Client</th><th>For</th><th>Due</th><th class="r">Balance</th></tr>${d.upcoming.map(p => `<tr class="click" data-open="${p.client_id}"><td>${esc(p.client_name)}</td><td>${esc(p.label)}</td><td>${fdate(p.due_date)} ${p.status === 'overdue' ? '<span class="tag overdue">overdue</span>' : ''}</td><td class="r">${inr(p.balance)}</td></tr>`).join('')}</table>` : '<div class="empty">No payments pending.</div>';
  const pq = d.pendingQuotes.length ? `<table><tr><th>Quote</th><th>Client</th><th>Status</th><th class="r">Total</th></tr>${d.pendingQuotes.map(x => `<tr class="click" data-open="${x.client_id}"><td>${esc(x.number)}</td><td>${esc(x.client_name)}</td><td>${tag(x.status)}</td><td class="r">${inr(x.total)}</td></tr>`).join('')}</table>` : '<div class="empty">No open quotations.</div>';
  return `<div class="grid g4">
    <div class="card stat warn"><div class="ic">₹</div><div><div class="l">Outstanding</div><div class="v">${inr(d.outstanding)}</div></div></div>
    <div class="card stat bad"><div class="ic">!</div><div><div class="l">Overdue (${d.overdueCount})</div><div class="v">${inr(d.overdue)}</div></div></div>
    <div class="card stat ok"><div class="ic">✓</div><div><div class="l">Collected this month</div><div class="v">${inr(d.collectedMonth)}</div></div></div>
    <div class="card stat gold"><div class="ic">✉</div><div><div class="l">Quotes awaiting reply</div><div class="v">${inr(d.pipelineValue)}</div></div></div>
    <div class="card stat ${d.deliveries.overdue ? 'bad' : 'info'}"><div class="ic">▤</div><div><div class="l">Units to deliver${d.deliveries.overdue ? ` (${d.deliveries.overdue} late)` : ''}</div><div class="v">${qty(d.deliveries.units)}</div></div></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Upcoming &amp; overdue payments</h3>${up}</div>
    <div class="card"><h3>Pipeline</h3>${stages}</div>
    <div class="card"><h3>Open quotations</h3>${pq}</div>
    <div class="card"><h3>Upcoming deliveries</h3>${d.deliveries.upcoming.length ? `<table><tr><th>Client</th><th>Item</th><th class="r">Qty</th><th>Expected</th></tr>${d.deliveries.upcoming.map(o => `<tr class="click" data-open="${o.client_id}"><td>${esc(o.client_name)}</td><td>${esc(o.description)}</td><td class="r">${qty(o.pending)}</td><td>${fdate(o.expected_date)} ${o.status === 'overdue' ? '<span class="tag overdue">late</span>' : ''}</td></tr>`).join('')}</table>` : '<div class="empty">Nothing waiting to be delivered.</div>'}</div>
    <div class="card"><h3>Email automation</h3>
      <p class="mute">Runs daily from ${CFG.hour}:00 while this ${CFG.static ? 'page is open in your browser' : 'server is running'}. Sends payment reminders (3 days before, on the due date, then every 3 days when overdue), quotation follow-ups (3 and 7 days after sending) and a Google review request ${CFG.reviewDelay} days after a client is marked Completed. Each email is sent once.</p>${CFG.reviewUrl ? '' : `<div class="note">Review requests are off: ${CFG.static ? 'add your Google review link under Settings (bottom of the sidebar).' : 'add <code>GOOGLE_REVIEW_URL</code> to <code>.env</code> and restart.'}</div>`}
      <p>Mode: ${CFG.smtp ? '<span class="tag sent">SMTP live</span>' : '<span class="tag dry-run">Dry-run: nothing is actually sent</span>'}<br>
      <span class="mute">Last run: ${CFG.lastRun ? fdate(CFG.lastRun.slice(0, 10)) + ' ' + new Date(CFG.lastRun).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'never'}</span></p>
      <button class="btn" data-act="run-auto">Run automation now</button></div></div>`;
}

async function vPipeline() {
  const cs = await api('/clients');
  return `<div class="board">${CFG.stages.map(s => {
    const list = cs.filter(c => c.stage === s);
    return `<div class="col" data-stage="${s}"><h3>${STAGE_LABEL[s]} <span>${list.length}</span></h3>${list.map(c => `<div class="kc" draggable="true" data-id="${c.id}" data-open="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.interest || c.source || '')}</small>${c.billed ? `<div><small>${inr(c.paid)} / ${inr(c.billed)}</small></div>` : ''}${c.overdue ? '<div class="od">● payment overdue</div>' : ''}</div>`).join('')}</div>`;
  }).join('')}</div><p class="mute">Drag a card to move a client between stages. Accepting a quotation moves them to “Won” and creates their payment schedule automatically.</p>`;
}
function wireDnD() {
  let dragId = null;
  document.querySelectorAll('.kc').forEach(k => k.addEventListener('dragstart', e => { dragId = k.dataset.id; e.dataTransfer.effectAllowed = 'move'; }));
  document.querySelectorAll('.col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async e => { e.preventDefault(); col.classList.remove('over'); if (!dragId) return; await api(`/clients/${dragId}/stage`, 'PUT', { stage: col.dataset.stage }); dragId = null; render(); });
  });
}

async function vClients() {
  const cs = (await api('/clients')).filter(c => (c.name + c.phone + c.email + c.interest).toLowerCase().includes(clientQuery.toLowerCase()));
  return `<div class="toolbar"><input id="cq" placeholder="Search clients…" value="${esc(clientQuery)}"><span class="mute">${cs.length} clients</span></div>
  <div class="card">${cs.length ? `<table><tr><th>Name</th><th>Contact</th><th>Stage</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Balance</th></tr>${cs.map(c => `<tr class="click" data-open="${c.id}"><td><b>${esc(c.name)}</b><br><small class="mute">${esc(c.interest || '')}</small></td><td>${esc(c.phone || '')}<br><small class="mute">${esc(c.email || '')}</small></td><td>${tag(c.stage)}</td><td class="r">${c.billed ? inr(c.billed) : '—'}</td><td class="r">${c.billed ? inr(c.paid) : '—'}</td><td class="r" style="${c.overdue ? 'color:var(--bad);font-weight:600' : ''}">${c.billed ? inr(c.billed - c.paid) : '—'}</td></tr>`).join('')}</table>` : '<div class="empty">No clients yet. Click “+ New client”.</div>'}</div>`;
}

async function vPayments() {
  const all = await api('/payments');
  const ps = all.filter(p => payFilter === 'all' || (payFilter === 'open' ? p.status !== 'paid' : p.status === payFilter));
  const chips = ['all', 'open', 'overdue', 'partial', 'paid'].map(f => `<button class="${payFilter === f ? 'on' : ''}" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('');
  return `<div class="toolbar chips">${chips}</div><div class="card">${ps.length ? `<table><tr><th>Client</th><th>For</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th>Status</th><th></th></tr>${ps.map(p => `<tr><td><a href="#" data-open="${p.client_id}" style="color:var(--text);font-weight:500">${esc(p.client_name)}</a></td><td>${esc(p.label)}</td><td>${fdate(p.due_date)}</td><td class="r">${inr(p.amount)}</td><td class="r">${inr(p.paid_amount)}</td><td>${tag(p.status)}</td><td class="r">${p.status !== 'paid' ? `<button class="btn sm" data-act="pay" data-id="${p.id}">Record</button> <button class="btn sm" data-act="remind" data-id="${p.id}">Remind</button>` : `<button class="btn sm" data-act="undo" data-id="${p.id}">Undo</button>`}</td></tr>`).join('')}</table>` : '<div class="empty">Nothing here.</div>'}</div>`;
}

async function vCatalog() {
  PRODUCTS = await api('/products');
  const cats = [...new Set(PRODUCTS.map(p => p.category))];
  const list = PRODUCTS.filter(p => (!catCat || p.category === catCat) && `${p.brand || ''} ${p.name} ${p.category}`.toLowerCase().includes(catQuery.toLowerCase()));
  return `<div class="toolbar"><input id="pq" placeholder="Search brand, model, category…" value="${esc(catQuery)}">
    <select id="pcat" style="width:auto"><option value="">All categories</option>${cats.map(c => `<option ${c === catCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <span class="mute">${list.length} items</span><button class="btn primary" style="margin-left:auto" data-act="add-product">+ Add item</button></div>
  <p class="hint">Set your selling price once and it fills in automatically when you quote the item. Prices also update when you change them on a quotation.</p>
  <div class="card">${list.length ? `<table><tr><th>Item</th><th>Category</th><th class="r">Price (₹, before GST)</th><th></th></tr>${list.map(p => `<tr><td><b>${esc(p.brand || '')}</b> ${esc(p.name)}</td><td>${tag2(p.category)}</td><td class="r"><input class="pinput" type="number" min="0" data-pid="${p.id}" value="${p.price || ''}" placeholder="Set price"></td><td class="r"><button class="btn sm danger" data-act="del-product" data-id="${p.id}">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">No items match.</div>'}</div>`;
}
const tag2 = c => `<span class="tag">${esc(c)}</span>`;
function productForm() {
  const cats = [...new Set(PRODUCTS.map(p => p.category))];
  modal(`<h2>Add catalog item</h2><form id="prf" class="f"><div><label>Brand (optional)</label><input name="brand" placeholder="e.g. KEF"></div><div><label>Model / item *</label><input name="name" required placeholder="e.g. LS50 Meta"></div>
  <div><label>Category</label><input name="category" list="catlist" value="Speakers"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div><div><label>Price ₹ (before GST)</label><input name="price" type="number" min="0"></div>
  <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Add</button></div></form>`);
  $('#prf').onsubmit = async e => { e.preventDefault(); await api('/products', 'POST', Object.fromEntries(new FormData(e.target))); closeModal(); toast('Added to catalog'); render(); };
}

// searchable item picker for quote lines
function attachPicker(box, onPick) {
  const inp = box.querySelector('.d'), dd = box.querySelector('.dd'); let hi = -1, opts = [];
  const label = p => `${p.brand ? p.brand + ' ' : ''}${p.name}`;
  function draw() {
    const t = inp.value.trim().toLowerCase();
    const m = PRODUCTS.filter(p => !t || `${label(p)} ${p.category}`.toLowerCase().includes(t));
    opts = m.slice(0, 120); hi = opts.length && t ? 0 : -1;
    let html = '', last = '';
    opts.forEach((p, i) => { if (!t && p.category !== last) { last = p.category; html += `<div class="gh">${esc(last)}</div>`; } html += `<div class="o" data-i="${i}"><span>${p.brand ? `<b>${esc(p.brand)}</b> ` : ''}${esc(p.name)}</span><small>${t ? esc(p.category) + ' · ' : ''}${p.price ? inr(p.price) : 'no price'}</small></div>`; });
    if (!opts.length) html += '<div class="none">No catalog match.</div>';
    if (t) html += `<div class="o custom" data-i="custom">＋ Use “${esc(inp.value.trim())}” as a custom item</div>`;
    if (m.length > 120) html += '<div class="none">Keep typing to narrow down…</div>';
    dd.innerHTML = html; dd.hidden = false; mark();
  }
  const mark = () => dd.querySelectorAll('.o').forEach(o => o.classList.toggle('hi', o.dataset.i === String(hi)));
  function pick(i) { if (i === 'custom') { dd.hidden = true; return; } const p = opts[+i]; if (!p) return; inp.value = label(p); dd.hidden = true; onPick(p); }
  inp.addEventListener('focus', draw); inp.addEventListener('input', draw);
  inp.addEventListener('blur', () => setTimeout(() => dd.hidden = true, 120));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { hi = Math.min(opts.length - 1, hi + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter' && !dd.hidden) { e.preventDefault(); e.stopPropagation(); hi >= 0 ? pick(hi) : (dd.hidden = true); }
    else if (e.key === 'Escape' && !dd.hidden) { dd.hidden = true; e.stopPropagation(); }
  });
  dd.addEventListener('mousedown', e => { const o = e.target.closest('.o'); if (o) { e.preventDefault(); pick(o.dataset.i); } });
}

const qty = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dtag = s => `<span class="tag ${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;
async function vStock() {
  const [st, dl, hist] = await Promise.all([api('/stock'), api('/deliveries'), api('/stock/history')]);
  window._deliv = dl;
  const rows = st.filter(r => stockAll || r.received || r.ordered);
  const open = dl.filter(o => o.pending > 0);
  const stat = (cls, ic, l, v) => `<div class="card stat ${cls}"><div class="ic">${ic}</div><div><div class="l">${l}</div><div class="v">${v}</div></div></div>`;
  const list = dl.filter(o => delFilter === 'all' || (delFilter === 'open' ? o.pending > 0 : o.status === delFilter));
  const chips = [['open', 'To deliver'], ['overdue', 'Overdue'], ['delivered', 'Delivered'], ['all', 'All']].map(([k, l]) => `<button class="${delFilter === k ? 'on' : ''}" data-dfilter="${k}">${l}</button>`).join('');
  const status = r => r.free < 0 ? `<span class="tag overdue">Short ${qty(-r.free)}</span>` : r.toDeliver > 0 ? '<span class="tag paid">Covered</span>' : r.onHand > 0 ? '<span class="tag">In stock</span>' : '<span class="tag">—</span>';
  return `<div class="grid g4" style="margin-bottom:16px">
    ${stat('gold', '▤', 'Units in hand', qty(rows.reduce((s, r) => s + Math.max(0, r.onHand), 0)))}
    ${stat('info', '→', 'Units yet to deliver', qty(open.reduce((s, o) => s + o.pending, 0)))}
    ${stat(open.some(o => o.status === 'overdue') ? 'bad' : 'ok', '!', 'Deliveries overdue', open.filter(o => o.status === 'overdue').length)}
    ${stat(rows.some(r => r.free < 0) ? 'warn' : 'ok', '⇣', 'Items to order from suppliers', rows.filter(r => r.free < 0).length)}</div>
  <div class="card" style="margin-bottom:16px"><div class="sub"><h3>Stock statement</h3><span><label class="chk" style="display:inline-flex"><input type="checkbox" id="showAll" ${stockAll ? 'checked' : ''}> Show all catalog items</label></span><button class="btn primary" data-act="receive">+ Receive stock</button></div>
    ${rows.length ? `<table><tr><th>Item</th><th class="r">Received</th><th class="r">Delivered</th><th class="r">On hand</th><th class="r">Yet to deliver</th><th>Status</th><th></th></tr>${rows.map(r => `<tr><td><b>${esc(r.brand || '')}</b> ${esc(r.name)}<br><small class="mute">${esc(r.category)}</small></td><td class="r">${qty(r.received)}</td><td class="r">${qty(r.delivered)}</td><td class="r ${r.onHand < 0 ? 'neg' : ''}">${qty(r.onHand)}</td><td class="r">${qty(r.toDeliver)}</td><td>${status(r)}</td><td class="r"><button class="btn sm" data-act="receive" data-name="${esc(`${r.brand ? r.brand + ' ' : ''}${r.name}`)}">+ Receive</button></td></tr>`).join('')}</table>
    <p class="hint" style="margin-top:10px"><b>On hand</b> = received − delivered. <b>Short</b> means more is promised to clients than you hold, so order it from the supplier, then record it with “Receive stock”.</p>` : '<div class="empty">No stock yet. Click “+ Receive stock” to add what you hold. Equipment on accepted quotations shows up here automatically.</div>'}</div>
  <div class="card" style="margin-bottom:16px"><div class="sub"><h3>Delivery schedule</h3><div class="toolbar chips" style="margin:0">${chips}</div></div>
    ${list.length ? `<table><tr><th>Client</th><th>Item</th><th class="r">Ordered</th><th class="r">Delivered</th><th class="r">Pending</th><th>Expected on</th><th>Status</th><th></th></tr>${list.map(o => `<tr><td><a href="#" data-open="${o.client_id}" style="color:var(--text);font-weight:500">${esc(o.client_name)}</a></td><td>${esc(o.description)}</td><td class="r">${qty(o.qty)}</td><td class="r">${qty(o.delivered)}</td><td class="r">${qty(o.pending)}</td><td>${o.pending > 0 ? `<input class="dateinp" type="date" data-oid="${o.id}" value="${esc(o.expected_date || '')}">` : `Delivered ${fdate(o.last_delivered)}`}</td><td>${dtag(o.status)}</td><td class="r">${o.pending > 0 ? `<button class="btn sm primary" data-act="deliver" data-id="${o.id}">Deliver</button> ` : ''}<button class="btn sm danger" data-act="del-order" data-id="${o.id}" title="Remove this line">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">Nothing here. Equipment appears automatically when a quotation is accepted.</div>'}</div>
  <div class="card"><h3>Stock movement history</h3>${hist.length ? `<table><tr><th>Date</th><th>Type</th><th>Item</th><th class="r">Qty</th><th>From / to</th><th>Note</th><th></th></tr>${hist.map(h => `<tr><td>${fdate(h.date)}</td><td>${h.type === 'in' ? '<span class="tag in">Received</span>' : '<span class="tag out">Delivered</span>'}</td><td>${esc(`${h.brand ? h.brand + ' ' : ''}${h.name}`)}</td><td class="r">${qty(h.qty)}</td><td>${esc(h.party || '—')}</td><td class="mute">${esc(h.note || '')}</td><td class="r"><button class="btn sm danger" data-act="undo-log" data-type="${h.type}" data-id="${h.id}" title="Undo this entry">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">No movements yet.</div>'}</div>`;
}
async function receiveForm(name = '') {
  PRODUCTS = (await api('/products')).filter(p => !['Installation', 'Servicing', 'Services'].includes(p.category));
  modal(`<h2>Receive stock</h2><form id="rf" class="f"><div class="full"><label>Item *</label><div class="cb"><input class="d" name="desc" autocomplete="off" required value="${esc(name)}" placeholder="Search the catalog, or type a new item"><div class="dd" hidden></div></div></div>
  <div><label>Quantity *</label><input name="qty" type="number" min="0.01" step="any" required></div><div><label>Date received</label><input name="date" type="date" value="${todayStr()}"></div>
  <div class="full"><label>Supplier / invoice no. (optional)</label><input name="supplier"></div><div class="full"><label>Note (optional)</label><input name="note" placeholder="e.g. serial numbers, box condition"></div>
  <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Add to stock</button></div></form>`);
  attachPicker($('#rf .cb'), () => $('#rf [name=qty]').focus());
  $('#rf').onsubmit = async e => { e.preventDefault(); await api('/stock/receipts', 'POST', Object.fromEntries(new FormData(e.target))); closeModal(); toast('Stock added'); refresh(); };
  (name ? $('#rf [name=qty]') : $('#rf .d')).focus();
}
function deliverForm(id) {
  const o = (window._deliv || []).find(x => x.id === id) || (window._client?.orderItems || []).find(x => x.id === id); if (!o) return;
  modal(`<h2>Record delivery</h2><p class="mute"><b>${esc(o.description)}</b> for ${esc(o.client_name)}<br>Ordered ${qty(o.qty)} · delivered ${qty(o.delivered)} · <b>${qty(o.pending)} left</b></p>
  <form id="df" class="f"><div><label>Quantity delivered</label><input name="qty" type="number" min="0.01" max="${o.pending}" step="any" value="${o.pending}" required></div><div><label>Delivery date</label><input name="date" type="date" value="${todayStr()}"></div>
  <div class="full"><label>Note (optional)</label><input name="note" placeholder="e.g. received by Mr. Menon, DC no. 1042"></div>
  <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Save delivery</button></div></form>`);
  $('#df').onsubmit = async e => {
    e.preventDefault(); const r = await api(`/deliveries/${id}/deliver`, 'POST', Object.fromEntries(new FormData(e.target))); closeModal();
    toast(r.onHand < 0 ? `Delivered. Stock on hand is now ${qty(r.onHand)}: remember to record what you received` : r.movedToInstallation ? 'All delivered. Client moved to Installation' : 'Delivery recorded'); refresh();
  };
}

async function vEmails() {
  const es = await api('/emails');
  return `${CFG.smtp ? '' : `<div class="note">${CFG.static ? 'This browser-only version cannot send email. Messages are written here so you can preview and copy them.' : 'Dry-run mode: emails are generated and logged here but not delivered. Add SMTP details to <code>.env</code> to send for real.'}</div>`}
  <div class="card">${es.length ? `<table><tr><th>When</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th></tr>${es.map(e => `<tr class="click" data-email="${e.id}"><td>${fdate(e.created_at)}</td><td>${esc(e.kind)}</td><td>${esc(e.client_name || '')}<br><small class="mute">${esc(e.to_addr || '')}</small></td><td>${esc(e.subject)}</td><td>${tag(e.status)}${e.error ? `<br><small class="mute">${esc(e.error)}</small>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No emails yet.</div>'}</div>`;
}

// ---------- client drawer ----------
async function showClient(id) {
  openClient = id;
  const c = await api('/clients/' + id);
  const billed = c.payments.reduce((s, p) => s + p.amount, 0), paid = c.payments.reduce((s, p) => s + p.paid_amount, 0);
  const d = $('#drawer');
  d.innerHTML = `<div class="row"><h2 style="flex:1">${esc(c.name)}</h2><button class="btn" data-act="close-drawer">Close ✕</button></div>
  <div class="row"><select id="stageSel" style="width:auto">${CFG.stages.map(s => `<option value="${s}" ${s === c.stage ? 'selected' : ''}>${STAGE_LABEL[s]}</option>`).join('')}</select>
  ${billed ? `<span class="mute">Paid ${inr(paid)} of ${inr(billed)}</span>` : ''}</div>
  <div class="sec"><h3>Details <button class="btn sm" data-act="edit-client">Edit</button></h3>
    <div class="mute">${esc(c.phone || 'No phone')} · ${esc(c.email || 'No email')}<br>${esc(c.address || '')}<br>${c.source ? 'Source: ' + esc(c.source) + '<br>' : ''}${c.interest ? 'Interested in: ' + esc(c.interest) + '<br>' : ''}${esc(c.notes || '')}</div></div>
  <div class="sec"><h3>Quotations <button class="btn sm" data-act="new-quote">+ New quote</button></h3>
    ${c.quotes.length ? `<table>${c.quotes.map(x => `<tr><td>${esc(x.number)}<br><small class="mute">${x.items.length} item(s) · valid ${fdate(x.valid_until)}</small></td><td>${tag(x.status)}</td><td class="r">${inr(x.total)}</td><td class="r">${['draft', 'sent'].includes(x.status) ? `<button class="btn sm" data-act="send-quote" data-id="${x.id}">${x.status === 'sent' ? 'Resend' : 'Email'}</button> <button class="btn sm primary" data-act="accept-quote" data-id="${x.id}">Accepted</button> <button class="btn sm" data-act="reject-quote" data-id="${x.id}">✕</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No quotations yet.</div>'}</div>
  <div class="sec"><h3>Payments <button class="btn sm" data-act="add-payment">+ Add</button></h3>
    ${c.payments.length ? `<table>${c.payments.map(p => `<tr><td>${esc(p.label)}<br><small class="mute">Due ${fdate(p.due_date)}${p.paid_date ? ' · paid ' + fdate(p.paid_date) + (p.method ? ' via ' + esc(p.method) : '') : ''}</small></td><td>${tag(p.status)}</td><td class="r">${inr(p.paid_amount)} / ${inr(p.amount)}</td><td class="r">${p.status !== 'paid' ? `<button class="btn sm" data-act="pay" data-id="${p.id}">Record</button> <button class="btn sm" data-act="remind" data-id="${p.id}">Remind</button>` : ''}<button class="btn sm danger" data-act="del-payment" data-id="${p.id}">✕</button></td></tr>`).join('')}</table>` : '<div class="empty">No payments. Accept a quotation to generate the schedule.</div>'}</div>
  <div class="sec"><h3>Equipment &amp; delivery</h3>${c.orderItems.length ? `<table>${c.orderItems.map(o => `<tr><td>${esc(o.description)}<br><small class="mute">${o.status === 'delivered' ? 'Delivered ' + fdate(o.last_delivered) : 'Expected ' + fdate(o.expected_date)}</small></td><td>${dtag(o.status)}</td><td class="r">${qty(o.delivered)} / ${qty(o.qty)}</td><td class="r">${o.pending > 0 ? `<button class="btn sm" data-act="deliver" data-id="${o.id}">Deliver</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No equipment on order. It appears here once a quotation is accepted.</div>'}</div>
  <div class="sec"><h3>Emails ${c.stage === 'completed' ? '<button class="btn sm" data-act="ask-review">★ Ask for Google review</button>' : ''}</h3>${c.emails.length ? `<table>${c.emails.slice(0, 8).map(e => `<tr class="click" data-email="${e.id}"><td>${fdate(e.created_at)}</td><td>${esc(e.subject)}</td><td>${tag(e.status)}</td></tr>`).join('')}</table>` : '<div class="empty">None sent yet.</div>'}</div>
  <div class="sec"><button class="btn danger" data-act="del-client">Delete client</button></div>`;
  d.hidden = false;
  $('#stageSel').onchange = async e => { await api(`/clients/${id}/stage`, 'PUT', { stage: e.target.value }); toast('Stage updated'); render(); };
  window._client = c;
}
const refresh = async () => { if (openClient) await showClient(openClient); render(); };

// ---------- forms ----------
function clientForm(c = {}) {
  const f = (k, l, ph = '', full) => `<div class="${full ? 'full' : ''}"><label>${l}</label><input name="${k}" value="${esc(c[k] || '')}" placeholder="${ph}"></div>`;
  modal(`<h2>${c.id ? 'Edit client' : 'New client'}</h2><form id="cf" class="f">
    ${f('name', 'Name *', '', 1)}${f('phone', 'Phone', '+91…')}${f('email', 'Email', 'Needed for quotes & reminders')}${f('address', 'Address / site', '', 1)}
    <div><label>Source</label><select name="source">${['', 'Walk-in', 'Referral', 'Instagram', 'Website', 'Architect / designer', 'Other'].map(s => `<option ${s === c.source ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    ${f('interest', 'Interested in', 'e.g. 2-channel system, home theatre')}
    <div class="full"><label>Notes</label><textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></div>
    <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
  $('#cf').onsubmit = async e => {
    e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
    if (c.id) { await api('/clients/' + c.id, 'PUT', b); toast('Saved'); closeModal(); refresh(); }
    else { const r = await api('/clients', 'POST', b); closeModal(); toast('Client added'); view = 'pipeline'; render(); showClient(r.id); }
  };
}

function quoteForm() {
  const c = window._client;
  api('/products').then(p => PRODUCTS = p);
  modal(`<h2>New quotation for ${esc(c.name)}</h2><p class="hint">Pick from the catalog or just type anything for a custom item. New items and prices are remembered in the Catalog.</p><form id="qf">
    <div id="lines"></div><button type="button" class="btn sm" id="addLine">+ Add line</button>
    <div class="f" style="margin-top:14px">
      <div><label>Discount (₹)</label><input name="discount" type="number" min="0" value="0"></div>
      <div><label>GST %</label><input name="gst_rate" type="number" min="0" value="${CFG.gst}"></div>
      <div><label>Valid until</label><input name="valid_until" type="date" value="${plusDays(14)}"></div>
      <div><label>Note (shown on quote)</label><input name="note" placeholder="e.g. Includes installation &amp; calibration"></div></div>
    <div class="totals" id="tot"></div>
    <div class="actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Save draft</button></div></form>`);
  const lines = $('#lines');
  const addLine = () => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<div class="cb"><input class="d" autocomplete="off" placeholder="Search brand, model, or type a custom item"><div class="dd" hidden></div></div><input class="q" type="number" min="1" value="1" style="flex:.6" title="Qty"><input class="p" type="number" min="0" placeholder="Rate ₹" style="flex:1"><button type="button" class="btn sm danger">✕</button>`; r.querySelector('button').onclick = () => { r.remove(); calc(); }; lines.append(r); attachPicker(r.querySelector('.cb'), p => { const pi = r.querySelector('.p'); if (p.price) pi.value = p.price; calc(); (p.price ? r.querySelector('.q') : pi).focus(); }); };
  const read = () => [...lines.children].map(r => ({ desc: r.querySelector('.d').value, qty: +r.querySelector('.q').value, price: +r.querySelector('.p').value }));
  const calc = () => {
    const f = $('#qf'), sub = read().reduce((s, i) => s + i.qty * i.price, 0), disc = +f.discount.value || 0, gst = Math.max(0, sub - disc) * (+f.gst_rate.value || 0) / 100;
    $('#tot').innerHTML = `<div><span>Subtotal</span><span>${inr(sub)}</span></div><div><span>Discount</span><span>− ${inr(disc)}</span></div><div><span>GST</span><span>${inr(gst)}</span></div><div class="g"><span>Total</span><span>${inr(Math.max(0, sub - disc) + gst)}</span></div>`;
  };
  $('#addLine').onclick = addLine; $('#qf').oninput = calc; addLine(); addLine(); calc();
  $('#qf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const items = read();
    await api(`/clients/${c.id}/quotes`, 'POST', { items, discount: f.discount.value, gst_rate: +f.gst_rate.value, valid_until: f.valid_until.value, note: f.note.value });
    api('/products/learn', 'POST', { items: items.filter(i => i.desc.trim() && i.qty > 0) }).catch(() => {});
    closeModal(); toast('Quotation saved. Click Email to send it.'); refresh();
  };
}

function acceptForm(qid) {
  const qt = window._client.quotes.find(x => x.id === qid);
  const rows = CFG.schedule.map(s => ({ ...s, due_date: plusDays(s.offsetDays) }));
  modal(`<h2>Quotation ${esc(qt.number)} accepted</h2><p class="mute">Total ${inr(qt.total)}. Set the payment schedule; reminders will go out automatically for each instalment.</p>
  <div id="sch">${rows.map((s, i) => `<div class="row"><input value="${esc(s.label)}" style="flex:2" data-k="label"><input type="number" value="${s.pct}" style="flex:.6" data-k="pct" title="%"><span>%</span><input type="date" value="${s.due_date}" style="flex:1.2" data-k="due_date"><span class="mute amt" style="width:100px;text-align:right"></span></div>`).join('')}</div>
  <div class="mute" id="pctnote"></div><div class="actions"><button class="btn" data-act="close-modal">Cancel</button><button class="btn primary" id="okAcc">Create payment schedule</button></div>`);
  const read = () => [...$('#sch').children].map(r => ({ label: r.querySelector('[data-k=label]').value, pct: +r.querySelector('[data-k=pct]').value, due_date: r.querySelector('[data-k=due_date]').value }));
  const upd = () => { const s = read(); [...$('#sch').children].forEach((r, i) => r.querySelector('.amt').textContent = inr(qt.total * s[i].pct / 100)); const t = s.reduce((a, x) => a + x.pct, 0); $('#pctnote').textContent = t === 100 ? '' : `Total is ${t}%. It must be 100%.`; };
  $('#sch').oninput = upd; upd();
  $('#okAcc').onclick = async () => { await api(`/quotes/${qid}/accept`, 'POST', { schedule: read() }); closeModal(); toast('Client moved to Won. Payment schedule created'); refresh(); };
}

function payForm(id) {
  modal(`<h2>Record payment</h2><form id="pf" class="f"><div><label>Amount (blank = full balance)</label><input name="amount" type="number" step="0.01" min="0"></div>
  <div><label>Date</label><input name="date" type="date" value="${todayStr()}"></div>
  <div class="full"><label>Method</label><select name="method">${['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card'].map(m => `<option>${m}</option>`).join('')}</select></div>
  <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
  $('#pf').onsubmit = async e => { e.preventDefault(); await api(`/payments/${id}/pay`, 'POST', Object.fromEntries(new FormData(e.target))); closeModal(); toast('Payment recorded'); refresh(); };
}

function addPaymentForm() {
  const c = window._client;
  modal(`<h2>Add payment for ${esc(c.name)}</h2><form id="apf" class="f"><div class="full"><label>Label</label><input name="label" placeholder="e.g. Extra cabling" required></div>
  <div><label>Amount ₹</label><input name="amount" type="number" min="1" step="0.01" required></div><div><label>Due date</label><input name="due_date" type="date"></div>
  <div class="full actions"><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary">Add</button></div></form>`);
  $('#apf').onsubmit = async e => { e.preventDefault(); await api('/payments', 'POST', { ...Object.fromEntries(new FormData(e.target)), client_id: c.id }); closeModal(); refresh(); };
}

async function showEmail(id) {
  const e = await api('/emails/' + id);
  modal(`<h2>${esc(e.subject)}</h2><p class="mute">To: ${esc(e.to_addr || '(no address)')} · ${tag(e.status)} ${esc(e.error || '')}</p><iframe sandbox srcdoc="${esc(e.body)}"></iframe><div class="actions"><button class="btn" data-act="close-modal">Close</button></div>`);
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-open],[data-email],a'); if (!t) return;
  if (t.id === 'menuBtn') { const s = $('.side'); const o = s.classList.toggle('open'); t.setAttribute('aria-expanded', o); return; }
  if (t.tagName === 'A') e.preventDefault();
  const d = t.dataset, id = +d.id;
  if (d.view) { view = d.view; closeDrawerSilent(); $('.side').classList.remove('open'); window.scrollTo(0, 0); return render(); }
  if (d.filter) { payFilter = d.filter; return render(); }
  if (d.dfilter) { delFilter = d.dfilter; return render(); }
  if (d.email) return showEmail(d.email);
  if (d.open && !d.act) return showClient(d.open);
  try {
    switch (d.act) {
      case 'new-client': return clientForm();
      case 'edit-client': return clientForm(window._client);
      case 'close-modal': return closeModal();
      case 'close-drawer': return closeDrawer();
      case 'new-quote': return quoteForm();
      case 'accept-quote': return acceptForm(id);
      case 'send-quote': { const r = await api(`/quotes/${id}/send`, 'POST'); toast(r.status === 'sent' ? 'Quotation emailed' : 'Dry-run: logged in Emails tab, not delivered'); return refresh(); }
      case 'reject-quote': await api(`/quotes/${id}/reject`, 'POST'); return refresh();
      case 'pay': return payForm(id);
      case 'undo': await api(`/payments/${id}/undo`, 'POST'); return refresh();
      case 'remind': { const r = await api(`/payments/${id}/remind`, 'POST'); toast(r.status === 'sent' ? 'Reminder emailed' : 'Dry-run: logged, not delivered'); return refresh(); }
      case 'add-payment': return addPaymentForm();
      case 'ask-review': { const r = await api(`/clients/${openClient}/review`, 'POST'); toast(r.status === 'sent' ? 'Review request emailed' : 'Dry-run: logged, not delivered'); return refresh(); }
      case 'receive': return receiveForm(d.name || '');
      case 'deliver': return deliverForm(id);
      case 'del-order': if (confirm('Remove this equipment line from the order? Any deliveries logged against it are removed too.')) { await api('/deliveries/' + id, 'DELETE'); refresh(); } return;
      case 'undo-log': if (confirm('Undo this entry? Stock levels will be recalculated.')) { await api(`/${d.type === 'in' ? 'stock/receipts' : 'deliveries/log'}/${id}`, 'DELETE'); refresh(); } return;
      case 'add-product': return productForm();
      case 'del-product': if (confirm('Remove this item from the catalog? Existing quotations are not affected.')) { await api('/products/' + id, 'DELETE'); render(); } return;
      case 'del-payment': if (confirm('Delete this payment entry?')) { await api('/payments/' + id, 'DELETE'); refresh(); } return;
      case 'del-client': if (confirm('Delete this client and all their quotes, payments and emails? This cannot be undone.')) { await api('/clients/' + openClient, 'DELETE'); closeDrawer(); } return;
      case 'run-auto': { const r = await api('/automation/run', 'POST'); CFG = await api('/config'); toast(`Automation: ${r.reminders} reminder(s), ${r.followups} follow-up(s), ${r.reviews} review request(s) processed`); return render(); }
    }
  } catch { /* toast already shown */ }
});
function closeDrawerSilent() { $('#drawer').hidden = true; openClient = null; }
document.addEventListener('change', async e => {
  if (e.target.dataset.pid) { await api('/products/' + e.target.dataset.pid, 'PUT', { price: e.target.value || 0 }); toast('Price saved'); }
  if (e.target.id === 'pcat') { catCat = e.target.value; render(); }
  if (e.target.id === 'showAll') { stockAll = e.target.checked; render(); }
  if (e.target.dataset.oid) { await api('/deliveries/' + e.target.dataset.oid, 'PUT', { expected_date: e.target.value || null }); toast('Delivery date saved'); render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pq') { catQuery = e.target.value; const p = e.target.selectionStart; vCatalog().then(h => { $('#main').innerHTML = h; const i = $('#pq'); i.focus(); i.setSelectionRange(p, p); }); return; } if (e.target.id === 'cq') { clientQuery = e.target.value; const p = e.target.selectionStart; vClients().then(h => { $('#main').innerHTML = h; const i = $('#cq'); i.focus(); i.setSelectionRange(p, p); }); } });

(async () => {
  CFG = await api('/config'); render();
  if (CFG.auth) { const l = $('#logout'); l.hidden = false; l.onclick = async e => { e.preventDefault(); await (window.localFetch || fetch)('/api/logout', { method: 'POST' }); if (!window.localFetch) location.href = '/login'; }; }
})();

// Label every table cell with its column header so tables can turn into stacked cards on phones (CSS only applies on small screens).
function stackTables() {
  document.querySelectorAll('table:not([data-stacked])').forEach(t => {
    t.dataset.stacked = '1'; t.classList.add('stack');
    const head = [...t.querySelectorAll('th')].map(th => th.textContent.trim());
    if (!head.length) t.classList.add('nohead');
    t.querySelectorAll('tr').forEach(tr => {
      if (tr.querySelector('th')) { tr.classList.add('hr'); return; }
      [...tr.children].forEach((td, i) => { td.dataset.label = head[i] || ''; });
    });
  });
}
new MutationObserver(stackTables).observe(document.body, { childList: true, subtree: true });
