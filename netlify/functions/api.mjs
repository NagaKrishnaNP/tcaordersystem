// Tableside backend for Netlify.
// Stores the menu, orders and admin PIN in Netlify Blobs (built in, no setup needed).
// Routes (all under /api):
//   GET  /api/menu                  menu + whether the starting PIN is still in use
//   PUT  /api/menu                  replace the menu (admin PIN required)
//   POST /api/menu/reset            replace the menu with the built-in starting menu (admin PIN required)
//   GET  /api/tables                the list of tables (6 to start with)
//   PUT  /api/tables                replace the list of tables (admin PIN required)
//   GET  /api/open                  the saved, not yet paid order of every table
//   PUT  /api/open/:tableId         save the order of one table (an empty order clears it)
//   GET  /api/orders?from=&to=      orders for a date range (YYYY-MM-DD)
//   PUT  /api/orders/:day/:id       change the payment type of an order (admin PIN required)
//   DELETE /api/orders/:day/:id     delete an order (admin PIN required)
//   POST /api/orders                check out: saves the order and clears that table's open order
//   POST /api/pin/verify            check a PIN
//   PUT  /api/pin                   change the PIN (current PIN required)
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_PIN = '123456';
const MAX_DAYS = 93;
const MAX_ORDERS = 5000;
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

// Starting menu: The Chatpata Affair. Used only until the admin saves a menu of their own.
// Each row is [category id, category name, [[item name, price, optional available flag], ...]].
const SEED = (() => {
  const menu = [
    ['chaats', 'Chaats', [
      ['Pani Puri (6 pcs)', 40], ['Suji Pani Puri (6 pcs)', 59], ['Sev Puri (6 pcs)', 69], ['Chips Chaat', 69],
      ['Bhel Puri', 60], ['Masala Puri Chaat', 60], ['Dahi Bhel Puri', 79], ['Dahi Puri', 70],
      ['Papdi Dahi Chaat', 85], ['Samosa Chole Chaat', 85], ['Aloo Tikki Chaat', 89], ['Samosa Dahi Chaat', 89],
      ['Dahi Bhalla', 99], ['Bhalla Papdi', 99],
    ]],
    ['platter', 'Chaat Platter', [
      ['Pani Puri Platter', 149], ['Dahi Puri Platter', 159], ['Samosa Chaat Platter', 159], ['Dahi Bhalla Platter', 169],
    ]],
    ['pasta', 'Pasta', [
      ['Tomato Sauce Pasta', 109], ['White Sauce Pasta', 109], ['Mix Sauce Pasta', 120], ['Makhani Pasta', 130],
    ]],
    ['fries', 'Fries', [
      ['Salted Fries', 79], ['Peri-Peri Fries', 89], ['Cheese Fries', 99], ['Fire & Cheese Fries', 109],
      ['Jalapeno Cheese Fries', 109], ['Smokey BBQ Cheese Fries', 119], ['Tandoori Fries', 119],
    ]],
    ['sandwich', 'Sandwich', [['Veg Sandwich', 60], ['Paneer Sandwich', 79]]],
    ['wraps', 'Wraps', [['Mixveg Roll', 79], ['Veg Kabab Roll', 90], ['Paneer Roll', 110]]],
    ['maggi', 'Maggi', [['Masala Maggi', 59], ['Veg Maggi', 69], ['Cheese Maggi', 79]]],
    ['momos', 'Momos', [
      ['Veg Steam Momo (6 pcs)', 60], ['Paneer Steam Momo (6 pcs)', 80], ['Veg Fried Momo (6 pcs)', 70],
      ['Paneer Fried Momo (6 pcs)', 90], ['Assorted Momo (6 pcs)', 70], ['Assorted Fried Momo (6 pcs)', 90],
    ]],
    ['snacks', 'Snacks', [['Samosa', 30], ['Samosa (2 pcs)', 55], ['Kachori (2 pcs)', 55], ['2 pcs Samosa & Tea', 65]]],
    ['vadapav', 'Vada Pav', [['Classic Vada Pav', 55], ['Crispy Vada Pav', 69]]],
    ['chinese', 'Chinese', [
      ['Hakka Noodles', 120], ['Schezwan Noodles', 140], ['Paneer Noodles', 160], ['Chilli Garlic Noodles', 160],
      ['Chilli Potato', 130], ['Honey Chilli Potato', 140], ['Chilli Paneer', 180], ['Veg Fried Rice', 120],
      ['Schezwan Fried Rice', 140], ['Chilli Garlic Fried Rice', 160], ['Crispy Corn', 90],
      ['Paneer Manchurian', 160], ['Gobi Manchurian Dry', 120],
    ]],
    ['breakfast', 'All Day Breakfast', [
      ['Indori Poha', 75], ['Pav Bhaji (2 pcs)', 99], ['Aloo Paratha (2 pcs)', 129], ['Paneer Paratha (2 pcs)', 149],
    ]],
    ['cool', 'Cool Collection', [
      ['Lemon Ice Tea', 109], ['Peach Ice Tea', 109], ['Masala Shikanji', 109], ['Aam Panna', 109],
      // The menu prints "MRP" instead of a price. Held back until the admin sets the price.
      ['Water Bottle', 0, false],
    ]],
    ['mocktails', 'Mocktails', [
      ['Mint Mojito', 79], ['Watermelon Mojito', 89], ['Blue Curacao Mojito', 89], ['Green Apple Mojito', 89],
      ['Strawberry Mojito', 99], ['Kala Khatta Mojito', 99],
    ]],
    ['sips', 'Soulful Sips', [
      ['Salted Lassi', 69], ['Sweet Lassi', 79], ['Mango Lassi', 89], ['Butterscotch Lassi', 99], ['Strawberry Lassi', 99],
    ]],
    ['tea', 'Tea & Coffee', [
      ['Ginger Tea', 30], ['Elaichi Tea', 30], ['Lemon Tea', 20], ['Masala Tea', 25], ['Coffee', 30],
    ]],
    ['desserts', 'Desserts', [
      ['Vanilla Ice Cream With Jamoon', 79], ['Classic Tiramisu', 199], ['Chocolate Tiramisu', 249],
    ]],
  ];
  const out = { cats: [], items: [] };
  let pos = 1;
  menu.forEach(([id, name, items], i) => {
    out.cats.push({ id, name, pos: i + 1 });
    items.forEach(([itemName, price, avail]) => {
      out.items.push({ id: `${id}-${pos}`, cat: id, name: itemName, price, avail: avail !== false, pos: pos++ });
    });
  });
  return out;
})();

