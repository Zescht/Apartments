const FIELD_TYPES = ['text', 'number', 'date', 'enum', 'list', 'computed'];
const FIELD_BETTER = ['lower', 'higher'];
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const SETTING_KEYS = ['ai_provider', 'ai_model', 'display_currency', 'fx_override'];
const FX_TTL_MS = 12 * 60 * 60 * 1000;
const FX_TARGETS = ['EUR', 'MNT'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const ok =
    origin &&
    (origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  if (!ok) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function isAuthorized(request, env) {
  if (!env.APP_PASSPHRASE) throw new HttpError(500, 'APP_PASSPHRASE is not configured');
  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.APP_PASSPHRASE)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

// ---------- fields ----------

function fieldFromRow(r) {
  return {
    key: r.key,
    label: r.label,
    type: r.type,
    unit: r.unit,
    instruction: r.instruction,
    options: r.options ? parseJson(r.options, []) : null,
    formula: r.formula,
    better: r.better,
    visible: !!r.visible,
    position: r.position,
  };
}

function validateField(f, index) {
  const at = `fields[${index}]`;
  if (!f || typeof f !== 'object') throw new HttpError(400, `${at} must be an object`);
  if (!FIELD_KEY.test(f.key ?? '')) throw new HttpError(400, `${at}.key must match ${FIELD_KEY}`);
  if (typeof f.label !== 'string' || !f.label.trim()) throw new HttpError(400, `${at}.label is required`);
  if (!FIELD_TYPES.includes(f.type)) throw new HttpError(400, `${at}.type must be one of ${FIELD_TYPES.join(', ')}`);
  if (f.better != null && !FIELD_BETTER.includes(f.better)) throw new HttpError(400, `${at}.better must be lower, higher or null`);
  if (f.type === 'enum' && !(Array.isArray(f.options) && f.options.length && f.options.every((o) => typeof o === 'string'))) {
    throw new HttpError(400, `${at}.options must be a non-empty string array for enum fields`);
  }
  if (f.type === 'computed' && !(typeof f.formula === 'string' && f.formula.trim())) {
    throw new HttpError(400, `${at}.formula is required for computed fields`);
  }
  return {
    key: f.key,
    label: f.label.trim().slice(0, 80),
    type: f.type,
    unit: f.unit ? String(f.unit).slice(0, 12) : null,
    instruction: String(f.instruction ?? '').slice(0, 2000),
    options: f.type === 'enum' ? JSON.stringify(f.options) : null,
    formula: f.type === 'computed' ? f.formula.trim().slice(0, 200) : null,
    better: f.better ?? null,
    visible: f.visible === false ? 0 : 1,
    position: Number.isFinite(f.position) ? f.position : (index + 1) * 10,
  };
}

async function listFields(env) {
  const { results } = await env.DB.prepare('SELECT * FROM fields ORDER BY position, key').all();
  return results.map(fieldFromRow);
}

async function replaceFields(env, body) {
  if (!Array.isArray(body) || body.length > 60) throw new HttpError(400, 'Body must be an array of at most 60 fields');
  const fields = body.map(validateField);
  if (new Set(fields.map((f) => f.key)).size !== fields.length) throw new HttpError(400, 'Field keys must be unique');
  const insert = env.DB.prepare(
    `INSERT INTO fields (key, label, type, unit, instruction, options, formula, better, visible, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Listing data keeps values for removed fields, so re-adding a field brings them back.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM fields'),
    ...fields.map((f) =>
      insert.bind(f.key, f.label, f.type, f.unit, f.instruction, f.options, f.formula, f.better, f.visible, f.position),
    ),
  ]);
  return listFields(env);
}

// ---------- listings ----------

function listingFromRow(r) {
  return {
    id: r.id,
    url: r.url,
    data: parseJson(r.data, {}),
    evidence: parseJson(r.evidence, {}),
    favorite: !!r.favorite,
    comment: r.comment,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function parseUrl(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    throw new HttpError(400, 'url must be a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'url must be http(s)');
  u.hash = '';
  return u.toString();
}

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

async function getListing(env, id) {
  const row = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  return row ? listingFromRow(row) : null;
}

async function createListing(env, body) {
  const url = parseUrl(body?.url);
  const existing = await env.DB.prepare('SELECT id FROM listings WHERE url = ?').bind(url).first();
  if (existing) return json({ error: 'Listing already exists', id: existing.id }, 409);
  if (body.data != null && !isPlainObject(body.data)) throw new HttpError(400, 'data must be an object');
  const { meta } = await env.DB.prepare('INSERT INTO listings (url, data, favorite) VALUES (?, ?, ?)')
    .bind(url, JSON.stringify(body.data ?? {}), body.favorite ? 1 : 0)
    .run();
  return json(await getListing(env, meta.last_row_id), 201);
}

async function patchListing(env, id, body) {
  const sets = [];
  const values = [];
  if ('data' in body) {
    if (!isPlainObject(body.data)) throw new HttpError(400, 'data must be an object');
    sets.push('data = ?');
    values.push(JSON.stringify(body.data));
  }
  if ('evidence' in body) {
    if (!isPlainObject(body.evidence)) throw new HttpError(400, 'evidence must be an object');
    sets.push('evidence = ?');
    values.push(JSON.stringify(body.evidence));
  }
  if ('favorite' in body) {
    sets.push('favorite = ?');
    values.push(body.favorite ? 1 : 0);
  }
  if ('comment' in body) {
    sets.push('comment = ?');
    values.push(String(body.comment).slice(0, 4000));
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE listings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values, id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Listing not found');
  return getListing(env, id);
}

// ---------- settings ----------

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of results) if (SETTING_KEYS.includes(r.key)) out[r.key] = r.value;
  return out;
}

async function putSettings(env, body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'Body must be an object');
  const stmt = env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const batch = [];
  for (const [k, v] of Object.entries(body)) {
    if (!SETTING_KEYS.includes(k)) throw new HttpError(400, `Unknown setting: ${k}`);
    const value = typeof v === 'string' ? v : JSON.stringify(v);
    if (value.length > 500) throw new HttpError(400, `Setting ${k} is too long`);
    batch.push(stmt.bind(k, value));
  }
  if (batch.length) await env.DB.batch(batch);
  return getSettings(env);
}

// ---------- currency rates (CZK -> EUR / MNT) ----------

async function getRates(env) {
  const cached = await env.DB.prepare("SELECT value FROM settings WHERE key = 'fx_cache'").first();
  let cache = cached ? parseJson(cached.value, null) : null;

  if (!cache || Date.now() - cache.fetchedAt > FX_TTL_MS) {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/CZK');
      const body = await res.json();
      if (!res.ok || body.result !== 'success') throw new Error('rate provider error');
      const rates = {};
      for (const c of FX_TARGETS) {
        if (typeof body.rates?.[c] !== 'number') throw new Error(`missing ${c} rate`);
        rates[c] = body.rates[c];
      }
      cache = { rates, fetchedAt: Date.now(), source: 'open.er-api.com' };
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('fx_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(JSON.stringify(cache))
        .run();
    } catch (err) {
      if (!cache) throw new HttpError(502, `Could not fetch exchange rates: ${err.message}`);
      cache.stale = true; // serve the old rates rather than failing
    }
  }

  const overrideRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'fx_override'").first();
  const override = overrideRow ? parseJson(overrideRow.value, {}) : {};
  const rates = { ...cache.rates };
  const overridden = [];
  for (const c of FX_TARGETS) {
    if (typeof override[c] === 'number' && override[c] > 0) {
      rates[c] = override[c];
      overridden.push(c);
    }
  }
  return { base: 'CZK', rates, overridden, fetchedAt: new Date(cache.fetchedAt).toISOString(), source: cache.source, stale: !!cache.stale };
}

// ---------- router ----------

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  const seg = pathname.split('/').filter(Boolean); // ["api", "listings", "3"]

  if (seg[0] !== 'api') throw new HttpError(404, 'Not found');
  if (seg[1] === 'health' && method === 'GET') return json({ ok: true });

  if (!(await isAuthorized(request, env))) throw new HttpError(401, 'Wrong or missing passphrase');

  switch (seg[1]) {
    case 'auth':
      if (method === 'GET') return json({ ok: true });
      break;

    case 'fields':
      if (method === 'GET') return json(await listFields(env));
      if (method === 'PUT') return json(await replaceFields(env, await readJson(request)));
      break;

    case 'listings': {
      const id = seg[2] ? Number(seg[2]) : null;
      if (seg[2] && !Number.isInteger(id)) throw new HttpError(400, 'Invalid listing id');
      if (!id) {
        if (method === 'GET') {
          const onlyFavorites = url.searchParams.get('favorite') === '1';
          const sql = `SELECT * FROM listings ${onlyFavorites ? 'WHERE favorite = 1' : ''} ORDER BY updated_at DESC, id DESC`;
          const { results } = await env.DB.prepare(sql).all();
          return json(results.map(listingFromRow));
        }
        if (method === 'POST') return createListing(env, await readJson(request));
      } else {
        if (method === 'GET') {
          const listing = await getListing(env, id);
          if (!listing) throw new HttpError(404, 'Listing not found');
          return json(listing);
        }
        if (method === 'PATCH') return json(await patchListing(env, id, await readJson(request)));
        if (method === 'DELETE') {
          const res = await env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();
          if (!res.meta.changes) throw new HttpError(404, 'Listing not found');
          return json({ ok: true });
        }
      }
      break;
    }

    case 'settings':
      if (method === 'GET') return json(await getSettings(env));
      if (method === 'PUT') return json(await putSettings(env, await readJson(request)));
      break;

    case 'rates':
      if (method === 'GET') return json(await getRates(env));
      break;
  }
  throw new HttpError(seg[1] ? 405 : 404, 'Not found or method not allowed');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(request, env, new URL(request.url));
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 && !(err instanceof HttpError) ? 'Internal error' : err.message }, status, cors);
    }
  },
};
