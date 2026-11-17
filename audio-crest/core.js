// Shared application logic. Runs unchanged in Node (server.js) and in the browser (static build).
// db: { exec, prepare(sql) -> { all, get, run } }   app: { get, post, put, delete }   transport: nodemailer-like or null
import { parseTally } from './tally.js?v=ad0a4f06';

export function createCore({ db, CFG, transport, app }) {
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS clients(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
  source TEXT, interest TEXT, stage TEXT NOT NULL DEFAULT 'lead', notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS quotes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  number TEXT, items TEXT NOT NULL, discount REAL DEFAULT 0, gst_rate REAL DEFAULT 18,
  subtotal REAL, gst REAL, total REAL, status TEXT NOT NULL DEFAULT 'draft', valid_until TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL, label TEXT NOT NULL, amount REAL NOT NULL,
  due_date TEXT, paid_amount REAL NOT NULL DEFAULT 0, paid_date TEXT, method TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS emails(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT, to_addr TEXT, subject TEXT, body TEXT, status TEXT, error TEXT, dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, brand TEXT, name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS stock_receipts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL, date TEXT NOT NULL, supplier TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id),
  description TEXT NOT NULL, qty REAL NOT NULL, expected_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS delivery_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL, date TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`);

const STAGES = ['lead', 'quoted', 'won', 'installation', 'completed', 'lost'];
const SCHEDULE_DEFAULT = [
  { label: 'Advance (booking)', pct: 50, offsetDays: 0 },
  { label: 'Before delivery', pct: 40, offsetDays: 14 },
  { label: 'After installation', pct: 10, offsetDays: 30 },
];

// ---- helpers ----
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (sql, ...p) => db.prepare(sql).all(...p);
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const clean = v => (v === undefined || v === '' ? null : v);

function payStatus(p) {
  if (p.paid_amount >= p.amount - 0.005) return 'paid';
  if (p.due_date && p.due_date < today()) return 'overdue';
  return p.paid_amount > 0 ? 'partial' : 'pending';
}
const decoratePayment = p => ({ ...p, balance: Math.max(0, p.amount - p.paid_amount), status: payStatus(p) });

function calcQuote(items, discount, gstRate) {
  const subtotal = items.reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0);
  const taxable = Math.max(0, subtotal - (+discount || 0));
  const gst = +(taxable * (gstRate / 100)).toFixed(2);
  return { subtotal, gst, total: +(taxable + gst).toFixed(2) };
}


// ---- starter catalog (names only; set your own prices in the Catalog tab) ----
const SEED = [
  ['Speakers', 'Focal', 'Kanta No.2'], ['Speakers', 'Focal', 'Aria 906'], ['Speakers', 'Focal', 'Chora 806'],
  ['Speakers', 'KEF', 'LS50 Meta'], ['Speakers', 'KEF', 'R3 Meta'], ['Speakers', 'KEF', 'Q Series Q350'],
  ['Speakers', 'Bowers & Wilkins', '606 S3'], ['Speakers', 'Bowers & Wilkins', '705 S3'], ['Speakers', 'Bowers & Wilkins', '603 S3'],
  ['Speakers', 'Polk Audio', 'Signature Elite ES20'], ['Speakers', 'Klipsch', 'RP-600M II'], ['Speakers', 'Klipsch', 'Reference Premiere RP-8000F II'],
  ['Speakers', 'Wharfedale', 'Diamond 12.1'], ['Speakers', 'Monitor Audio', 'Silver 100 7G'], ['Speakers', 'Dynaudio', 'Emit 20'],
  ['Subwoofers', 'SVS', 'SB-1000 Pro'], ['Subwoofers', 'REL', 'T/7x'], ['Subwoofers', 'Klipsch', 'R-120SW'],
  ['Turntables', 'Pro-Ject', 'Debut Carbon EVO'], ['Turntables', 'Rega', 'Planar 3'], ['Turntables', 'Technics', 'SL-1200GR'],
  ['Turntables', 'Audio-Technica', 'AT-LP120X'], ['Turntables', 'Thorens', 'TD 202'], ['Turntables', 'Fluance', 'RT81'],
  ['Cartridges & Phono', 'Ortofon', '2M Red'], ['Cartridges & Phono', 'Audio-Technica', 'AT-VM95E'], ['Cartridges & Phono', 'Pro-Ject', 'Phono Box S3 B'],
  ['Amplifiers', 'Cambridge Audio', 'CXA81'], ['Amplifiers', 'NAD', 'C 316BEE V2'], ['Amplifiers', 'Yamaha', 'A-S801'],
  ['Amplifiers', 'Rotel', 'A12 MKII'], ['Amplifiers', 'Denon', 'PMA-900HNE'], ['Amplifiers', 'Marantz', 'Model 40n'],
  ['AV Receivers', 'Denon', 'AVR-X3800H'], ['AV Receivers', 'Denon', 'AVR-X6800H'], ['AV Receivers', 'Marantz', 'Cinema 60'],
  ['AV Receivers', 'Yamaha', 'RX-A4A'], ['AV Receivers', 'Sony', 'STR-AZ5000ES'],
  ['Streamers & DACs', 'WiiM', 'Pro Plus'], ['Streamers & DACs', 'Bluesound', 'Node'], ['Streamers & DACs', 'Cambridge Audio', 'MXN10'],
  ['Streamers & DACs', 'Chord', 'Mojo 2'], ['Streamers & DACs', 'Topping', 'D90SE'],
  ['Headphones', 'Sennheiser', 'HD 600'], ['Headphones', 'Sennheiser', 'HD 800 S'], ['Headphones', 'Focal', 'Bathys'], ['Headphones', 'Audio-Technica', 'ATH-M50x'],
  ['Projectors & Screens', 'Sony', 'VPL-XW5000ES'], ['Projectors & Screens', 'Epson', 'EH-LS12000B'], ['Projectors & Screens', 'Epson', 'EH-TW7000'],
  ['Cables & Accessories', 'AudioQuest', 'Speaker cable (per metre)'], ['Cables & Accessories', 'AudioQuest', 'HDMI 2.1 cable'],
  ['Cables & Accessories', 'AudioQuest', 'Interconnect RCA (pair)'], ['Cables & Accessories', '', 'Speaker stands (pair)'],
  ['Cables & Accessories', '', 'Power conditioner'], ['Cables & Accessories', '', 'Equipment rack'],
  ['Services', '', 'Installation & calibration'], ['Services', '', 'Home theatre room setup'], ['Services', '', 'Acoustic treatment'],
  ['Services', '', 'Wall / ceiling speaker mounting'], ['Services', '', 'Cabling & conduit work'], ['Services', '', 'Annual service contract'],
  ['Installation', '', '2-channel stereo system installation'], ['Installation', '', 'Home theatre installation (5.1 / 7.1)'],
  ['Installation', '', 'Dolby Atmos installation (per ceiling speaker)'], ['Installation', '', 'In-wall / in-ceiling speaker installation (per pair)'],
  ['Installation', '', 'Multi-room audio installation (per zone)'], ['Installation', '', 'Projector & screen installation'],
  ['Installation', '', 'TV wall mounting'], ['Installation', '', 'Soundbar installation'], ['Installation', '', 'Outdoor / garden audio installation'],
  ['Installation', '', 'Turntable setup & cartridge alignment'], ['Installation', '', 'Equipment rack setup & cable management'],
  ['Installation', '', 'Room calibration (Dirac / Audyssey / YPAO)'], ['Installation', '', 'System design & consultation'],
  ['Installation', '', 'Site survey / pre-wiring visit'], ['Installation', '', 'Transport & delivery'],
  ['Servicing', '', 'Annual maintenance contract (AMC)'], ['Servicing', '', 'System health check & tuning'],
  ['Servicing', '', 'Amplifier / receiver service'], ['Servicing', '', 'Amplifier / receiver repair'],
  ['Servicing', '', 'Speaker repair / reconditioning'], ['Servicing', '', 'Turntable service & belt replacement'],
  ['Servicing', '', 'Stylus / cartridge replacement'], ['Servicing', '', 'Projector service & lamp replacement'],
  ['Servicing', '', 'Firmware & software update'], ['Servicing', '', 'Site visit / call-out charge'], ['Servicing', '', 'Remote support session'],
  ['Servicing', '', 'Extended warranty'],
];
// add any starter items that are missing; runs once per SEED_VERSION so items you delete stay deleted
const SEED_VERSION = '2';
if (q1("SELECT v FROM meta WHERE k='seed_v'")?.v !== SEED_VERSION) {
  const has = db.prepare("SELECT id FROM products WHERE lower(COALESCE(brand,''))=lower(?) AND lower(name)=lower(?)");
  const ins = db.prepare('INSERT INTO products(category,brand,name) VALUES(?,?,?)');
  db.exec('BEGIN');
  for (const [c, b, n] of SEED) if (!has.get(b || '', n)) ins.run(c, b || null, n);
  db.prepare("INSERT INTO meta(k,v) VALUES('seed_v',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(SEED_VERSION);
  db.exec('COMMIT');
}


// ---- stock & deliveries ----
const SERVICE_CATS = ['Installation', 'Servicing', 'Services'];
const SVC_SQL = SERVICE_CATS.map(() => '?').join(',');
function resolveProduct(desc) {
  const d = String(desc || '').trim();
  const hit = q1("SELECT id, category FROM products WHERE lower(trim(COALESCE(brand,'')||' '||name)) = lower(?)", d);
  if (hit) return hit;
  const r = run("INSERT INTO products(category,brand,name) VALUES('Custom',NULL,?)", d);
  return { id: Number(r.lastInsertRowid), category: 'Custom' };
}
// an accepted quote becomes an order: one row per goods line (services are not stocked)
function createOrderItems(quote) {
  if (q1('SELECT id FROM order_items WHERE quote_id=?', quote.id)) return;
  const expected = addDays(today(), 14);
  for (const i of JSON.parse(quote.items)) {
    if (!i.desc?.trim() || !(+i.qty > 0)) continue;
    const p = resolveProduct(i.desc);
    if (SERVICE_CATS.includes(p.category)) continue;
    run('INSERT INTO order_items(client_id,quote_id,product_id,description,qty,expected_date) VALUES(?,?,?,?,?,?)', quote.client_id, quote.id, p.id, i.desc.trim(), +i.qty, expected);
  }
}
const ORDER_SQL = `SELECT oi.*, c.name client_name, c.stage client_stage, p.category,
  COALESCE((SELECT SUM(qty) FROM delivery_log WHERE order_item_id=oi.id),0) delivered,
  (SELECT MAX(date) FROM delivery_log WHERE order_item_id=oi.id) last_delivered
  FROM order_items oi JOIN clients c ON c.id=oi.client_id JOIN products p ON p.id=oi.product_id`;
function decorateOrder(o) {
  const pending = Math.max(0, +(o.qty - o.delivered).toFixed(3));
  const status = pending === 0 ? 'delivered' : o.expected_date && o.expected_date < today() ? 'overdue' : o.delivered > 0 ? 'partial' : 'pending';
  return { ...o, pending, status };
}
function onHand(productId) {
  const rec = q1('SELECT COALESCE(SUM(qty),0) v FROM stock_receipts WHERE product_id=?', productId).v;
  const out = q1('SELECT COALESCE(SUM(dl.qty),0) v FROM delivery_log dl JOIN order_items oi ON oi.id=dl.order_item_id WHERE oi.product_id=?', productId).v;
  return +(rec - out).toFixed(3);
}
// the Consultation and Negotiation stages were removed: fold existing clients into the nearest stage
run("UPDATE clients SET stage='lead' WHERE stage='consultation'");
run("UPDATE clients SET stage='quoted' WHERE stage='negotiation'");
// one-time: turn quotes accepted before stock tracking existed into orders
if (!q1("SELECT v FROM meta WHERE k='orders_v1'")) {
  for (const qt of q("SELECT * FROM quotes WHERE status='accepted'")) createOrderItems(qt);
  run("INSERT INTO meta(k,v) VALUES('orders_v1','1')");
}

// ---- email ----

function wrap(inner) {
  return `<div style="font-family:Georgia,serif;max-width:620px;margin:auto;color:#1a1a1a">
  <div style="border-bottom:2px solid #b8893a;padding:12px 0;font-size:22px;letter-spacing:2px">${esc(CFG.company.toUpperCase())}</div>
  <div style="padding:18px 0;font-size:15px;line-height:1.6">${inner}</div>
  <div style="border-top:1px solid #ddd;padding-top:10px;font-size:12px;color:#777">${esc(CFG.company)}, ${esc(CFG.city)}${CFG.phone ? ' · ' + esc(CFG.phone) : ''}</div></div>`;
}

async function sendMail({ clientId, kind, to, subject, html, dedupeKey }) {
  if (dedupeKey && q1('SELECT id FROM emails WHERE dedupe_key=?', dedupeKey)) return { skipped: true };
  if (!to) {
    run('INSERT INTO emails(client_id,kind,to_addr,subject,body,status,error,dedupe_key) VALUES(?,?,?,?,?,?,?,?)',
      clientId, kind, null, subject, html, 'failed', 'Client has no email address', dedupeKey || null);
    return { status: 'failed' };
  }
  let status = 'dry-run', error = null;
  if (transport) {
    try { await transport.sendMail({ from: CFG.from, to, subject, html }); status = 'sent'; }
    catch (e) { status = 'failed'; error = e.message; }
  }
  run('INSERT INTO emails(client_id,kind,to_addr,subject,body,status,error,dedupe_key) VALUES(?,?,?,?,?,?,?,?)',
    clientId, kind, to, subject, html, status, error, status === 'failed' ? null : dedupeKey || null);
  return { status, error };
}

function quoteHtml(c, qt) {
  const items = JSON.parse(qt.items);
  const rows = items.map(i => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(i.desc)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:center">${+i.qty}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${inr(i.price)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${inr(i.qty * i.price)}</td></tr>`).join('');
  const tot = (l, v, b) => `<tr><td colspan="3" style="padding:4px 6px;text-align:right">${l}</td><td style="padding:4px 6px;text-align:right;${b ? 'font-weight:bold;font-size:16px' : ''}">${v}</td></tr>`;
  return wrap(`<p>Dear ${esc(c.name)},</p>
  <p>Thank you for your interest in ${esc(CFG.company)}. Please find your quotation <b>${esc(qt.number)}</b> below.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="background:#f5efe4"><th style="padding:6px;text-align:left">Item</th><th>Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>${rows}
  ${tot('Subtotal', inr(qt.subtotal))}${qt.discount ? tot('Discount', '− ' + inr(qt.discount)) : ''}${tot(`GST @ ${qt.gst_rate}%`, inr(qt.gst))}${tot('Total', inr(qt.total), true)}</table>
  ${qt.valid_until ? `<p>This quotation is valid until <b>${esc(qt.valid_until)}</b>.</p>` : ''}
  ${qt.note ? `<p>${esc(qt.note)}</p>` : ''}
  <p>Reply to this email or call us to confirm the order and we will share the payment schedule.</p>`);
}