const DEFAULT_TABLES = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `t${n}`, name: `Table ${n}`, pos: n }));
const safeId = (v) => /^[A-Za-z0-9_-]{1,40}$/.test(String(v || ''));

async function readTables(store) {
  const t = await store.get('tables', { type: 'json' });
  return t && Array.isArray(t.tables) ? t.tables : DEFAULT_TABLES;
}

function cleanTables(body) {
  if (!body || !Array.isArray(body.tables) || body.tables.length > 60) return null;
  const seen = new Set(), out = [];
  for (const t of body.tables) {
    const id = str(t && t.id, 40), name = str(t && t.name, 40);
    if (!safeId(id) || !name || seen.has(id)) return null;
    seen.add(id);
    out.push({ id, name, pos: num(t.pos) || 0 });
  }
  return out;
}

function cleanCart(body) {
  const src = body && body.cart && typeof body.cart === 'object' && !Array.isArray(body.cart) ? body.cart : {};
  const keys = Object.keys(src);
  if (keys.length > 300) return null;
  const cart = {};
  for (const k of keys) {
    const id = str(k, 40), q = Math.floor(num(src[k]));
    if (id && q >= 1 && q <= 999) cart[id] = q;
  }
  return { cart, waiter: str(body && body.waiter, 40) };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, code, error) => json({ code, error }, status);

const hashPin = (salt, pin) => createHash('sha256').update(`${salt}:tableside:${pin}`).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

