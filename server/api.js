// Cloudflare Pages Functions: D1 stores metadata; Workers KV stores instruction images and the site logo.
// Existing video records are retained only for cleanup when parent records are deleted.
const SESSION_SECONDS = 12 * 60 * 60;
const LOGO_KEY = 'site:logo';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_MANUAL_IMAGE_BYTES = 2 * 1024 * 1024;
const MANUAL_IMAGE_PREFIX = '@FIT_IMG_V1:';

// Only raster images are accepted, checked against actual bytes (not an untrusted MIME header).
export function logoMime(bytes) {
  const a = new Uint8Array(bytes);
  if (a.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => a[i] === n)) return 'image/png';
  if (a.length >= 3 && a[0] === 255 && a[1] === 216 && a[2] === 255) return 'image/jpeg';
  if (a.length >= 12 && String.fromCharCode(...a.slice(0,4)) === 'RIFF' && String.fromCharCode(...a.slice(8,12)) === 'WEBP') return 'image/webp';
  if (a.length >= 6 && ['GIF87a','GIF89a'].includes(String.fromCharCode(...a.slice(0,6)))) return 'image/gif';
  return null;
}
const encoder = new TextEncoder();

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...headers,
  } });
}
function fail(message, status = 400) { return json({ error: message }, status); }
function validName(s, max = 80) { return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= max; }
function validId(s) { return typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s); }
// Cropped image UUIDs are encoded in existing text columns, so no D1 migration is needed.
export function manualImageIds(value) {
  if (typeof value !== 'string' || !value.startsWith(MANUAL_IMAGE_PREFIX)) return [];
  let items;
  try { items = JSON.parse(value.slice(MANUAL_IMAGE_PREFIX.length)); }
  catch { throw new Error('手順画像のデータ形式が正しくありません。'); }
  if (!Array.isArray(items) || items.length > 50 || items.some(item =>
    !item || typeof item.text !== 'string' || item.text.length > 15000 ||
    (item.imageId != null && !validId(item.imageId))
  )) throw new Error('手順画像のデータ形式が正しくありません。');
  return items.filter(item => item.imageId).map(item => item.imageId);
}
function imagesFromMachine(machine) {
  return [...new Set([...manualImageIds(machine.adjustment), ...manualImageIds(machine.instructions)])];
}
function imageJobs(machine) {
  return imagesFromMachine(machine).map(imageId => ({ id: 'image:' + machine.id + ':' + imageId, chunk_count: 1 }));
}
function fields(obj) {
  const out = {};
  for (const key of ['overview', 'adjustment', 'instructions', 'tips', 'safety']) {
    const val = obj[key] ?? '';
    if (typeof val !== 'string' || val.length > 15000) throw new Error(`${key}は15,000文字以内で入力してください。`);
    if (key === 'adjustment' || key === 'instructions') manualImageIds(val);
    out[key] = val;
  }
  return out;
}
async function body(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) throw new Error('JSON形式で送信してください。');
  if (Number(req.headers.get('content-length') || 0) > 120000) throw new Error('入力内容が大きすぎます。');
  return await req.json();
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return [...signature].map(v => v.toString(16).padStart(2, '0')).join('');
}
function constantEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function sessionValid(req, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const raw = req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('fit_admin='))?.slice(10);
  if (!raw) return false;
  const [expires, sig, extra] = raw.split('.');
  if (extra || !/^\d{10,15}$/.test(expires || '') || !/^[a-f0-9]{64}$/.test(sig || '') || Number(expires) < Date.now()) return false;
  return constantEquals(sig, await hmac(expires, env.ADMIN_SESSION_SECRET));
}
async function hashIp(req) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ip)));
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function login(req, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD.length < 12 || env.ADMIN_SESSION_SECRET.length < 32) return fail('管理者用シークレットが設定されていません。', 503);
  const ip = await hashIp(req);
  const now = Date.now();
  const attempt = await env.DB.prepare('SELECT attempts, window_start FROM login_attempts WHERE ip_hash=?').bind(ip).first();
  if (attempt && now - attempt.window_start < 900000 && attempt.attempts >= 8) return fail('試行回数が多すぎます。15分後に再試行してください。', 429);
  const data = await body(req);
  const correct = typeof data.password === 'string' && constantEquals(await hmac(data.password, env.ADMIN_SESSION_SECRET), await hmac(env.ADMIN_PASSWORD, env.ADMIN_SESSION_SECRET));
  if (!correct) {
    const reset = !attempt || now - attempt.window_start >= 900000;
    await env.DB.prepare('INSERT INTO login_attempts(ip_hash,attempts,window_start) VALUES(?,?,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=excluded.attempts,window_start=excluded.window_start')
      .bind(ip, reset ? 1 : attempt.attempts + 1, reset ? now : attempt.window_start).run();
    return fail('管理者パスワードが違います。', 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(ip).run();
  const expires = String(Date.now() + SESSION_SECONDS * 1000);
  const sig = await hmac(expires, env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, { 'set-cookie': `fit_admin=${expires}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_SECONDS}` });
}
async function serveLogo(req, env) {
  const { value, metadata } = await env.VIDEO_KV.getWithMetadata(LOGO_KEY, 'arrayBuffer');
  if (!value) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(req.method === 'HEAD' ? null : value, {
    status: 200,
    headers: {
      'content-type': metadata?.mimeType || 'image/png',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function catalog(db) {
  const [storeRows, areaRows, machineRows] = await Promise.all([
    db.prepare('SELECT id,name,position FROM stores ORDER BY position,name').all(),
    db.prepare('SELECT id,store_id AS storeId,name,position FROM areas ORDER BY position,name').all(),
    db.prepare(`SELECT m.id,m.area_id AS areaId,m.name,m.position,m.overview,m.adjustment,m.instructions,m.tips,m.safety
      FROM machines m ORDER BY m.position,m.name`).all(),
  ]);
  return { stores: storeRows.results, areas: areaRows.results, machines: machineRows.results };
}
// Track deletion independent of the video FK so a store can be removed without losing cleanup metadata.
async function enqueueCleanup(db, videos) {
  if (!videos.length) return;
  await db.batch(videos.map(v => db.prepare('INSERT OR IGNORE INTO video_cleanup_jobs(video_id,chunk_count,next_index) VALUES(?,?,0)')
    .bind(v.id, v.chunk_count)));
}
async function drainCleanup(env) {
  const jobs = (await env.DB.prepare('SELECT video_id,chunk_count,next_index FROM video_cleanup_jobs ORDER BY rowid LIMIT 25').all()).results;
  let budget = 20;
  for (const job of jobs) {
    if (!budget) break;
    const count = Math.min(budget, job.chunk_count - job.next_index);
    if (count <= 0) {
      await env.DB.prepare('DELETE FROM video_cleanup_jobs WHERE video_id=?').bind(job.video_id).run();
      continue;
    }
    // One chunk delete = one KV subrequest; stay under Workers Free's 50/request limit.
    for (let n = job.next_index; n < job.next_index + count; n++) {
      const key = job.video_id.startsWith('image:')
        ? 'manual:' + job.video_id.slice(6)
        : `video:${job.video_id}:${n}`;
      await env.VIDEO_KV.delete(key);
    }
    const next = job.next_index + count;
    if (next >= job.chunk_count) await env.DB.prepare('DELETE FROM video_cleanup_jobs WHERE video_id=?').bind(job.video_id).run();
    else await env.DB.prepare('UPDATE video_cleanup_jobs SET next_index=MAX(next_index,?) WHERE video_id=?').bind(next, job.video_id).run();
    budget -= count;
  }
  const remaining = await env.DB.prepare('SELECT COALESCE(SUM(chunk_count-next_index),0) AS count FROM video_cleanup_jobs').first();
  return { remaining: remaining?.count || 0 };
}
async function deletingVideos(db, scope, id) {
  let sql;
  if (scope === 'store') sql = `SELECT v.id,v.chunk_count FROM videos v JOIN machines m ON v.machine_id=m.id JOIN areas a ON m.area_id=a.id WHERE a.store_id=?`;
  else if (scope === 'area') sql = 'SELECT v.id,v.chunk_count FROM videos v JOIN machines m ON v.machine_id=m.id WHERE m.area_id=?';
  else sql = 'SELECT id,chunk_count FROM videos WHERE machine_id=?';
  return (await db.prepare(sql).bind(id).all()).results;
}
async function deletingImages(db, scope, id) {
  let sql;
  if (scope === 'store') sql = 'SELECT m.id,m.adjustment,m.instructions FROM machines m JOIN areas a ON m.area_id=a.id WHERE a.store_id=?';
  else if (scope === 'area') sql = 'SELECT id,adjustment,instructions FROM machines WHERE area_id=?';
  else sql = 'SELECT id,adjustment,instructions FROM machines WHERE id=?';
  const rows = (await db.prepare(sql).bind(id).all()).results;
  return rows.flatMap(imageJobs);
}
async function serveManualImage(req, env, machineId, imageId) {
  if (!validId(machineId) || !validId(imageId)) return fail('画像がありません。', 404);
  const machine = await env.DB.prepare('SELECT adjustment,instructions FROM machines WHERE id=?').bind(machineId).first();
  if (!machine || !imagesFromMachine(machine).includes(imageId)) return fail('画像がありません。', 404);
  const data = await env.VIDEO_KV.get(`manual:${machineId}:${imageId}`, 'arrayBuffer');
  if (!data) return fail('画像がありません。', 404);
  return new Response(req.method === 'HEAD' ? null : data, {
    status: 200, headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}
async function adminRequest({ request: req, env, waitUntil }, parts) {
  const method = req.method;
  if (parts[0] === 'login' && method === 'POST') return login(req, env);
  if (parts[0] === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': 'fit_admin=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
  if (!(await sessionValid(req, env))) return fail('管理者認証が必要です。', 401);
  if (parts[0] === 'session' && method === 'GET') return json({ ok: true });
  if (parts[0] === 'maintenance' && method === 'POST') return json(await drainCleanup(env));
  if (parts[0] === 'logo') {
    if (method === 'PUT') {
      if (Number(req.headers.get('content-length') || 0) > MAX_LOGO_BYTES) return fail('画像は2MiB以内にしてください。', 413);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAX_LOGO_BYTES) return fail('画像は2MiB以内にしてください。', 413);
      const mimeType = logoMime(data);
      if (!mimeType) return fail('PNG・JPEG・WebP・GIF画像を選択してください。');
      await env.VIDEO_KV.put(LOGO_KEY, data, { metadata: { mimeType } });
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.VIDEO_KV.delete(LOGO_KEY);
      return json({ ok: true });
    }
    return fail('メソッドが許可されていません。', 405);
  }
  const [type, id, action, index] = parts;
  const db = env.DB;

  if (type === 'stores') {
    if (!id && method === 'POST') {
      const d = await body(req); if (!validName(d.name)) return fail('店舗名を入力してください。');
      const newId = crypto.randomUUID();
      await db.prepare('INSERT INTO stores(id,name,position) VALUES(?,?,(SELECT COALESCE(MAX(position),0)+1 FROM stores))').bind(newId, d.name.trim()).run();
      return json({ ok: true, id: newId }, 201);
    }
    if (!validId(id)) return fail('店舗IDが不正です。');
    if (method === 'PATCH') {
      const d = await body(req); if (!validName(d.name)) return fail('店舗名を入力してください。');
      const r = await db.prepare('UPDATE stores SET name=? WHERE id=?').bind(d.name.trim(), id).run();
      return r.meta.changes ? json({ ok: true }) : fail('店舗がありません。', 404);
    }
    if (method === 'DELETE') {
      const old = await deletingVideos(db, 'store', id);
      const oldImages = await deletingImages(db, 'store', id);
      const r = await db.prepare('DELETE FROM stores WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); waitUntil(drainCleanup(env)); }
      return r.meta.changes ? json({ ok: true }) : fail('店舗がありません。', 404);
    }
  }
  if (type === 'areas') {
    if (!id && method === 'POST') {
      const d = await body(req);
      if (!validName(d.name) || !validId(d.storeId)) return fail('店舗とエリア名を指定してください。');
      const store = await db.prepare('SELECT id FROM stores WHERE id=?').bind(d.storeId).first();
      if (!store) return fail('店舗がありません。', 404);
      const newId = crypto.randomUUID();
      await db.prepare('INSERT INTO areas(id,store_id,name,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM areas WHERE store_id=?))')
        .bind(newId, d.storeId, d.name.trim(), d.storeId).run();
      return json({ ok: true, id: newId }, 201);
    }
    if (!validId(id)) return fail('エリアIDが不正です。');
    if (action === 'reorder' && method === 'POST') {
      const d = await body(req); const ids = d.ids;
      const current = (await db.prepare('SELECT id FROM machines WHERE area_id=?').bind(id).all()).results.map(r => r.id);
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every(x => current.includes(x))) return fail('並び順が一致していません。ページを再読み込みしてください。', 409);
      await db.batch(ids.map((mid, i) => db.prepare('UPDATE machines SET position=?,updated_at=datetime(\'now\') WHERE id=? AND area_id=?').bind(i + 1, mid, id)));
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const d = await body(req);
      if (!validName(d.name) || !validId(d.storeId)) return fail('店舗とエリア名を指定してください。');
      const r = await db.prepare('UPDATE areas SET name=?,store_id=? WHERE id=?').bind(d.name.trim(), d.storeId, id).run();
      return r.meta.changes ? json({ ok: true }) : fail('エリアがありません。', 404);
    }
    if (method === 'DELETE') {
      const old = await deletingVideos(db, 'area', id);
      const oldImages = await deletingImages(db, 'area', id);
      const r = await db.prepare('DELETE FROM areas WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); waitUntil(drainCleanup(env)); }
      return r.meta.changes ? json({ ok: true }) : fail('エリアがありません。', 404);
    }
  }
  if (type === 'machines') {
    if (!id && method === 'POST') {
      const d = await body(req);
      if (!validName(d.name)) return fail('マシン名を入力してください。');
      // Accept selected stores even when they do not yet have an area.
      // A store without an area gets a standard "マシン" area within the same D1 transaction.
      let areaIds, newAreas = [];
      if (d.storeSelections !== undefined) {
        const selections = d.storeSelections;
        if (!Array.isArray(selections) || selections.length < 1 || selections.length > 20 ||
          selections.some(s => !s || !validId(s.storeId) ||
            (s.areaId != null && !validId(s.areaId))) ||
          new Set(selections.map(s => s.storeId)).size !== selections.length) {
          return fail('登録する店舗を1～20件、重複せずに選択してください。');
        }
        const stores = (await db.prepare(`SELECT id FROM stores WHERE id IN (${selections.map(() => '?').join(',')})`)
          .bind(...selections.map(s => s.storeId)).all()).results;
        if (stores.length !== selections.length) return fail('選択した店舗が見つかりません。', 404);
        const provided = selections.filter(s => s.areaId != null);
        let existing = [];
        if (provided.length) {
          existing = (await db.prepare(`SELECT id,store_id AS storeId FROM areas WHERE id IN (${provided.map(() => '?').join(',')})`)
            .bind(...provided.map(s => s.areaId)).all()).results;
        }
        if (existing.length !== provided.length ||
          provided.some(s => !existing.some(a => a.id === s.areaId && a.storeId === s.storeId))) {
          return fail('店舗と配置エリアの組み合わせが正しくありません。');
        }
        const missingArea = selections.filter(s => s.areaId == null);
        if (missingArea.length) {
          const present = (await db.prepare(`SELECT store_id AS storeId FROM areas WHERE store_id IN (${missingArea.map(() => '?').join(',')})`)
            .bind(...missingArea.map(s => s.storeId)).all()).results;
          if (present.length) return fail('エリア情報が更新されています。画面を再読み込みしてください。', 409);
        }
        const generated = new Map(missingArea.map(s => [s.storeId, crypto.randomUUID()]));
        areaIds = selections.map(s => s.areaId ?? generated.get(s.storeId));
        newAreas = missingArea.map(s => db.prepare(`INSERT INTO areas(id,store_id,name,position)
          VALUES(?,?,'マシン',(SELECT COALESCE(MAX(position),0)+1 FROM areas WHERE store_id=?))`)
          .bind(generated.get(s.storeId), s.storeId, s.storeId));
      } else {
        // Older clients can continue registering a single area or areaIds list.
        areaIds = d.areaIds === undefined ? [d.areaId] : d.areaIds;
        if (!Array.isArray(areaIds) || !areaIds.length || areaIds.length > 20 ||
          areaIds.some(areaId => !validId(areaId)) ||
          new Set(areaIds).size !== areaIds.length) {
          return fail('登録先のエリアを1～20件、重複せずに指定してください。');
        }
        const found = (await db.prepare(`SELECT id,store_id AS storeId FROM areas WHERE id IN (${areaIds.map(() => '?').join(',')})`)
          .bind(...areaIds).all()).results;
        if (found.length !== areaIds.length) return fail('指定したエリアが見つかりません。', 404);
        if (new Set(found.map(area => area.storeId)).size !== areaIds.length) {
          return fail('1つの店舗につき、登録先エリアを1つ選択してください。');
        }
      }
      const v = fields(d);
      const ids = areaIds.map(() => crypto.randomUUID());
      const statements = areaIds.map((areaId, index) =>
        db.prepare(`INSERT INTO machines(id,area_id,name,position,overview,adjustment,instructions,tips,safety)
          VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM machines WHERE area_id=?),?,?,?,?,?)`)
          .bind(ids[index], areaId, d.name.trim(), areaId,
            v.overview, v.adjustment, v.instructions, v.tips, v.safety)
      );
      await db.batch([...newAreas, ...statements]);
      return json({ ok: true, id: ids[0], ids, areaIds }, 201);
    }
    if (!validId(id)) return fail('マシンIDが不正です。');
    if (action === 'images' && validId(index) && method === 'PUT') {
      const machine = await db.prepare('SELECT id FROM machines WHERE id=?').bind(id).first();
      if (!machine) return fail('マシンがありません。', 404);
      if (Number(req.headers.get('content-length') || 0) > MAX_MANUAL_IMAGE_BYTES) return fail('画像は2MiB以内にしてください。', 413);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAX_MANUAL_IMAGE_BYTES) return fail('画像は2MiB以内にしてください。', 413);
      if (logoMime(data) !== 'image/jpeg') return fail('切り取り済みのJPEG画像を選択してください。');
      await env.VIDEO_KV.put(`manual:${id}:${index}`, data);
      return json({ ok: true, imageId: index });
    }
    if (method === 'PATCH') {
      const d = await body(req); if (!validName(d.name) || !validId(d.areaId)) return fail('エリアとマシン名を指定してください。');
      const area = await db.prepare('SELECT id FROM areas WHERE id=?').bind(d.areaId).first(); if (!area) return fail('エリアがありません。', 404);
      const previous = await db.prepare('SELECT id,adjustment,instructions FROM machines WHERE id=?').bind(id).first();
      if (!previous) return fail('マシンがありません。', 404);
      const v = fields(d); const r = await db.prepare(`UPDATE machines SET area_id=?,name=?,overview=?,adjustment=?,instructions=?,tips=?,safety=?,updated_at=datetime('now') WHERE id=?`)
        .bind(d.areaId, d.name.trim(), v.overview, v.adjustment, v.instructions, v.tips, v.safety, id).run();
      if (!r.meta.changes) return fail('マシンがありません。', 404);
      const retained = new Set([...manualImageIds(v.adjustment), ...manualImageIds(v.instructions)]);
      const removed = imageJobs(previous).filter(job => !retained.has(job.id.slice(job.id.lastIndexOf(':') + 1)));
      if (removed.length) { await enqueueCleanup(db, removed); waitUntil(drainCleanup(env)); }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const old = await deletingVideos(db, 'machine', id);
      const oldImages = await deletingImages(db, 'machine', id);
      const r = await db.prepare('DELETE FROM machines WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); waitUntil(drainCleanup(env)); }
      return r.meta.changes ? json({ ok: true }) : fail('マシンがありません。', 404);
    }
  }
  return fail('操作が見つかりません。', 404);
}

export async function handleApi(context) {
  const { request: req, env } = context;
  if (!env.DB || !env.VIDEO_KV) return fail('Cloudflare D1とKVのバインディングが未設定です。', 503);
  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean);
  if (path[0] !== 'api') return fail('APIがありません。', 404);
  try {
    if (req.method === 'GET' && path.length === 2 && path[1] === 'catalog') return json(await catalog(env.DB));
    if ((req.method === 'GET' || req.method === 'HEAD') && path.length === 2 && path[1] === 'logo') return serveLogo(req, env);
    if ((req.method === 'GET' || req.method === 'HEAD') && path[1] === 'manual-image' && path.length === 4)
      return serveManualImage(req, env, path[2], path[3]);
    if (path[1] === 'admin') {
      if (!['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return fail('メソッドが許可されていません。', 405);
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) return fail('不正な送信元です。', 403);
      }
      return adminRequest(context, path.slice(2));
    }
    return fail('APIがありません。', 404);
  } catch (err) {
    if (err instanceof SyntaxError) return fail('JSONの形式が正しくありません。');
    if (err?.message && (/15,000|JSON形式|入力内容|手順画像/.test(err.message))) return fail(err.message);
    console.error('API failure', err?.message);
    return fail('サーバーでエラーが発生しました。', 500);
  }
}