function reminderHtml(c, p, kind, daysLate) {
  const lead = {
    upcoming: `This is a friendly reminder that a payment is due in <b>3 days</b>.`,
    today: `A payment is due <b>today</b>.`,
    overdue: `A payment was due ${daysLate} day(s) ago and is still outstanding. Kindly arrange it at your earliest convenience.`,
  }[kind];
  return wrap(`<p>Dear ${esc(c.name)},</p><p>${lead}</p>
  <table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0">For</td><td><b>${esc(p.label)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0">Balance due</td><td><b>${inr(p.amount - p.paid_amount)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0">Due date</td><td>${esc(p.due_date)}</td></tr></table>
  ${CFG.payDetails ? `<p style="background:#f5efe4;padding:10px;font-size:13px">${esc(CFG.payDetails)}</p>` : ''}
  <p>If you have already paid, please ignore this note and share the transfer reference so we can update our records.</p>`);
}

function reviewHtml(c) {
  return wrap(`<p>Dear ${esc(c.name)},</p>
  <p>Thank you for choosing ${esc(CFG.company)}. We hope you are enjoying your new system and every record sounds the way it should.</p>
  <p>If you have a minute, a quick Google review would mean a lot to a small team like ours. It also helps other music lovers in ${esc(CFG.city)} find us.</p>
  <p style="margin:24px 0"><a href="${esc(CFG.reviewUrl)}" style="background:#16181d;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-family:sans-serif">Leave a Google review</a></p>
  <p>If anything is not quite right, just reply to this email and we will come and fix it.</p>`);
}
async function sendReview(c, dedupeKey) {
  return sendMail({ clientId: c.id, kind: 'review-request', to: c.email, subject: `${CFG.company}: how did we do?`, html: reviewHtml(c), dedupeKey });
}