function daysInRange(from, to) {
  const out = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (t <= end && out.length <= MAX_DAYS) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

async function readConfig(store) {
  return (await store.get('config', { type: 'json' })) || {};
}

// Returns { ok, locked, wait }. Five wrong tries lock PIN checking for a minute.
async function checkPin(store, pin) {
  const cfg = await readConfig(store);
  const now = Date.now();
  if (cfg.lockedUntil && cfg.lockedUntil > now) return { ok: false, locked: true, wait: Math.ceil((cfg.lockedUntil - now) / 1000) };
  const given = String(pin || '');
  const ok = /^\d{6}$/.test(given) && (cfg.hash ? safeEqual(hashPin(cfg.salt, given), cfg.hash) : given === DEFAULT_PIN);
  if (ok) {
    if (cfg.fails) await store.setJSON('config', { ...cfg, fails: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const fails = (cfg.fails || 0) + 1;
  await store.setJSON('config', { ...cfg, fails: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? now + LOCK_MS : 0 });
  return { ok: false, locked: fails >= MAX_FAILS, wait: fails >= MAX_FAILS ? LOCK_MS / 1000 : 0 };
}

async function requireAdmin(store, req) {
  const r = await checkPin(store, req.headers.get('x-admin-pin'));
  if (r.ok) return null;
  if (r.locked) return fail(429, 'locked', 'Too many wrong PINs. Wait a minute.');
  return fail(401, 'bad_pin', 'The admin PIN is wrong or has changed.');
}

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

function cleanMenu(body) {
  if (!body || !Array.isArray(body.cats) || !Array.isArray(body.items)) return null;
  if (body.cats.length > 60 || body.items.length > 600) return null;
  const cats = [], items = [];
  const seen = new Set();
  for (const c of body.cats) {
    const id = str(c && c.id, 40), name = str(c && c.name, 40);
    if (!id || !name || seen.has(id)) return null;
    seen.add(id);
    cats.push({ id, name, pos: num(c.pos) || 0 });
  }
  const itemIds = new Set();
  for (const i of body.items) {
    const id = str(i && i.id, 40), name = str(i && i.name, 80), cat = str(i && i.cat, 40), price = num(i && i.price);
    if (!id || !name || !seen.has(cat) || !(price >= 0) || price > 1000000 || itemIds.has(id)) return null;
    itemIds.add(id);
    items.push({ id, cat, name, price: Math.round(price * 100) / 100, avail: i.avail !== false, pos: num(i.pos) || 0 });
  }
  return { cats, items };
}

function cleanOrder(body) {
  if (!body || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) return null;
  if (body.pay !== 'Cash' && body.pay !== 'UPI') return null;
  if (!isDay(body.day)) return null;
  // The day comes from the phone's own clock (restaurant time zone). Accept today +/- 1 day.
  const drift = Math.abs(Date.parse(`${body.day}T12:00:00Z`) - Date.now());
  if (drift > 2 * 86400000) return null;
  const lines = [];
  let total = 0;
  for (const l of body.lines) {
    const qty = Math.floor(num(l && l.qty)), price = num(l && l.price), name = str(l && l.name, 80);
    if (!name || !(qty >= 1) || qty > 999 || !(price >= 0) || price > 1000000) return null;
    lines.push({ name, cat: str(l.cat, 40), price: Math.round(price * 100) / 100, qty });
    total += qty * Math.round(price * 100) / 100;
  }
  return { day: body.day, table: str(body.table, 40), waiter: str(body.waiter, 40), lines, total: Math.round(total * 100) / 100, pay: body.pay };
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const store = getStore({ name: 'tableside', consistency: 'strong' });

  try {
    if (path === '/menu' && method === 'GET') {
      const menu = (await store.get('menu', { type: 'json' })) || SEED;
      const cfg = await readConfig(store);
      return json({ cats: menu.cats, items: menu.items, pinIsDefault: !cfg.hash });
    }

    if (path === '/menu' && method === 'PUT') {
      const denied = await requireAdmin(store, req);
      if (denied) return denied;
      const menu = cleanMenu(await readBody(req));
      if (!menu) return fail(400, 'bad_menu', 'The menu was not valid.');
      await store.setJSON('menu', menu);
      return json({ ok: true });
    }

    if (path === '/menu/reset' && method === 'POST') {
      const denied = await requireAdmin(store, req);
      if (denied) return denied;
      await store.setJSON('menu', SEED);
      return json({ ok: true, cats: SEED.cats.length, items: SEED.items.length });
    }

    if (path === '/tables' && method === 'GET') {
      return json({ tables: await readTables(store) });
    }

    if (path === '/tables' && method === 'PUT') {
      const denied = await requireAdmin(store, req);
      if (denied) return denied;
      const tables = cleanTables(await readBody(req));
      if (!tables) return fail(400, 'bad_tables', 'The list of tables was not valid.');
      const keep = new Set(tables.map((t) => t.id));
      const gone = (await readTables(store)).filter((t) => !keep.has(t.id));
      for (const t of gone) {
        const o = await store.get(`open/${t.id}`, { type: 'json' });
        if (o && o.cart && Object.keys(o.cart).length) return fail(409, 'table_busy', `${t.name} has an open order. Check it out first.`);
      }
      await store.setJSON('tables', { tables });
      for (const t of gone) await store.delete(`open/${t.id}`);
      return json({ ok: true });
    }

    if (path === '/open' && method === 'GET') {
      const l = await store.list({ prefix: 'open/' });
      const pairs = await inBatches(l.blobs.map((b) => b.key), 40, async (key) => {
        const o = await store.get(key, { type: 'json' });
        return o ? [key.slice(5), o] : null;
      });
      return json({ open: Object.fromEntries(pairs.filter(Boolean)) });
    }

    if (path.startsWith('/open/') && method === 'PUT') {
      const id = decodeURIComponent(path.slice(6));
      if (!safeId(id)) return fail(400, 'bad_table', 'Unknown table.');
      if (!(await readTables(store)).some((t) => t.id === id)) return fail(404, 'no_table', 'That table does not exist any more.');
      const c = cleanCart(await readBody(req));
      if (!c) return fail(400, 'bad_cart', 'The order was not valid.');
      if (!Object.keys(c.cart).length) await store.delete(`open/${id}`);
      else await store.setJSON(`open/${id}`, { ...c, updated: Date.now() });
      return json({ ok: true });
    }

    const om = path.match(/^\/orders\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]{1,60})$/);
    if (om && (method === 'PUT' || method === 'DELETE')) {
      const denied = await requireAdmin(store, req);
      if (denied) return denied;
      if (!isDay(om[1])) return fail(400, 'bad_day', 'Unknown order.');
      const key = `orders/${om[1]}/${om[2]}`;
      const o = await store.get(key, { type: 'json' });
      if (!o) return fail(404, 'no_order', 'That order no longer exists.');
      if (method === 'DELETE') {
        await store.delete(key);
        return json({ ok: true });
      }
      const body = await readBody(req);
      if (!body || (body.pay !== 'Cash' && body.pay !== 'UPI')) return fail(400, 'bad_pay', 'Payment must be Cash or UPI.');
      await store.setJSON(key, { ...o, pay: body.pay, editedAt: Date.now() });
      return json({ ok: true });
    }

    if (path === '/orders' && method === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!isDay(from) || !isDay(to) || from > to) return fail(400, 'bad_range', 'Pick a valid date range.');
      const days = daysInRange(from, to);
      if (days.length > MAX_DAYS) return fail(400, 'range_too_long', `Pick ${MAX_DAYS} days or fewer.`);
      const lists = await inBatches(days, 10, (d) => store.list({ prefix: `orders/${d}/` }));
      const keys = lists.flatMap((l) => l.blobs.map((b) => b.key)).sort().slice(-MAX_ORDERS);
      const orders = (await inBatches(keys, 40, async (key) => {
        const o = await store.get(key, { type: 'json' });
        return o ? { ...o, id: key.split('/').pop() } : null;
      })).filter(Boolean);
      return json({ orders });
    }

    if (path === '/orders' && method === 'POST') {
      const body = await readBody(req);
      const order = cleanOrder(body);
      if (!order) return fail(400, 'bad_order', 'The order was not valid.');
      const ts = Date.now();
      order.ts = ts;
      const id = `${String(ts).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;
      await store.setJSON(`orders/${order.day}/${id}`, order);
      if (body && safeId(body.tableId)) await store.delete(`open/${body.tableId}`);
      return json({ ok: true, id });
    }

    if (path === '/pin/verify' && method === 'POST') {
      const body = await readBody(req);
      const r = await checkPin(store, body && body.pin);
      if (r.locked) return fail(429, 'locked', 'Too many wrong PINs. Wait a minute.');
      return json({ ok: r.ok });
    }

    if (path === '/pin' && method === 'PUT') {
      const denied = await requireAdmin(store, req);
      if (denied) return denied;
      const body = await readBody(req);
      const next = String((body && body.newPin) || '');
      if (!/^\d{6}$/.test(next)) return fail(400, 'bad_pin_format', 'The PIN must be exactly 6 digits.');
      const salt = randomBytes(16).toString('hex');
      await store.setJSON('config', { salt, hash: hashPin(salt, next), changedAt: Date.now(), fails: 0, lockedUntil: 0 });
      return json({ ok: true });
    }

    return fail(404, 'not_found', 'Unknown route.');
  } catch (err) {
    console.error('tableside api error', err);
    return fail(500, 'server_error', 'Something went wrong on the server. Try again.');
  }
};

export const config = { path: '/api/*' };
