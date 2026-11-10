import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { handleApi } from '../server/api.js';

class MockPrepared {
  constructor(stmt) { this.stmt = stmt; this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return Promise.resolve(this.stmt.get(...this.args) || null); }
  all() { return Promise.resolve({ results: this.stmt.all(...this.args) }); }
  run() { const result = this.stmt.run(...this.args); return Promise.resolve({ meta: { changes: Number(result.changes) } }); }
}
class MockD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) { return new MockPrepared(this.db.prepare(sql)); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.db.exec('COMMIT'); return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
class MockKV {
  constructor() { this.values = new Map(); }
  async put(k, v) { this.values.set(k, v.slice(0)); }
  async get(k, type) { return this.values.get(k) || null; }
  async delete(k) { this.values.delete(k); }
}
function fixture() {
  const env = { DB: new MockD1(), VIDEO_KV: new MockKV(), ADMIN_PASSWORD: 'this-is-a-long-strong-password', ADMIN_SESSION_SECRET: 'very_long_secret_string_of_more_than_32_characters' };
  let cookie = '';
  async function fetchApi(path, method='GET', value, headers = {}) {
    const isBinary = value instanceof ArrayBuffer;
    const requestHeaders = new Headers(headers);
    if (cookie) requestHeaders.set('cookie', cookie);
    if (method !== 'GET' && method !== 'HEAD') requestHeaders.set('origin', 'https://fit.example');
    if (value !== undefined && !isBinary) requestHeaders.set('content-type', 'application/json');
    const req = new Request('https://fit.example' + path, { method, headers: requestHeaders, body: value === undefined ? undefined : isBinary ? value : JSON.stringify(value) });
    const tasks = [];
    const res = await handleApi({ request: req, env, waitUntil: p => tasks.push(p) });
    if (res.headers.has('set-cookie') && !res.headers.get('set-cookie').includes('Max-Age=0')) cookie = res.headers.get('set-cookie').split(';')[0];
    if (tasks.length) await Promise.all(tasks);
    return res;
  }
  return { env, fetchApi };
}

test('public reading is allowed and admin changes require authentication', async () => {
  const { fetchApi } = fixture();
  const catalog = await fetchApi('/api/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), {stores:[],areas:[],machines:[]});
  assert.equal((await fetchApi('/api/admin/stores', 'POST', {name:'Test'})).status, 401);
  assert.equal((await fetchApi('/api/admin/login','POST',{password:'wrong'})).status, 401);
  assert.equal((await fetchApi('/api/admin/login','POST',{password:'this-is-a-long-strong-password'})).status, 200);
  assert.equal((await fetchApi('/api/admin/session')).status, 200);
});

test('store, area, machine CRUD, ordering, QR direct video range and cascade deletion', async () => {
  const { env, fetchApi } = fixture();
  await fetchApi('/api/admin/login', 'POST', { password: env.ADMIN_PASSWORD });
  const store1 = (await (await fetchApi('/api/admin/stores','POST',{name:'江古田店'})).json()).id;
  const area1 = (await (await fetchApi('/api/admin/areas','POST',{name:'ウェイト',storeId:store1})).json()).id;
  const values = { areaId:area1,name:'チェストプレス',overview:'胸を鍛える',adjustment:'座席調整',instructions:'1. 構える',tips:'ゆっくり動かす',safety:'無理はしない' };
  const m1 = (await (await fetchApi('/api/admin/machines','POST',values)).json()).id;
  const m2 = (await (await fetchApi('/api/admin/machines','POST',{...values,name:'ラットプル'})).json()).id;
  const order = await fetchApi(`/api/admin/areas/${area1}/reorder`,'POST',{ids:[m2,m1]});
  assert.equal(order.status, 200);
  let data = await (await fetchApi('/api/catalog')).json();
  assert.deepEqual(data.machines.map(m=>m.name), ['ラットプル','チェストプレス']);
  assert.equal(data.machines.find(m=>m.id===m1).overview,'胸を鍛える');
  const init = await fetchApi(`/api/admin/machines/${m1}/video/init`,'POST',{filename:'usage.mp4',mimeType:'video/mp4',size:14});
  assert.equal(init.status, 201);
  const video = await init.json();
  assert.equal(video.chunkCount, 1);
  assert.equal((await fetchApi(`/api/admin/videos/${video.videoId}/chunks/0`,'PUT',new TextEncoder().encode('VIDEO_FILE_123').buffer)).status, 200);
  assert.equal((await fetchApi(`/api/admin/videos/${video.videoId}/finish`,'POST',{})).status, 200);
  data = await (await fetchApi('/api/catalog')).json();
  assert.equal(data.machines.find(m=>m.id===m1).videoId,video.videoId);
  const getVideo = await fetchApi(`/api/video/${video.videoId}`,'GET',undefined,{range:'bytes=2-6'});
  assert.equal(getVideo.status,206);
  assert.equal(getVideo.headers.get('content-range'),'bytes 2-6/14');
  assert.equal(await getVideo.text(),'DEO_F');
  assert.equal((await fetchApi(`/api/admin/stores/${store1}`,'DELETE')).status, 200);
  data = await (await fetchApi('/api/catalog')).json();
  assert.equal(data.stores.length,0);
  assert.equal(data.machines.length,0);
  assert.equal(env.VIDEO_KV.values.size,0);
});

test('mass deletion is completed in KV batches without exceeding the per-request budget', async () => {
  const { env, fetchApi } = fixture();
  await fetchApi('/api/admin/login', 'POST', { password: env.ADMIN_PASSWORD });
  const store = (await (await fetchApi('/api/admin/stores','POST',{name:'削除対象'})).json()).id;
  const area = (await (await fetchApi('/api/admin/areas','POST',{storeId:store,name:'A'})).json()).id;
  const machine = (await (await fetchApi('/api/admin/machines','POST',{areaId:area,name:'動画100個',overview:'',adjustment:'',instructions:'',tips:'',safety:''})).json()).id;
  for (let i = 0; i < 65; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    await env.DB.prepare("INSERT INTO videos(id,machine_id,filename,mime_type,byte_size,chunk_size,chunk_count,status) VALUES(?,?,?,?,?,?,?,'ready')")
      .bind(id,machine,'video.mp4','video/mp4',1,8*1024*1024,1).run();
    await env.VIDEO_KV.put(`video:${id}:0`, new ArrayBuffer(1));
  }
  assert.equal((await fetchApi(`/api/admin/stores/${store}`,'DELETE')).status,200);
  let pending = (await env.DB.prepare('SELECT count(*) AS count FROM video_cleanup_jobs').first()).count;
  assert.ok(pending > 0);
  for (let i=0;i<6;i++) {
    const response = await fetchApi('/api/admin/maintenance','POST',{});
    const result = await response.json();
    if (!result.remaining) break;
  }
  assert.equal(env.VIDEO_KV.values.size,0);
  assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM video_cleanup_jobs').first()).count,0);
});