// ---- automation ----
async function runAutomation() {
  const out = { reminders: 0, followups: 0, reviews: 0, skipped: 0, failed: 0 };
  const count = r => { if (r.skipped) out.skipped++; else if (r.status === 'failed') out.failed++; };
  const t = today();

  for (const p of q('SELECT * FROM payments WHERE due_date IS NOT NULL AND paid_amount < amount - 0.005')) {
    const days = daysBetween(t, p.due_date);
    let kind = null, key = null;
    if (days === 3) { kind = 'upcoming'; key = `pay${p.id}:upcoming`; }
    else if (days === 0) { kind = 'today'; key = `pay${p.id}:today`; }
    else if (days < 0 && -days % 3 === 0 && -days <= 60) { kind = 'overdue'; key = `pay${p.id}:overdue:${-days}`; }
    if (!kind) continue;
    const c = q1('SELECT * FROM clients WHERE id=?', p.client_id);
    const subj = { upcoming: `Payment reminder: ${p.label} due ${p.due_date}`, today: `Payment due today: ${p.label}`, overdue: `Overdue payment: ${p.label}` }[kind];
    const r = await sendMail({ clientId: c.id, kind: 'reminder-' + kind, to: c.email, subject: `${CFG.company}: ${subj}`, html: reminderHtml(c, p, kind, -days), dedupeKey: key });
    count(r); if (!r.skipped) out.reminders++;
  }

  for (const qt of q("SELECT * FROM quotes WHERE status='sent' AND sent_at IS NOT NULL")) {
    const age = daysBetween(qt.sent_at.slice(0, 10), t);
    const step = age >= 7 ? 7 : age >= 3 ? 3 : 0;
    if (!step) continue;
    const c = q1('SELECT * FROM clients WHERE id=?', qt.client_id);
    const html = wrap(`<p>Dear ${esc(c.name)},</p><p>Just following up on quotation <b>${esc(qt.number)}</b> (${inr(qt.total)}) we sent ${age} days ago. Happy to arrange a demo, tweak the system or answer questions. Reply here or call us whenever convenient.</p>`);
    const r = await sendMail({ clientId: c.id, kind: 'quote-followup', to: c.email, subject: `${CFG.company}: following up on quotation ${qt.number}`, html, dedupeKey: `quote${qt.id}:followup${step}` });
    count(r); if (!r.skipped) out.followups++;
  }
  // review requests: completed clients, N days after completion, only recent completions
  if (CFG.reviewUrl) {
    for (const c of q("SELECT * FROM clients WHERE stage='completed'")) {
      const age = daysBetween(c.stage_changed_at.slice(0, 10), t);
      if (age < CFG.reviewDelay || age > 30) continue;
      const r = await sendReview(c, `client${c.id}:review`);
      count(r); if (!r.skipped) out.reviews++;
    }
  }
  run("INSERT INTO meta(k,v) VALUES('last_run',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", new Date().toISOString());
  return out;
}

