// Parsers for Tally (TallyPrime / Tally.ERP 9) exports. Pure functions: no Node or DOM dependencies,
// so they run in the Node server and in the browser build.
//
// Supported input
//   XML  : Masters export (LEDGER / GROUP / STOCKITEM) and report exports containing those tags
//   CSV  : Ledger lists, Stock Summary, Bills Receivable / Outstandings (comma, tab, semicolon or pipe separated)
//
// Output of parseTally(): { format, parts: [{ kind, records }], warnings }
//   kind 'customers' -> { name, address, phone, email, gstin, balance, group }      balance > 0 = customer owes us
//   kind 'bills'     -> { party, ref, date, due, amount }
//   kind 'stock'     -> { name, group, unit, qty, rate, value }

// ---------------------------------------------------------------- XML

export function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (m, hex, dec, name) => {
    if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name];
    const code = hex ? parseInt(hex, 16) : +dec;
    if (code < 32 && ![9, 10, 13].includes(code)) return '';   // Tally writes control characters like &#4; that XML parsers reject
    try { return String.fromCodePoint(code); } catch { return ''; }
  });
}

export function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag !== m[2]) i--;
      if (i > 0) stack.length = i;
    } else if (m[3]) {
      const node = { tag: m[3], attrs: {}, children: [], text: '' };
      m[4].replace(/([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { node.attrs[k] = decodeEntities(a ?? b ?? ''); return ''; });
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root;
}

const kid = (n, tag) => n.children.find(c => c.tag === tag);
const txt = (n, tag) => { const k = n && kid(n, tag); return k ? k.text.trim() : ''; };
function descendants(n, tag, out = []) {
  for (const c of n.children) { if (c.tag === tag) out.push(c); descendants(c, tag, out); }
  return out;
}
const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
const normGroup = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Tally XML writes debit amounts as negative numbers
function xmlAmount(s) {
  const n = parseFloat(String(s || '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function xmlQty(s) {
  const m = /-?\d[\d,]*\.?\d*/.exec(String(s || ''));
  return m ? Math.abs(parseFloat(m[0].replace(/,/g, ''))) : 0;
}

function xmlParts(root, kind, opts, warnings) {
  const parts = [];
  const ledgers = descendants(root, 'LEDGER'), stockItems = descendants(root, 'STOCKITEM'), vouchers = descendants(root, 'VOUCHER');
  const wantC = kind === 'auto' || kind === 'customers', wantS = kind === 'auto' || kind === 'stock';

  if (wantC && ledgers.length) {
    const parentOf = new Map();
    for (const g of descendants(root, 'GROUP')) parentOf.set(normGroup(g.attrs.NAME || txt(kid(g, 'NAME.LIST') || { children: [] }, 'NAME')), normGroup(txt(g, 'PARENT')));
    const isDebtor = parent => {
      let p = normGroup(parent), guard = 0;
      while (p && guard++ < 12) { if (p === 'sundry debtors') return true; p = parentOf.get(p); }
      return false;
    };
    const records = [], seen = new Set(), otherGroups = new Set();
    for (const n of ledgers) {
      const nl = kid(n, 'NAME.LIST');
      const name = tidy(n.attrs.NAME || (nl && txt(nl, 'NAME')) || txt(n, 'NAME'));
      if (!name || seen.has(name.toLowerCase())) continue;
      const group = txt(n, 'PARENT');
      if (!opts.allLedgers && !isDebtor(group)) { otherGroups.add(group || '(none)'); continue; }
      seen.add(name.toLowerCase());
      const addr = kid(n, 'ADDRESS.LIST');
      const lines = addr ? addr.children.filter(c => c.tag === 'ADDRESS').map(c => c.text.trim()).filter(Boolean) : [];
      const extra = [txt(n, 'LEDSTATENAME'), txt(n, 'PINCODE')].filter(Boolean);
      const gstin = (descendants(n, 'GSTIN')[0]?.text || txt(n, 'PARTYGSTIN') || '').trim();
      const closing = txt(n, 'CLOSINGBALANCE'), opening = txt(n, 'OPENINGBALANCE');
      records.push({
        name, group,
        address: [...lines, ...extra].join(', '),
        phone: txt(n, 'LEDGERMOBILE') || txt(n, 'LEDGERPHONE') || txt(n, 'PHONENUMBER'),
        email: txt(n, 'EMAIL') || txt(n, 'EMAILID'),
        gstin,
        balance: -xmlAmount(closing || opening),      // Dr (negative in XML) = customer owes us
        balanceSource: closing ? 'closing' : 'opening',
      });
    }
    if (!records.length) {
      warnings.push(`No Sundry Debtors ledgers found among ${ledgers.length} ledgers` + (otherGroups.size ? ` (groups seen: ${[...otherGroups].slice(0, 6).join(', ')}${otherGroups.size > 6 ? '…' : ''}). Tick "Import all ledgers" to bring them in anyway.` : '.'));
    } else {
      if (otherGroups.size) warnings.push(`Skipped ${ledgers.length - records.length} ledgers that are not Sundry Debtors (e.g. ${[...otherGroups].slice(0, 4).join(', ')}).`);
      if (records.some(r => r.balanceSource === 'opening')) warnings.push('Balances come from the ledger master, which holds the OPENING balance for the financial year, not today\'s outstanding. For current dues export the Bills Receivable / Outstandings report as CSV.');
      parts.push({ kind: 'customers', records });
    }
  }

  if (wantS && stockItems.length) {
    const records = [], seen = new Set();
    for (const n of stockItems) {
      const nl = kid(n, 'NAME.LIST');
      const name = tidy(n.attrs.NAME || (nl && txt(nl, 'NAME')) || txt(n, 'NAME'));
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const closing = txt(n, 'CLOSINGBALANCE'), opening = txt(n, 'OPENINGBALANCE');
      const rate = parseFloat((txt(n, 'CLOSINGRATE') || txt(n, 'OPENINGRATE')).replace(/,/g, '')) || 0;
      records.push({ name, group: txt(n, 'PARENT'), unit: txt(n, 'BASEUNITS'), qty: xmlQty(closing || opening), rate: Math.abs(rate), value: Math.abs(xmlAmount(txt(n, 'CLOSINGVALUE') || txt(n, 'OPENINGVALUE'))) });
    }
    if (records.length) {
      parts.push({ kind: 'stock', records });
      warnings.push('Stock quantities come from the Tally stock master (closing balance if present, otherwise opening balance).');
    }
  }

  if (!parts.length && vouchers.length) warnings.push(`This file holds ${vouchers.length} vouchers (transactions). Importing vouchers is not supported yet. Export Masters (ledgers and stock items) or the Outstandings report instead.`);
  return parts;
}

// ---------------------------------------------------------------- CSV

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sample = text.split(/\r?\n/).slice(0, 12).join('\n');
  const count = d => sample.split(d).length - 1;
  const delim = [',', '\t', ';', '|'].map(d => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const D = delim[1] ? delim[0] : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === D) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  name: ['ledgername', 'partysname', 'partyname', 'customername', 'customer', 'ledger', 'name', 'particulars'],
  stockName: ['stockitem', 'stockitemname', 'itemname', 'item', 'name', 'particulars'],
  address: ['address', 'mailingaddress', 'addr'],
  phone: ['mobileno', 'mobile', 'phoneno', 'phone', 'contactno', 'contact', 'telephone', 'tel'],
  email: ['emailid', 'email', 'mail'],
  gstin: ['gstin', 'gstinuin', 'gstno', 'gstregistrationnumber', 'gstnumber'],
  balance: ['closingbalance', 'pendingamount', 'pending', 'outstanding', 'balance', 'openingbalance', 'amount'],
  debit: ['debit', 'dr'], credit: ['credit', 'cr'],
  due: ['duedate', 'dueon', 'due'],
  ref: ['refno', 'referenceno', 'reference', 'billno', 'invoiceno', 'vouchernumber', 'ref'],
  date: ['billdate', 'date'],
  qty: ['closingquantity', 'closingqty', 'quantity', 'qty', 'stockonhand'],
  rate: ['closingrate', 'avgrate', 'rate'],
  value: ['closingvalue', 'value'],
  unit: ['unit', 'uom', 'units'],
  group: ['stockgroup', 'group', 'category', 'parent'],
};
const col = (headers, key) => { for (const a of ALIAS[key]) { const i = headers.indexOf(a); if (i >= 0) return i; } return -1; };

export function toIsoDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  let m;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  if ((m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[a-z]*[-\/ ,]*(\d{2,4})$/.exec(s))) { const mi = mon.indexOf(m[2].toLowerCase()); if (mi >= 0) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}

// "1,23,456.00 Dr" -> +123456, "5,000 Cr" -> -5000, "(500)" -> -500, "500" -> 500
export function csvAmount(s) {
  s = String(s ?? '').trim(); if (!s) return 0;
  const cr = /\bcr\b/i.test(s), neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = parseFloat(s.replace(/[^\d.]/g, '')); if (!Number.isFinite(n)) return 0;
  return (cr ? -n : n) * (neg ? -1 : 1);
}

function csvParts(rows, kind, warnings) {
  if (rows.length < 2) throw new Error('The file has no data rows.');
  // header row = the earliest row (in the first 25) with the most recognised column names
  const known = new Set(Object.values(ALIAS).flat());
  let best = 0, bestScore = -1;
  rows.slice(0, 25).forEach((r, i) => { const sc = r.filter(c => known.has(norm(c))).length; if (sc > bestScore) { bestScore = sc; best = i; } });
  if (bestScore < 2) throw new Error('Could not find a header row. Expected columns such as Particulars/Name, Quantity, Pending Amount, Due On.');
  let headers = rows[best].map(norm), data = rows.slice(best + 1);
  // sub-heading row picked as the header (blank first cell): take blank headings from the row above it
  if (best > 0 && !rows[best][0].trim() && rows[best - 1].some(c => known.has(norm(c)))) {
    headers = rows[best].map((c, i) => (c.trim() ? norm(c) : norm(rows[best - 1][i] || '')));
  }
  // Tally often splits headings over two rows (e.g. "Closing Balance" above "Quantity | Rate | Value"): merge them
  const sub = rows[best + 1];
  if (sub && sub.filter(c => known.has(norm(c))).length >= 2 && sub.every(c => !c.trim() || known.has(norm(c)))) {
    headers = headers.map((h, i) => (sub[i] && sub[i].trim() ? norm(sub[i]) : h));
    data = rows.slice(best + 2);
  }
  const has = k => col(headers, k) >= 0;

  let k = kind;
  if (k === 'auto') k = has('qty') ? 'stock' : (has('due') || has('ref')) && (has('balance') || has('debit')) ? 'bills' : 'customers';
  const get = (r, key, alt) => { const i = col(headers, key === 'name' && alt ? alt : key); return i >= 0 ? (r[i] ?? '') : ''; };
  const money = r => {
    const b = col(headers, 'balance'), d = col(headers, 'debit'), c = col(headers, 'credit');
    if (b >= 0 && r[b]) return csvAmount(r[b]);
    if (d >= 0 || c >= 0) return csvAmount(r[d]) - csvAmount(r[c]);
    return 0;
  };
  const isTotal = s => /^(grand\s*)?total\b/i.test(s) || /^(opening|closing)\s+(stock|balance)\b/i.test(s);
  const records = []; let skipped = 0;

  if (k === 'stock') {
    const nameCol = col(headers, 'stockName');
    if (nameCol < 0) throw new Error('No item name column found (Particulars / Stock Item / Name).');
    for (const r of data) {
      const name = tidy(r[nameCol]); if (!name || isTotal(name)) continue;
      const qtyTxt = get(r, 'qty'), rate = get(r, 'rate');
      if (!qtyTxt && !rate) { skipped++; continue; }   // group heading rows in Stock Summary
      records.push({ name, group: get(r, 'group'), unit: get(r, 'unit') || (/[A-Za-z]+$/.exec(qtyTxt) || [''])[0], qty: Math.abs(csvAmount(String(qtyTxt).replace(/[A-Za-z]+$/, ''))), rate: Math.abs(csvAmount(rate)), value: Math.abs(csvAmount(get(r, 'value'))) });
    }
    if (skipped) warnings.push(`Ignored ${skipped} group heading rows (rows with no quantity or rate).`);
  } else if (k === 'bills') {
    const nameCol = col(headers, 'name');
    if (nameCol < 0) throw new Error('No party name column found (Party\'s Name / Particulars).');
    for (const r of data) {
      const party = tidy(r[nameCol]); if (!party || isTotal(party)) continue;
      const amount = money(r); if (!(amount > 0)) { skipped++; continue; }
      records.push({ party, ref: get(r, 'ref'), date: toIsoDate(get(r, 'date')), due: toIsoDate(get(r, 'due')), amount });
    }
    if (skipped) warnings.push(`Ignored ${skipped} rows with no pending amount.`);
  } else {
    const nameCol = col(headers, 'name');
    if (nameCol < 0) throw new Error('No name column found (Name / Ledger Name / Particulars).');
    const seen = new Set();
    for (const r of data) {
      const name = tidy(r[nameCol]); if (!name || isTotal(name) || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      records.push({ name, address: get(r, 'address'), phone: get(r, 'phone'), email: get(r, 'email'), gstin: get(r, 'gstin'), group: '', balance: money(r) });
    }
  }
  if (!records.length) throw new Error('No usable rows were found in this file.');
  return [{ kind: k, records }];
}

// ---------------------------------------------------------------- entry point

export function parseTally(content, filename = '', kind = 'auto', opts = {}) {
  const warnings = [];
  const text = String(content).replace(/^﻿/, '');
  const looksXml = /^\s*(<\?xml|<ENVELOPE|<TALLYMESSAGE)/i.test(text) || /\.xml$/i.test(filename);
  let parts;
  if (looksXml) {
    const root = parseXml(text);
    parts = xmlParts(root, kind === 'bills' ? 'none' : kind, opts, warnings);
    if (kind === 'bills') throw new Error('Outstanding receivables must be exported as CSV (Bills Receivable report). For XML use "Customers" or "Stock items".');
    if (!parts.length) {
      if (!warnings.length) warnings.push('No ledgers or stock items were found in this XML file.');
      return { format: 'xml', parts: [], warnings };
    }
    return { format: 'xml', parts, warnings };
  }
  parts = csvParts(parseCsv(text), kind, warnings);
  return { format: 'csv', parts, warnings };
}
