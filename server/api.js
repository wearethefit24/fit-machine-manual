// Cloudflare Pages Functions: D1 stores metadata; Workers KV stores instruction images and the site logo.
// Existing video records are retained only for cleanup when parent records are deleted.
const SESSION_SECONDS = 12 * 60 * 60;
const LOGO_KEY = 'site:logo';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_MANUAL_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_KEY = machineId => 'machine-thumb:' + machineId;
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

// A shared group is the single source of truth for manuals in several stores.
// On an existing D1 database the optional tables are created on first admin save;
// public reads continue to work before that first save without a manual migration.
async function ensureManualGroupTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS machine_manual_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    overview TEXT NOT NULL DEFAULT '', adjustment TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '', tips TEXT NOT NULL DEFAULT '',
    safety TEXT NOT NULL DEFAULT '', thumbnail_state INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS machine_manual_members (
    machine_id TEXT PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES machine_manual_groups(id) ON DELETE CASCADE)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_machine_manual_members_group ON machine_manual_members(group_id)').run();
}
function isLegacyDatabaseError(error) {
  return /no such table:\s*(machine_manual_groups|machine_manual_members)/i.test(String(error?.message || error));
}
async function groupForMachine(db, machineId) {
  try {
    return await db.prepare(`SELECT g.* FROM machine_manual_groups g
      JOIN machine_manual_members mm ON mm.group_id=g.id
      WHERE mm.machine_id=?`).bind(machineId).first();
  } catch (error) { if (isLegacyDatabaseError(error)) return null; throw error; }
}
async function groupMachines(db, groupId) {
  return (await db.prepare(`SELECT m.id,m.area_id AS areaId,a.store_id AS storeId,a.name AS areaName
    FROM machine_manual_members mm
    JOIN machines m ON m.id=mm.machine_id
    JOIN areas a ON a.id=m.area_id WHERE mm.group_id=?
    ORDER BY a.store_id`).bind(groupId).all()).results;
}
// Visibility is independent of the existing store/area/machine schemas.
// Existing D1 databases are upgraded automatically by the first admin toggle.
async function ensureVisibilityTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS visibility_settings (
    entity_type TEXT NOT NULL CHECK(entity_type IN ('store','area','machine','group')),
    entity_id TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
    PRIMARY KEY (entity_type,entity_id)
  )`).run();
}
async function visibilityMap(db) {
  try {
    const rows = (await db.prepare('SELECT entity_type AS entityType,entity_id AS entityId,is_public AS isPublic FROM visibility_settings').all()).results;
    return new Set(rows.filter(r => r.isPublic === 0).map(r => r.entityType + ':' + r.entityId));
  } catch (error) {
    if (/no such table:\s*visibility_settings/i.test(String(error?.message || error))) return new Set();
    throw error;
  }
}
async function isMachinePublic(db, machineId) {
  if (!validId(machineId)) return false;
  const rows = await db.prepare(`SELECT m.id,m.area_id AS areaId,a.store_id AS storeId
    FROM machines m JOIN areas a ON a.id=m.area_id WHERE m.id=?`).bind(machineId).first();
  if (!rows) return false;
  const hidden = await visibilityMap(db);
  if (hidden.has('store:' + rows.storeId) || hidden.has('area:' + rows.areaId)) return false;
  const group = await groupForMachine(db, machineId);
  return !hidden.has(group ? 'group:' + group.id : 'machine:' + machineId);
}
async function catalog(db, { admin = false } = {}) {
  const [storeRows, areaRows] = await Promise.all([
    db.prepare('SELECT id,name,position FROM stores ORDER BY position,name').all(),
    db.prepare('SELECT id,store_id AS storeId,name,position FROM areas ORDER BY position,name').all()
  ]);
  let machineRows;
  try {
    machineRows = await db.prepare(`SELECT m.id,m.area_id AS areaId,
      COALESCE(g.name,m.name) AS name,m.position,
      COALESCE(g.overview,m.overview) AS overview,
      COALESCE(g.adjustment,m.adjustment) AS adjustment,
      COALESCE(g.instructions,m.instructions) AS instructions,
      COALESCE(g.tips,m.tips) AS tips,
      COALESCE(g.safety,m.safety) AS safety,
      g.id AS groupId
      FROM machines m
      LEFT JOIN machine_manual_members mm ON mm.machine_id=m.id
      LEFT JOIN machine_manual_groups g ON g.id=mm.group_id
      ORDER BY m.position,m.name`).all();
  } catch(error) {
    if (!isLegacyDatabaseError(error)) throw error;
    machineRows = await db.prepare(`SELECT id,area_id AS areaId,name,position,
      overview,adjustment,instructions,tips,safety
      FROM machines ORDER BY position,name`).all();
  }
  const hidden = await visibilityMap(db);
  const stores = storeRows.results.map(row => ({
    ...row, isPublic: !hidden.has('store:' + row.id)
  }));
  const areas = areaRows.results.map(row => ({
    ...row, isPublic: !hidden.has('area:' + row.id)
  }));
  const machines = machineRows.results.map(row => ({
    ...row, isPublic: !(row.groupId
      ? hidden.has('group:' + row.groupId)
      : hidden.has('machine:' + row.id))
  }));
  if (admin) return {stores,areas,machines};
  const publicStores = stores.filter(store => store.isPublic);
  const publicStoreIds = new Set(publicStores.map(store=>store.id));
  const publicAreas = areas.filter(area =>
    area.isPublic && publicStoreIds.has(area.storeId));
  const publicAreaIds = new Set(publicAreas.map(area=>area.id));
  const publicMachines = machines.filter(machine =>
    machine.isPublic && publicAreaIds.has(machine.areaId));
  return {stores:publicStores,areas:publicAreas,machines:publicMachines};
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
        : job.video_id.startsWith('thumb:')
          ? THUMBNAIL_KEY(job.video_id.slice(6))
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
  // Thumbnail KV keys do not need a new D1 column, but must be queued for
  // deletion whenever a store, area or machine is removed.
  return rows.flatMap(machine => [
    ...imageJobs(machine),
    { id: 'thumb:' + machine.id, chunk_count: 1 }
  ]);
}
async function affectedManualGroupIds(db,scope,id) {
  const filter = scope==='store' ? 'a.store_id=?' : scope==='area' ? 'a.id=?' : 'm.id=?';
  try {
    const rows=(await db.prepare(`SELECT DISTINCT mm.group_id AS groupId
      FROM machine_manual_members mm
      JOIN machines m ON m.id=mm.machine_id
      JOIN areas a ON a.id=m.area_id WHERE ${filter}`).bind(id).all()).results;
    return rows.map(row=>row.groupId);
  } catch(error) { if(isLegacyDatabaseError(error)) return []; throw error; }
}
async function pruneEmptyManualGroups(db,groupIds) {
  for(const groupId of [...new Set(groupIds)]) {
    const active=await db.prepare('SELECT machine_id FROM machine_manual_members WHERE group_id=? LIMIT 1')
      .bind(groupId).first();
    if(active) continue;
    const group=await db.prepare('SELECT id,adjustment,instructions FROM machine_manual_groups WHERE id=?')
      .bind(groupId).first();
    if(!group) continue;
    await enqueueCleanup(db,[
      ...imageJobs(group),
      {id:'thumb:'+group.id,chunk_count:1}
    ]);
    await db.prepare('DELETE FROM machine_manual_groups WHERE id=?').bind(groupId).run();
  }
}
async function serveManualImage(req, env, machineId, imageId, admin = false) {
  if (!validId(machineId) || !validId(imageId)) return fail('画像がありません。', 404);
  if (!admin && !(await isMachinePublic(env.DB,machineId))) return fail('画像がありません。', 404);
  const machine = await env.DB.prepare('SELECT adjustment,instructions FROM machines WHERE id=?').bind(machineId).first();
  if(!machine) return fail('画像がありません。',404);
  const group = await groupForMachine(env.DB,machineId);
  if(!imagesFromMachine(group || machine).includes(imageId)) return fail('画像がありません。',404);
  let data = group
    ? await env.VIDEO_KV.get(`manual:${group.id}:${imageId}`,'arrayBuffer')
    : await env.VIDEO_KV.get(`manual:${machineId}:${imageId}`,'arrayBuffer');
  // Previously uploaded photos remain visible when old per-store manuals are
  // first linked into a shared group; no destructive KV migration is required.
  if(!data && group) {
    const members=await groupMachines(env.DB,group.id);
    for(const member of [machineId,...members.map(m=>m.id).filter(id=>id!==machineId)]){
      data=await env.VIDEO_KV.get(`manual:${member}:${imageId}`,'arrayBuffer');
      if(data)break;
    }
  }
  if (!data) return fail('画像がありません。', 404);
  return new Response(req.method === 'HEAD' ? null : data, {
    status: 200, headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}
async function serveMachineThumbnail(req, env, machineId, admin = false) {
  if (!validId(machineId)) return fail('画像がありません。', 404);
  if (!admin && !(await isMachinePublic(env.DB,machineId))) return fail('画像がありません。', 404);
  const machine = await env.DB.prepare('SELECT id FROM machines WHERE id=?')
    .bind(machineId).first();
  if (!machine) return fail('画像がありません。', 404);
  const group = await groupForMachine(env.DB,machineId);
  if(group?.thumbnail_state===-1) return fail('画像がありません。',404);
  let data=group
    ? await env.VIDEO_KV.get(THUMBNAIL_KEY(group.id),'arrayBuffer')
    : await env.VIDEO_KV.get(THUMBNAIL_KEY(machineId),'arrayBuffer');
  if(!data && group && group.thumbnail_state===0) {
    const members=await groupMachines(env.DB,group.id);
    for(const member of [machineId,...members.map(m=>m.id).filter(id=>id!==machineId)]){
      data=await env.VIDEO_KV.get(THUMBNAIL_KEY(member),'arrayBuffer');
      if(data)break;
    }
  }
  if(!data) return fail('画像がありません。',404);
  return new Response(req.method === 'HEAD' ? null : data, {
    status: 200,
    headers: {
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
  if (parts[0] === 'catalog' && method === 'GET') return json(await catalog(env.DB,{admin:true}));
  if (parts[0] === 'manual-image' && parts.length===3 && (method==='GET' || method==='HEAD'))
    return serveManualImage(req,env,parts[1],parts[2],true);
  if (parts[0] === 'machine-thumbnail' && parts.length===2 && (method==='GET' || method==='HEAD'))
    return serveMachineThumbnail(req,env,parts[1],true);
  if (parts[0] === 'visibility' && method === 'POST') {
    const d=await body(req);
    const entityType=d.entityType;
    const ids=d.ids;
    if (!['store','area','machine','group'].includes(entityType) ||
        typeof d.isPublic!=='boolean' || !Array.isArray(ids) ||
        ids.length<1 || ids.length>100 || ids.some(id=>!validId(id)) ||
        new Set(ids).size!==ids.length)
      return fail('公開設定の対象が不正です。');
    const table={store:'stores',area:'areas',machine:'machines',group:'machine_manual_groups'}[entityType];
    const found=(await env.DB.prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(()=>'?').join(',')})`)
      .bind(...ids).all()).results;
    if(found.length!==ids.length) return fail('公開設定の対象が見つかりません。',404);
    await ensureVisibilityTable(env.DB);
    await env.DB.batch(ids.map(id=>d.isPublic
      ? env.DB.prepare('DELETE FROM visibility_settings WHERE entity_type=? AND entity_id=?')
        .bind(entityType,id)
      : env.DB.prepare(`INSERT INTO visibility_settings(entity_type,entity_id,is_public)
          VALUES(?,?,0) ON CONFLICT(entity_type,entity_id)
          DO UPDATE SET is_public=0`).bind(entityType,id)
    ));
    return json({ok:true,entityType,ids,isPublic:d.isPublic});
  }

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


  if (type === 'manual-groups') {
    if (!id && method === 'POST') {
      const d = await body(req);
      if (!validName(d.name) || !validName(d.areaName))
        return fail('マシン名とエリアを指定してください。');
      // New editor sends one placement per store, with independent area choices.
      // Keep the former storeIds + areaName API valid for old clients.
      const supplied = d.storeSelections !== undefined ? d.storeSelections :
        Array.isArray(d.storeIds) ? d.storeIds.map(storeId=>({
          storeId,areaId:null,areaName:d.areaName
        })) : null;
      if (!Array.isArray(supplied) || !supplied.length || supplied.length > 20 ||
          supplied.some(row=>!row || !validId(row.storeId) ||
            (row.areaId != null && !validId(row.areaId)) ||
            (row.areaId == null && !validName(row.areaName))) ||
          new Set(supplied.map(row=>row.storeId)).size !== supplied.length)
        return fail('店舗と各店舗の配置エリアを1～20件指定してください。');
      const storeIds=supplied.map(row=>row.storeId);
      const v = fields(d);
      await ensureManualGroupTables(db);
      const stores = (await db.prepare(`SELECT id FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`)
        .bind(...storeIds).all()).results;
      if (stores.length !== storeIds.length) return fail('選択した店舗が見つかりません。',404);
      let groupId = d.groupId || null;
      let originalMachineName = d.name.trim();
      let current = [];
      if (groupId) {
        if (!validId(groupId)) return fail('取扱説明書IDが不正です。');
        const exists = await db.prepare('SELECT id FROM machine_manual_groups WHERE id=?').bind(groupId).first();
        if (!exists) return fail('取扱説明書が見つかりません。',404);
        originalMachineName = (await db.prepare('SELECT name FROM machine_manual_groups WHERE id=?')
          .bind(groupId).first())?.name || originalMachineName;
        current = await groupMachines(db,groupId);
      } else if (d.seedMachineId != null) {
        if (!validId(d.seedMachineId)) return fail('編集するマシンが不正です。');
        const base = await db.prepare(`SELECT m.*,a.name AS areaName,a.store_id AS storeId
          FROM machines m JOIN areas a ON m.area_id=a.id WHERE m.id=?`).bind(d.seedMachineId).first();
        if (!base) return fail('編集するマシンが見つかりません。',404);
        originalMachineName = base.name;
        const linked = await groupForMachine(db,d.seedMachineId);
        if (linked) {
          groupId = linked.id;
          current = await groupMachines(db,groupId);
        } else {
          // Recover copies created by the old multi-store editor only when all
          // text fields and the machine name match exactly. Never merge unrelated
          // machines simply because they happen to have the same name.
          const candidates = (await db.prepare(`SELECT m.id,m.area_id AS areaId,a.store_id AS storeId,a.name AS areaName
            FROM machines m JOIN areas a ON m.area_id=a.id
            LEFT JOIN machine_manual_members mm ON mm.machine_id=m.id
            WHERE mm.machine_id IS NULL AND m.name=?
            AND m.overview=? AND m.adjustment=? AND m.instructions=?
            AND m.tips=? AND m.safety=? ORDER BY m.created_at,m.id`)
            .bind(base.name,base.overview,base.adjustment,
              base.instructions,base.tips,base.safety).all()).results;
          const storeSet = new Set();
          current = candidates.filter(item => {
            if (storeSet.has(item.storeId)) return false;
            storeSet.add(item.storeId); return true;
          });
          if (!current.some(item=>item.id===d.seedMachineId)) {
            const selected = current.findIndex(item=>item.storeId===base.storeId);
            if (selected >= 0) current.splice(selected,1);
            current.push({id:base.id,areaId:base.area_id,storeId:base.storeId,areaName:base.areaName});
          }
        }
      }
      if (!groupId) groupId=crypto.randomUUID();
      // Resolve each store's chosen area without changing other stores' placement.
      const areaRows=(await db.prepare(`SELECT id,store_id AS storeId,name
        FROM areas WHERE store_id IN (${storeIds.map(()=>'?').join(',')})
        ORDER BY position,id`).bind(...storeIds).all()).results;
      const matchingMap=new Map();
      const generatedAreas=[];
      for(const row of supplied){
        const available=areaRows.filter(area=>area.storeId===row.storeId);
        if(row.areaId != null){
          const existing=available.find(area=>area.id===row.areaId);
          if(!existing) return fail('店舗のエリアが変更されました。再読み込みしてください。',409);
          matchingMap.set(row.storeId,existing.id);
        } else {
          const areaName=row.areaName.trim();
          const existing=available.find(area=>area.name.trim()===areaName);
          if(existing) matchingMap.set(row.storeId,existing.id);
          else {
            const areaId=crypto.randomUUID();
            generatedAreas.push({storeId:row.storeId,areaId,areaName});
            matchingMap.set(row.storeId,areaId);
          }
        }
      }
      const currentByStore = new Map(current.map(item=>[item.storeId,item]));
      const reusableByStore = new Map();
      // Explicitly selecting another store while editing can link its existing
      // standalone copy rather than creating a duplicate and breaking its QR.
      if(d.groupId || d.seedMachineId) {
        const options=(await db.prepare(`SELECT m.id,a.store_id AS storeId FROM machines m
          JOIN areas a ON a.id=m.area_id
          LEFT JOIN machine_manual_members mm ON mm.machine_id=m.id
          WHERE mm.machine_id IS NULL AND m.name=?
          AND a.store_id IN (${storeIds.map(() => '?').join(',')})
          ORDER BY m.created_at,m.id`)
          .bind(originalMachineName,...storeIds).all()).results;
        const byStore=new Map();
        for(const row of options){
          if(!byStore.has(row.storeId)) byStore.set(row.storeId,[]);
          byStore.get(row.storeId).push(row.id);
        }
        for(const [storeId,ids] of byStore) if(ids.length===1) reusableByStore.set(storeId,ids[0]);
      }
      const placements = storeIds.map(storeId=>({
        storeId,areaId:matchingMap.get(storeId),
        machineId:currentByStore.get(storeId)?.id || reusableByStore.get(storeId) || crypto.randomUUID()
      }));
      const keptIds = new Set(placements.map(item=>item.machineId));
      const removed = current.filter(item=>!keptIds.has(item.id));
      // Existing members keep their own legacy KV image keys and public/admin
      // image handlers already fall back to those keys. Copying every image
      // and probing every store on *every save* was wasteful and could exceed
      // Cloudflare Free subrequest limits. Migration is only needed when a
      // member is about to be removed and its old media would be deleted.
      const sourceIds=removed.map(item=>item.id);
      const existingGroup=await db.prepare('SELECT thumbnail_state FROM machine_manual_groups WHERE id=?')
        .bind(groupId).first();
      if(sourceIds.length){
        const referenced=new Set([...manualImageIds(v.adjustment),
          ...manualImageIds(v.instructions)]);
        for(const imageId of referenced){
          const sharedKey=`manual:${groupId}:${imageId}`;
          if(await env.VIDEO_KV.get(sharedKey,'arrayBuffer')) continue;
          for(const oldId of sourceIds){
            const photo=await env.VIDEO_KV.get(`manual:${oldId}:${imageId}`,'arrayBuffer');
            if(photo){
              await env.VIDEO_KV.put(sharedKey,photo);
              break;
            }
          }
        }
      }
      let copiedLegacyThumbnail=false;
      if(sourceIds.length && existingGroup?.thumbnail_state!==-1 &&
         !await env.VIDEO_KV.get(THUMBNAIL_KEY(groupId),'arrayBuffer')){
        for(const oldId of sourceIds){
          const thumbnail=await env.VIDEO_KV.get(THUMBNAIL_KEY(oldId),'arrayBuffer');
          if(thumbnail){
            await env.VIDEO_KV.put(THUMBNAIL_KEY(groupId),thumbnail);
            copiedLegacyThumbnail=true;
            break;
          }
        }
      }
      const obsoleteImages = [];
      const obsoleteVideos = [];
      for(const row of removed){
        obsoleteImages.push(...await deletingImages(db,'machine',row.id));
        obsoleteVideos.push(...await deletingVideos(db,'machine',row.id));
      }
      const statements = [];
      // When a legacy hidden manual is consolidated, it must not accidentally
      // become public simply because its data moves into a shared group.
      const existingManualGroup = await db.prepare('SELECT id FROM machine_manual_groups WHERE id=?')
        .bind(groupId).first();
      if (!existingManualGroup && current.length) {
        const previouslyHidden = await visibilityMap(db);
        if (current.some(member => previouslyHidden.has('machine:' + member.id))) {
          statements.push(db.prepare(`INSERT INTO visibility_settings
            (entity_type,entity_id,is_public) VALUES('group',?,0)`).bind(groupId));
        }
      }
      if(existingManualGroup){
        statements.push(db.prepare(`UPDATE machine_manual_groups SET name=?,overview=?,adjustment=?,
          instructions=?,tips=?,safety=?,updated_at=datetime('now') WHERE id=?`)
          .bind(d.name.trim(),v.overview,v.adjustment,v.instructions,v.tips,v.safety,groupId));
      } else {
        statements.push(db.prepare(`INSERT INTO machine_manual_groups
          (id,name,overview,adjustment,instructions,tips,safety) VALUES(?,?,?,?,?,?,?)`)
          .bind(groupId,d.name.trim(),v.overview,v.adjustment,v.instructions,v.tips,v.safety));
      }
      for(const area of generatedAreas) statements.push(
        db.prepare(`INSERT INTO areas(id,store_id,name,position)
          VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM areas WHERE store_id=?))`)
          .bind(area.areaId,area.storeId,area.areaName,area.storeId));
      for(const placement of placements){
        if(currentByStore.get(placement.storeId)?.id===placement.machineId ||
           reusableByStore.get(placement.storeId)===placement.machineId){
          statements.push(db.prepare(`UPDATE machines SET area_id=?,updated_at=datetime('now') WHERE id=?`)
            .bind(placement.areaId,placement.machineId));
        } else {
          statements.push(db.prepare(`INSERT INTO machines(id,area_id,name,position,overview,adjustment,instructions,tips,safety)
            VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM machines WHERE area_id=?),?,?,?,?,?)`)
            .bind(placement.machineId,placement.areaId,d.name.trim(),placement.areaId,
              v.overview,v.adjustment,v.instructions,v.tips,v.safety));
        }
        statements.push(db.prepare(`INSERT INTO machine_manual_members(machine_id,group_id)
          VALUES(?,?) ON CONFLICT(machine_id) DO UPDATE SET group_id=excluded.group_id`)
          .bind(placement.machineId,groupId));
      }
      for(const row of removed) statements.push(db.prepare('DELETE FROM machines WHERE id=?').bind(row.id));
      await db.batch(statements);
      if(copiedLegacyThumbnail)
        await db.prepare('UPDATE machine_manual_groups SET thumbnail_state=1 WHERE id=?')
          .bind(groupId).run();
      if(obsoleteImages.length || obsoleteVideos.length) {
        await enqueueCleanup(db,[...obsoleteImages,...obsoleteVideos]);
        waitUntil(drainCleanup(env));
      }
      return json({ok:true,groupId,ids:placements.map(p=>p.machineId),
        areaIds:placements.map(p=>p.areaId),storeIds},d.groupId||d.seedMachineId?200:201);
    }
    if (!validId(id)) return fail('取扱説明書IDが不正です。');
    if (method === 'DELETE' && !action) {
      const existing=await db.prepare('SELECT id FROM machine_manual_groups WHERE id=?').bind(id).first();
      if(!existing) return fail('取扱説明書が見つかりません。',404);
      const members=await groupMachines(db,id);
      const previousMedia=[];
      for(const member of members){
        previousMedia.push(...await deletingImages(db,'machine',member.id));
        previousMedia.push(...await deletingVideos(db,'machine',member.id));
      }
      if(members.length) await db.batch(members.map(member=>
        db.prepare('DELETE FROM machines WHERE id=?').bind(member.id)));
      await enqueueCleanup(db,previousMedia);
      await pruneEmptyManualGroups(db,[id]);
      waitUntil(drainCleanup(env));
      return json({ok:true,deleted:members.length});
    }

    if (action === 'images' && validId(index) && method === 'PUT') {
      const exists = await db.prepare('SELECT id FROM machine_manual_groups WHERE id=?').bind(id).first();
      if (!exists) return fail('取扱説明書がありません。',404);
      if (Number(req.headers.get('content-length')||0)>MAX_MANUAL_IMAGE_BYTES)
        return fail('画像は2MiB以内にしてください。',413);
      const data=await req.arrayBuffer();
      if(!data.byteLength||data.byteLength>MAX_MANUAL_IMAGE_BYTES)
        return fail('画像は2MiB以内にしてください。',413);
      if(logoMime(data)!=='image/jpeg') return fail('JPEG画像を選択してください。');
      await env.VIDEO_KV.put(`manual:${id}:${index}`,data);
      return json({ok:true,imageId:index});
    }
    if (action === 'thumbnail' && !index && (method === 'PUT' || method === 'DELETE')) {
      const exists = await db.prepare('SELECT id FROM machine_manual_groups WHERE id=?').bind(id).first();
      if(!exists) return fail('取扱説明書がありません。',404);
      if(method==='DELETE'){
        await db.prepare('UPDATE machine_manual_groups SET thumbnail_state=-1 WHERE id=?').bind(id).run();
        await env.VIDEO_KV.delete(THUMBNAIL_KEY(id));
        return json({ok:true});
      }
      if(Number(req.headers.get('content-length')||0)>MAX_THUMBNAIL_BYTES)
        return fail('画像は2MiB以内にしてください。',413);
      const data=await req.arrayBuffer();
      if(!data.byteLength||data.byteLength>MAX_THUMBNAIL_BYTES)
        return fail('画像は2MiB以内にしてください。',413);
      if(logoMime(data)!=='image/jpeg') return fail('JPEG画像を選択してください。');
      await env.VIDEO_KV.put(THUMBNAIL_KEY(id),data);
      await db.prepare('UPDATE machine_manual_groups SET thumbnail_state=1 WHERE id=?').bind(id).run();
      return json({ok:true});
    }
  }
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
      const affectedGroups = await affectedManualGroupIds(db,'store',id);
      const r = await db.prepare('DELETE FROM stores WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); await pruneEmptyManualGroups(db,affectedGroups); waitUntil(drainCleanup(env)); }
      return r.meta.changes ? json({ ok: true }) : fail('店舗がありません。', 404);
    }
  }
  if (type === 'areas') {
    if (!id && method === 'POST') {
      const d = await body(req);
      if (!validName(d.name)) return fail('エリア名を入力してください。');
      // One independent area per selected store, created together in a D1 transaction.
      // Keep supporting storeId for older clients.
      const storeIds = d.storeIds === undefined ? [d.storeId] : d.storeIds;
      if (!Array.isArray(storeIds) || !storeIds.length || storeIds.length > 20 ||
          storeIds.some(storeId => !validId(storeId)) ||
          new Set(storeIds).size !== storeIds.length) {
        return fail('登録先の店舗を1～20件、重複せずに選択してください。');
      }
      const found = (await db.prepare(`SELECT id FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`)
        .bind(...storeIds).all()).results;
      if (found.length !== storeIds.length) return fail('選択した店舗が見つかりません。', 404);
      const ids = storeIds.map(() => crypto.randomUUID());
      await db.batch(storeIds.map((storeId, index) =>
        db.prepare('INSERT INTO areas(id,store_id,name,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM areas WHERE store_id=?))')
          .bind(ids[index], storeId, d.name.trim(), storeId)
      ));
      return json({ ok: true, id: ids[0], ids, storeIds }, 201);
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
      const affectedGroups = await affectedManualGroupIds(db,'area',id);
      const r = await db.prepare('DELETE FROM areas WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); await pruneEmptyManualGroups(db,affectedGroups); waitUntil(drainCleanup(env)); }
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
        // Exactly one area category can be registered per machine across stores.
        // Older clients without areaName infer the category from their destination.
        const selections = d.storeSelections;
        const hasAreaName = d.areaName !== undefined;
        if (hasAreaName && !validName(d.areaName)) return fail('エリアを選択してください。');
        let selectedAreaName = hasAreaName ? d.areaName.trim() : '';
        if (!Array.isArray(selections) || selections.length < 1 || selections.length > 20 ||
          selections.some(s => !s || !validId(s.storeId) ||
            (s.areaId != null && !validId(s.areaId))) ||
          new Set(selections.map(s => s.storeId)).size !== selections.length) {
          return fail('登録先の店舗を1～20件、重複せずに選択してください。');
        }
        const storeIds = [...new Set(selections.map(s => s.storeId))];
        const stores = (await db.prepare(`SELECT id FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`)
          .bind(...storeIds).all()).results;
        if (stores.length !== storeIds.length) return fail('選択した店舗が見つかりません。', 404);
        const provided = selections.filter(s => s.areaId != null);
        let existing = [];
        if (provided.length) {
          existing = (await db.prepare(`SELECT id,store_id AS storeId,name FROM areas WHERE id IN (${provided.map(() => '?').join(',')})`)
            .bind(...provided.map(s => s.areaId)).all()).results;
        }
        if (!selectedAreaName) selectedAreaName = existing[0]?.name.trim() || 'マシン';
        if (existing.length !== provided.length ||
          provided.some(s => !existing.some(a => a.id === s.areaId && a.storeId === s.storeId &&
            a.name.trim() === selectedAreaName))) {
          return fail('マシンは1種類のエリアだけに登録できます。店舗とエリアをご確認ください。');
        }
        const missingArea = selections.filter(s => s.areaId == null);
        if (missingArea.length) {
          const missingStoreIds = missingArea.map(s => s.storeId);
          const existingSql = `SELECT store_id AS storeId FROM areas WHERE store_id IN (${missingStoreIds.map(() => '?').join(',')}) AND name=?`;
          const present = (await db.prepare(existingSql)
            .bind(...missingStoreIds, selectedAreaName).all()).results;
          if (present.length) return fail('エリア情報が更新されています。画面を再読み込みしてください。', 409);
        }
        const generated = new Map(missingArea.map(s => [s.storeId, crypto.randomUUID()]));
        areaIds = selections.map(s => s.areaId ?? generated.get(s.storeId));
        newAreas = missingArea.map(s => db.prepare(`INSERT INTO areas(id,store_id,name,position)
          VALUES(?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM areas WHERE store_id=?))`)
          .bind(generated.get(s.storeId), s.storeId, selectedAreaName, s.storeId));
      } else {
        // Older clients can continue registering an areaId or areaIds list.
        areaIds = d.areaIds === undefined ? [d.areaId] : d.areaIds;
        if (!Array.isArray(areaIds) || !areaIds.length || areaIds.length > 20 ||
          areaIds.some(areaId => !validId(areaId)) ||
          new Set(areaIds).size !== areaIds.length) {
          return fail('登録先のエリアを1～20件、重複せずに指定してください。');
        }
        const found = (await db.prepare(`SELECT id,store_id AS storeId,name FROM areas WHERE id IN (${areaIds.map(() => '?').join(',')})`)
          .bind(...areaIds).all()).results;
        if (found.length !== areaIds.length) return fail('指定したエリアが見つかりません。', 404);
        if (new Set(found.map(area => area.storeId)).size !== areaIds.length ||
            new Set(found.map(area => area.name.trim())).size !== 1) {
          return fail('マシンは各店舗の同じ種類のエリアにのみ登録できます。');
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
    if (action === 'thumbnail' && !index && (method === 'PUT' || method === 'DELETE')) {
      const machine = await db.prepare('SELECT id FROM machines WHERE id=?').bind(id).first();
      if (!machine) return fail('マシンがありません。', 404);
      if (method === 'DELETE') {
        await env.VIDEO_KV.delete(THUMBNAIL_KEY(id));
        return json({ ok: true });
      }
      if (Number(req.headers.get('content-length') || 0) > MAX_THUMBNAIL_BYTES)
        return fail('画像は2MiB以内にしてください。', 413);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAX_THUMBNAIL_BYTES)
        return fail('画像は2MiB以内にしてください。', 413);
      if (logoMime(data) !== 'image/jpeg')
        return fail('正方形に切り取り済みのJPEG画像を選択してください。');
      await env.VIDEO_KV.put(THUMBNAIL_KEY(id), data);
      return json({ ok: true });
    }
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
      const affectedGroups = await affectedManualGroupIds(db,'machine',id);
      const r = await db.prepare('DELETE FROM machines WHERE id=?').bind(id).run();
      if (r.meta.changes) { await enqueueCleanup(db, [...old, ...oldImages]); await pruneEmptyManualGroups(db,affectedGroups); waitUntil(drainCleanup(env)); }
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
    if ((req.method === 'GET' || req.method === 'HEAD') && path[1] === 'machine-thumbnail' && path.length === 3)
      return serveMachineThumbnail(req, env, path[2]);
    if (path[1] === 'admin') {
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return fail('メソッドが許可されていません。', 405);
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