function schedulerTick() {
  const last = q1("SELECT v FROM meta WHERE k='last_run'")?.v?.slice(0, 10);
  if (new Date().getHours() >= CFG.hour && last !== today()) runAutomation().then(r => console.log('Automation ran', r)).catch(console.error);
}
const wrapA = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });
const need = (res, row, what = 'Not found') => row || (res.status(404).json({ error: what }), null);

app.get('/api/config', (_, res) => res.json({ ...CFG, stages: STAGES, schedule: SCHEDULE_DEFAULT, lastRun: q1("SELECT v FROM meta WHERE k='last_run'")?.v || null }));

app.get('/api/dashboard', (_, res) => {
  const pays = q('SELECT p.*, c.name client_name FROM payments p JOIN clients c ON c.id=p.client_id').map(decoratePayment);
  const open = pays.filter(p => p.status !== 'paid');
  const m = today().slice(0, 7);
  res.json({
    outstanding: open.reduce((s, p) => s + p.balance, 0),
    overdue: pays.filter(p => p.status === 'overdue').reduce((s, p) => s + p.balance, 0),
    overdueCount: pays.filter(p => p.status === 'overdue').length,
    collectedMonth: pays.filter(p => p.paid_date?.startsWith(m)).reduce((s, p) => s + p.paid_amount, 0),
    pipelineValue: q("SELECT COALESCE(SUM(total),0) v FROM quotes WHERE status='sent'")[0].v,
    deliveries: (() => {
      const open = q(ORDER_SQL).map(decorateOrder).filter(o => o.pending > 0);
      return { units: open.reduce((s, o) => s + o.pending, 0), lines: open.length, overdue: open.filter(o => o.status === 'overdue').length,
        upcoming: open.sort((a, b) => (a.expected_date || '9999').localeCompare(b.expected_date || '9999')).slice(0, 6) };
    })(),
    stageCounts: Object.fromEntries(q('SELECT stage, COUNT(*) n FROM clients GROUP BY stage').map(r => [r.stage, r.n])),
    upcoming: open.filter(p => p.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8),
    pendingQuotes: q("SELECT q.*, c.name client_name FROM quotes q JOIN clients c ON c.id=q.client_id WHERE q.status IN ('draft','sent') ORDER BY q.created_at DESC LIMIT 8"),
  });
});

app.get('/api/clients', (_, res) => {
  const rows = q('SELECT * FROM clients ORDER BY stage_changed_at DESC');
  const pays = q('SELECT * FROM payments').map(decoratePayment);
  res.json(rows.map(c => {
    const mine = pays.filter(p => p.client_id === c.id);
    return { ...c, billed: mine.reduce((s, p) => s + p.amount, 0), paid: mine.reduce((s, p) => s + p.paid_amount, 0), overdue: mine.some(p => p.status === 'overdue') };
  }));
});
app.post('/api/clients', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const r = run('INSERT INTO clients(name,phone,email,address,source,interest,stage,notes) VALUES(?,?,?,?,?,?,?,?)',
    b.name.trim(), clean(b.phone), clean(b.email), clean(b.address), clean(b.source), clean(b.interest), STAGES.includes(b.stage) ? b.stage : 'lead', clean(b.notes));
  res.json({ id: Number(r.lastInsertRowid) });
});
app.get('/api/clients/:id', (req, res) => {
  const c = need(res, q1('SELECT * FROM clients WHERE id=?', req.params.id)); if (!c) return;
  res.json({
    ...c,
    quotes: q('SELECT * FROM quotes WHERE client_id=? ORDER BY id DESC', c.id).map(x => ({ ...x, items: JSON.parse(x.items) })),
    payments: q('SELECT * FROM payments WHERE client_id=? ORDER BY due_date', c.id).map(decoratePayment),
    orderItems: q(ORDER_SQL + ' WHERE oi.client_id=? ORDER BY oi.id', c.id).map(decorateOrder),
    emails: q('SELECT id,kind,to_addr,subject,status,error,created_at FROM emails WHERE client_id=? ORDER BY id DESC', c.id),
  });
});
app.put('/api/clients/:id', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name is required' });
  run('UPDATE clients SET name=?,phone=?,email=?,address=?,source=?,interest=?,notes=? WHERE id=?',
    b.name.trim(), clean(b.phone), clean(b.email), clean(b.address), clean(b.source), clean(b.interest), clean(b.notes), req.params.id);
  res.json({ ok: true });
});
app.put('/api/clients/:id/stage', (req, res) => {
  if (!STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Bad stage' });
  run("UPDATE clients SET stage=?, stage_changed_at=datetime('now') WHERE id=?", req.body.stage, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/clients/:id', (req, res) => { run('DELETE FROM clients WHERE id=?', req.params.id); res.json({ ok: true }); });

// products (catalog)
app.get('/api/products', (_, res) => res.json(q('SELECT * FROM products ORDER BY category, brand, name')));
app.post('/api/products', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Item name is required' });
  const r = run('INSERT INTO products(category,brand,name,price) VALUES(?,?,?,?)', b.category?.trim() || 'Other', clean(b.brand?.trim()), b.name.trim(), +b.price || 0);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/products/:id', (req, res) => {
  const b = req.body, p = need(res, q1('SELECT * FROM products WHERE id=?', req.params.id)); if (!p) return;
  run('UPDATE products SET category=?,brand=?,name=?,price=? WHERE id=?', b.category?.trim() || p.category, b.brand !== undefined ? clean(b.brand?.trim()) : p.brand, b.name?.trim() || p.name, b.price !== undefined ? +b.price || 0 : p.price, p.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', (req, res) => {
  const used = q1('SELECT (SELECT COUNT(*) FROM order_items WHERE product_id=?) + (SELECT COUNT(*) FROM stock_receipts WHERE product_id=?) n', req.params.id, req.params.id).n;
  if (used) return res.status(400).json({ error: 'This item has orders or stock history, so it cannot be removed from the catalog' });
  run('DELETE FROM products WHERE id=?', req.params.id); res.json({ ok: true });
});
// after a quote is saved: remember prices for known items, add unknown (custom) items to the catalog
app.post('/api/products/learn', (req, res) => {
  let added = 0, updated = 0;
  for (const i of req.body.items || []) {
    const d = String(i.desc || '').trim(); if (!d) continue;
    const price = +i.price || 0;
    const hit = q1("SELECT id FROM products WHERE lower(trim(COALESCE(brand,'')||' '||name)) = lower(?)", d);
    if (hit) { if (price > 0) { run('UPDATE products SET price=? WHERE id=?', price, hit.id); updated++; } }
    else { run("INSERT INTO products(category,brand,name,price) VALUES('Custom',NULL,?,?)", d, price); added++; }
  }
  res.json({ added, updated });
});

// quotes
app.post('/api/clients/:id/quotes', (req, res) => {
  const c = need(res, q1('SELECT * FROM clients WHERE id=?', req.params.id)); if (!c) return;
  const items = (req.body.items || []).filter(i => i.desc?.trim() && +i.qty > 0);
  if (!items.length) return res.status(400).json({ error: 'Add at least one line item' });
  const gstRate = req.body.gst_rate ?? CFG.gst, discount = +req.body.discount || 0;
  const t = calcQuote(items, discount, gstRate);
  const n = q1('SELECT COUNT(*) n FROM quotes').n + 1;
  const r = run('INSERT INTO quotes(client_id,number,items,discount,gst_rate,subtotal,gst,total,valid_until,note) VALUES(?,?,?,?,?,?,?,?,?,?)',
    c.id, `AC-Q-${String(n).padStart(4, '0')}`, JSON.stringify(items), discount, gstRate, t.subtotal, t.gst, t.total, clean(req.body.valid_until) || addDays(today(), 14), clean(req.body.note));
  res.json({ id: Number(r.lastInsertRowid) });
});
app.post('/api/quotes/:id/send', wrapA(async (req, res) => {
  const qt = need(res, q1('SELECT * FROM quotes WHERE id=?', req.params.id)); if (!qt) return;
  const c = q1('SELECT * FROM clients WHERE id=?', qt.client_id);
  const r = await sendMail({ clientId: c.id, kind: 'quotation', to: c.email, subject: `${CFG.company}: Quotation ${qt.number}`, html: quoteHtml(c, qt) });
  if (r.status === 'failed') return res.status(400).json({ error: r.error || 'Could not send' });
  run("UPDATE quotes SET status='sent', sent_at=datetime('now') WHERE id=? AND status IN ('draft','sent')", qt.id);
  if (c.stage === 'lead') run("UPDATE clients SET stage='quoted', stage_changed_at=datetime('now') WHERE id=?", c.id);
  res.json({ status: r.status });
}));
app.post('/api/quotes/:id/reject', (req, res) => { run("UPDATE quotes SET status='rejected' WHERE id=?", req.params.id); res.json({ ok: true }); });
app.post('/api/quotes/:id/accept', (req, res) => {
  const qt = need(res, q1('SELECT * FROM quotes WHERE id=?', req.params.id)); if (!qt) return;
  if (qt.status === 'accepted') return res.status(400).json({ error: 'Already accepted' });
  const sched = (req.body.schedule?.length ? req.body.schedule : SCHEDULE_DEFAULT);
  const pct = sched.reduce((s, x) => s + +x.pct, 0);
  if (Math.abs(pct - 100) > 0.01) return res.status(400).json({ error: `Schedule must total 100% (now ${pct}%)` });
  const base = today();
  let allocated = 0;
  sched.forEach((s, i) => {
    const amt = i === sched.length - 1 ? +(qt.total - allocated).toFixed(2) : +(qt.total * s.pct / 100).toFixed(2);
    allocated += amt;
    run('INSERT INTO payments(client_id,quote_id,label,amount,due_date) VALUES(?,?,?,?,?)', qt.client_id, qt.id, s.label, amt, s.due_date || addDays(base, +s.offsetDays || 0));
  });
  run("UPDATE quotes SET status='accepted' WHERE id=?", qt.id);
  createOrderItems(qt);
  run("UPDATE quotes SET status='rejected' WHERE client_id=? AND id<>? AND status IN ('draft','sent')", qt.client_id, qt.id);
  run("UPDATE clients SET stage='won', stage_changed_at=datetime('now') WHERE id=?", qt.client_id);
  res.json({ ok: true });
});

// payments
app.get('/api/payments', (_, res) => res.json(q('SELECT p.*, c.name client_name, c.email client_email FROM payments p JOIN clients c ON c.id=p.client_id ORDER BY (p.paid_amount>=p.amount), p.due_date').map(decoratePayment)));
app.post('/api/payments', (req, res) => {
  const b = req.body;
  if (!b.client_id || !b.label?.trim() || !(+b.amount > 0)) return res.status(400).json({ error: 'Client, label and amount are required' });
  const r = run('INSERT INTO payments(client_id,label,amount,due_date) VALUES(?,?,?,?)', b.client_id, b.label.trim(), +b.amount, clean(b.due_date));
  res.json({ id: Number(r.lastInsertRowid) });
});
app.post('/api/payments/:id/pay', (req, res) => {
  const p = need(res, q1('SELECT * FROM payments WHERE id=?', req.params.id)); if (!p) return;
  const amt = req.body.amount !== undefined && req.body.amount !== '' ? +req.body.amount : p.amount - p.paid_amount;
  if (!(amt > 0)) return res.status(400).json({ error: 'Enter an amount above 0' });
  const paid = Math.min(p.amount, +(p.paid_amount + amt).toFixed(2));
  run('UPDATE payments SET paid_amount=?, paid_date=?, method=? WHERE id=?', paid, clean(req.body.date) || today(), clean(req.body.method), p.id);
  // everything paid and project already delivered -> auto-complete
  const c = q1('SELECT * FROM clients WHERE id=?', p.client_id);
  const left = q1('SELECT COUNT(*) n FROM payments WHERE client_id=? AND paid_amount < amount - 0.005', p.client_id).n;
  if (!left && c.stage === 'installation') run("UPDATE clients SET stage='completed', stage_changed_at=datetime('now') WHERE id=?", c.id);
  res.json({ ok: true });
});
app.post('/api/payments/:id/undo', (req, res) => { run('UPDATE payments SET paid_amount=0, paid_date=NULL, method=NULL WHERE id=?', req.params.id); res.json({ ok: true }); });
app.delete('/api/payments/:id', (req, res) => { run('DELETE FROM payments WHERE id=?', req.params.id); res.json({ ok: true }); });
app.post('/api/payments/:id/remind', wrapA(async (req, res) => {
  const p = need(res, q1('SELECT * FROM payments WHERE id=?', req.params.id)); if (!p) return;
  const c = q1('SELECT * FROM clients WHERE id=?', p.client_id);
  const late = p.due_date ? Math.max(0, daysBetween(p.due_date, today())) : 0;
  const kind = late > 0 ? 'overdue' : p.due_date === today() ? 'today' : 'upcoming';
  const r = await sendMail({ clientId: c.id, kind: 'reminder-manual', to: c.email, subject: `${CFG.company}: Payment reminder: ${p.label}`, html: reminderHtml(c, p, kind, late) });
  if (r.status === 'failed') return res.status(400).json({ error: r.error || 'Could not send' });
  res.json({ status: r.status });
}));

// stock statement
app.get('/api/stock', (_, res) => {
  const rows = q(`SELECT p.id, p.brand, p.name, p.category,
    COALESCE((SELECT SUM(qty) FROM stock_receipts WHERE product_id=p.id),0) received,
    COALESCE((SELECT SUM(dl.qty) FROM delivery_log dl JOIN order_items oi ON oi.id=dl.order_item_id WHERE oi.product_id=p.id),0) delivered,
    COALESCE((SELECT SUM(qty) FROM order_items WHERE product_id=p.id),0) ordered
    FROM products p WHERE p.category NOT IN (${SVC_SQL}) ORDER BY p.category, p.brand, p.name`, ...SERVICE_CATS);
  res.json(rows.map(r => { const oh = +(r.received - r.delivered).toFixed(3), td = +(r.ordered - r.delivered).toFixed(3); return { ...r, onHand: oh, toDeliver: td, free: +(oh - td).toFixed(3) }; }));
});
app.get('/api/stock/history', (_, res) => res.json(q(`SELECT * FROM (
  SELECT 'in' AS type, sr.id AS id, sr.date, p.brand, p.name, sr.qty, sr.supplier party, sr.note FROM stock_receipts sr JOIN products p ON p.id=sr.product_id
  UNION ALL
  SELECT 'out', dl.id, dl.date, p.brand, p.name, dl.qty, c.name, dl.note FROM delivery_log dl JOIN order_items oi ON oi.id=dl.order_item_id JOIN products p ON p.id=oi.product_id JOIN clients c ON c.id=oi.client_id
  ) ORDER BY date DESC, id DESC LIMIT 150`)));
app.post('/api/stock/receipts', (req, res) => {
  const b = req.body;
  if (!b.desc?.trim()) return res.status(400).json({ error: 'Choose or type an item' });
  if (!(+b.qty > 0)) return res.status(400).json({ error: 'Quantity must be above 0' });
  const p = resolveProduct(b.desc);
  if (SERVICE_CATS.includes(p.category)) return res.status(400).json({ error: 'Services are not stocked items' });
  run('INSERT INTO stock_receipts(product_id,qty,date,supplier,note) VALUES(?,?,?,?,?)', p.id, +b.qty, clean(b.date) || today(), clean(b.supplier), clean(b.note));
  res.json({ ok: true });
});
app.delete('/api/stock/receipts/:id', (req, res) => { run('DELETE FROM stock_receipts WHERE id=?', req.params.id); res.json({ ok: true }); });

// deliveries (order items)
app.get('/api/deliveries', (_, res) => res.json(q(ORDER_SQL + ' ORDER BY oi.expected_date IS NULL, oi.expected_date, oi.id').map(decorateOrder)));
app.put('/api/deliveries/:id', (req, res) => { run('UPDATE order_items SET expected_date=? WHERE id=?', clean(req.body.expected_date), req.params.id); res.json({ ok: true }); });
app.delete('/api/deliveries/log/:id', (req, res) => { run('DELETE FROM delivery_log WHERE id=?', req.params.id); res.json({ ok: true }); });
app.delete('/api/deliveries/:id', (req, res) => { run('DELETE FROM order_items WHERE id=?', req.params.id); res.json({ ok: true }); });
app.post('/api/deliveries/:id/deliver', (req, res) => {
  const o = need(res, q1(ORDER_SQL + ' WHERE oi.id=?', req.params.id)); if (!o) return;
  const d = decorateOrder(o);
  const qty = req.body.qty !== undefined && req.body.qty !== '' ? +req.body.qty : d.pending;
  if (!(qty > 0)) return res.status(400).json({ error: 'Enter a quantity above 0' });
  if (qty > d.pending + 1e-9) return res.status(400).json({ error: `Only ${d.pending} left to deliver on this line` });
  run('INSERT INTO delivery_log(order_item_id,qty,date,note) VALUES(?,?,?,?)', o.id, qty, clean(req.body.date) || today(), clean(req.body.note));
  // everything for this client delivered -> move Won clients on to Installation
  const left = q(ORDER_SQL + ' WHERE oi.client_id=?', o.client_id).map(decorateOrder).filter(x => x.pending > 0).length;
  let moved = false;
  if (!left && o.client_stage === 'won') { run("UPDATE clients SET stage='installation', stage_changed_at=datetime('now') WHERE id=?", o.client_id); moved = true; }
  res.json({ ok: true, onHand: onHand(o.product_id), movedToInstallation: moved });
});


// ---- import from Tally ----
const findClientByName = name => q1('SELECT * FROM clients WHERE lower(trim(name))=lower(trim(?))', name);
function upsertTallyPayment(clientId, label, amount, due, write) {
  const ex = clientId ? q1('SELECT * FROM payments WHERE client_id=? AND label=?', clientId, label) : null;
  if (!ex) { if (write) run('INSERT INTO payments(client_id,label,amount,due_date) VALUES(?,?,?,?)', clientId, label, amount, clean(due)); return 'create'; }
  if (ex.paid_amount < ex.amount - 0.005 && Math.abs(ex.amount - amount) > 0.005) {
    if (write) run('UPDATE payments SET amount=?, due_date=COALESCE(?, due_date) WHERE id=?', Math.max(amount, ex.paid_amount), clean(due), ex.id);
    return 'update';
  }
  return 'exists';
}
function applyTallyPart(part, opts, write) {
  const stage = STAGES.includes(opts.stage) ? opts.stage : 'completed';
  const rows = [], counts = { create: 0, update: 0, exists: 0, skip: 0 };
  const add = (action, name, detail) => { counts[action]++; if (rows.length < 400) rows.push({ action, name, detail }); };

  if (part.kind === 'customers') {
    for (const r of part.records) {
      const ex = findClientByName(r.name);
      let id = ex?.id, action, detail = [];
      if (!ex) {
        action = 'create';
        if (write) id = Number(run('INSERT INTO clients(name,phone,email,address,source,stage,notes) VALUES(?,?,?,?,?,?,?)', r.name, clean(r.phone), clean(r.email), clean(r.address), 'Tally', stage, 'Imported from Tally' + (r.gstin ? ' · GSTIN ' + r.gstin : '')).lastInsertRowid);
      } else {
        const fill = ['phone', 'email', 'address'].filter(k => !ex[k] && r[k]);
        action = fill.length ? 'update' : 'exists';
        if (fill.length) { detail.push('fills ' + fill.join(', ')); if (write) run(`UPDATE clients SET ${fill.map(k => k + '=?').join(',')} WHERE id=?`, ...fill.map(k => r[k]), ex.id); }
      }
      if (r.balance > 0.005) {
        detail.push('owes ' + inr(r.balance));
        if (opts.createBalance) { const pa = upsertTallyPayment(id, 'Outstanding balance (Tally)', r.balance, null, write); detail.push(pa === 'exists' ? 'payment already recorded' : `payment ${pa === 'create' ? 'added' : 'updated'}`); }
      } else if (r.balance < -0.005) detail.push('advance ' + inr(-r.balance) + ' (not imported)');
      add(action, r.name, detail.join(' · '));
    }
  } else if (part.kind === 'bills') {
    for (const b of part.records) {
      let c = findClientByName(b.party), detail = [inr(b.amount) + (b.due ? ' due ' + b.due : '')], created = false;
      if (!c) {
        if (opts.createMissing === false) { add('skip', b.party, 'client not found in this system'); continue; }
        created = true;
        if (write) { const id = Number(run('INSERT INTO clients(name,source,stage,notes) VALUES(?,?,?,?)', b.party, 'Tally', stage, 'Imported from Tally').lastInsertRowid); c = { id }; }
      }
      const label = `Tally bill ${b.ref || b.date || 'outstanding'}`;
      const pa = upsertTallyPayment(c?.id, label, b.amount, b.due || b.date, write);
      if (created) detail.push('new client');
      add(pa, `${b.party} · ${b.ref || b.date || ''}`.trim(), detail.join(' · '));
    }
  } else if (part.kind === 'stock') {
    for (const r of part.records) {
      let p = q1("SELECT id, category, price FROM products WHERE lower(trim(COALESCE(brand,'')||' '||name)) = lower(?)", r.name), action, detail = [];
      if (p && SERVICE_CATS.includes(p.category)) { add('skip', r.name, 'is a service, not stock'); continue; }
      if (!p) {
        action = 'create'; detail.push('new catalog item');
        const price = opts.useRate && r.rate > 0 ? r.rate : 0;
        if (write) p = { id: Number(run('INSERT INTO products(category,brand,name,price) VALUES(?,?,?,?)', r.group || 'Tally import', null, r.name, price).lastInsertRowid), price };
      } else {
        action = 'exists';
        if (opts.useRate && r.rate > 0 && !p.price) { action = 'update'; detail.push('sets price ' + inr(r.rate)); if (write) run('UPDATE products SET price=? WHERE id=?', r.rate, p.id); }
      }
      if (opts.addStock !== false && r.qty > 0) {
        const have = p ? onHand(p.id) : 0, delta = +(r.qty - have).toFixed(3);
        if (delta > 0) {
          detail.push(`Tally ${r.qty}${r.unit ? ' ' + r.unit : ''}, here ${have} → add ${delta} to stock`);
          if (action === 'exists') action = 'update';
          if (write) run('INSERT INTO stock_receipts(product_id,qty,date,supplier,note) VALUES(?,?,?,?,?)', p.id, delta, today(), 'Tally import', `Reconciled to Tally quantity ${r.qty}`);
        } else detail.push(delta === 0 ? `stock already matches Tally (${r.qty})` : `system holds ${have}, more than Tally's ${r.qty}: left unchanged`);
      }
      add(action, r.name, detail.join(' · '));
    }
  }
  return { kind: part.kind, counts, total: part.records.length, rows };
}
app.post('/api/import/tally', (req, res) => {
  const b = req.body || {}, opts = b.options || {};
  if (!b.content || typeof b.content !== 'string') return res.status(400).json({ error: 'No file content received' });
  let parsed;
  try { parsed = parseTally(b.content, b.filename || '', b.kind || 'auto', opts); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const write = !b.dryRun;
  try {
    if (write) db.exec('BEGIN');
    const parts = parsed.parts.map(p => applyTallyPart(p, opts, write));
    if (write) db.exec('COMMIT');
    res.json({ format: parsed.format, warnings: parsed.warnings, parts, dryRun: !write });
  } catch (e) {
    if (write) { try { db.exec('ROLLBACK'); } catch {} }
    res.status(500).json({ error: 'Import failed and nothing was changed: ' + e.message });
  }
});

// emails + automation
app.get('/api/emails', (_, res) => res.json(q('SELECT e.id,e.kind,e.to_addr,e.subject,e.status,e.error,e.created_at,c.name client_name FROM emails e LEFT JOIN clients c ON c.id=e.client_id ORDER BY e.id DESC LIMIT 200')));
app.get('/api/emails/:id', (req, res) => res.json(q1('SELECT * FROM emails WHERE id=?', req.params.id) || {}));
app.post('/api/clients/:id/review', wrapA(async (req, res) => {
  const c = need(res, q1('SELECT * FROM clients WHERE id=?', req.params.id)); if (!c) return;
  if (!CFG.reviewUrl) return res.status(400).json({ error: 'Set GOOGLE_REVIEW_URL in .env and restart the server first' });
  const r = await sendReview(c);
  if (r.status === 'failed') return res.status(400).json({ error: r.error || 'Could not send' });
  res.json({ status: r.status });
}));
app.post('/api/automation/run', wrapA(async (_, res) => res.json(await runAutomation())));

return { runAutomation, schedulerTick };
}
