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
  constructor() { this.values = new Map(); this.meta = new Map(); }
  async put(k, v, options = {}) { this.values.set(k, v.slice(0)); if (options.metadata) this.meta.set(k, options.metadata); }
  async get(k, type) { return this.values.get(k) || null; }
  async getWithMetadata(k, type) { return { value: this.values.get(k) || null, metadata: this.meta.get(k) || null }; }
  async delete(k) { this.values.delete(k); this.meta.delete(k); }
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

test('store, area, machine CRUD, ordering, video retirement and cascade deletion', async () => {
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
  // New videos cannot be uploaded, finalized, or watched.
  const videoId = '123e4567-e89b-42d3-a456-426614174009';
  assert.equal((await fetchApi(`/api/admin/machines/${m1}/video/init`,'POST',
    {filename:'usage.mp4',mimeType:'video/mp4',size:14})).status, 404);
  assert.equal((await fetchApi(`/api/admin/videos/${videoId}/chunks/0`,'PUT',
    new TextEncoder().encode('VIDEO_FILE_123').buffer)).status, 404);
  assert.equal((await fetchApi(`/api/admin/videos/${videoId}/finish`,'POST',{})).status, 404);
  assert.equal((await fetchApi(`/api/video/${videoId}`)).status, 404);
  // Legacy video bytes are retained until the parent machine is explicitly deleted.
  await env.DB.prepare("INSERT INTO videos(id,machine_id,filename,mime_type,byte_size,chunk_size,chunk_count,status) VALUES(?,?,?,?,?,?,?,'ready')")
    .bind(videoId,m1,'legacy.mp4','video/mp4',14,8*1024*1024,1).run();
  await env.DB.prepare('UPDATE machines SET video_id=? WHERE id=?').bind(videoId,m1).run();
  await env.VIDEO_KV.put(`video:${videoId}:0`, new TextEncoder().encode('VIDEO_FILE_123').buffer);
  data = await (await fetchApi('/api/catalog')).json();
  assert.equal(Object.hasOwn(data.machines.find(m=>m.id===m1),'videoId'),false);
  assert.equal(Object.hasOwn(data.machines.find(m=>m.id===m1),'videoFilename'),false);
  assert.equal((await fetchApi(`/api/video/${videoId}`)).status, 404);
  assert.equal(env.VIDEO_KV.values.has(`video:${videoId}:0`),true);
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

test('logo stays public but uploading and deleting require an authenticated admin', async () => {
  const { env, fetchApi } = fixture();
  assert.equal((await fetchApi('/api/logo')).status, 404);
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer;
  assert.equal((await fetchApi('/api/admin/logo', 'PUT', bytes)).status, 401);
  await fetchApi('/api/admin/login', 'POST', { password: env.ADMIN_PASSWORD });
  const bad = await fetchApi('/api/admin/logo', 'PUT', new TextEncoder().encode('<svg/>').buffer);
  assert.equal(bad.status, 400);
  assert.equal((await fetchApi('/api/admin/logo', 'PUT', bytes)).status, 200);
  const publicLogo = await fetchApi('/api/logo');
  assert.equal(publicLogo.status, 200);
  assert.equal(publicLogo.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await publicLogo.arrayBuffer()), new Uint8Array(bytes));
  const head = await fetchApi('/api/logo', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await fetchApi('/api/admin/logo', 'DELETE')).status, 200);
  assert.equal((await fetchApi('/api/logo')).status, 404);
});

test('cropped manual photos are scoped to machines, authenticated on upload and cleaned up on removal', async () => {
  const { env, fetchApi } = fixture();
  const imageId = '123e4567-e89b-42d3-a456-426614174000';
  const secondId = '123e4567-e89b-42d3-a456-426614174001';
  const jpeg = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1]).buffer;
  const invalid = new TextEncoder().encode('<svg/>').buffer;
  const store = (await (await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD})).json()).ok;
  assert.equal(store, true);
  const storeId = (await (await fetchApi('/api/admin/stores','POST',{name:'店舗'})).json()).id;
  const areaId = (await (await fetchApi('/api/admin/areas','POST',{name:'エリア',storeId})).json()).id;
  const values = {name:'チェストプレス',areaId,overview:'',adjustment:'',instructions:'',tips:'',safety:''};
  const id = (await (await fetchApi('/api/admin/machines','POST',values)).json()).id;
  const other = (await (await fetchApi('/api/admin/machines','POST',{...values,name:'別のマシン'})).json()).id;

  assert.equal((await fetchApi('/api/manual-image/'+id+'/'+imageId)).status, 404);
  assert.equal((await fetchApi('/api/admin/machines/'+id+'/images/'+imageId,'PUT',invalid)).status, 400);
  assert.equal((await fetchApi('/api/admin/machines/'+id+'/images/'+imageId,'PUT',jpeg)).status, 200);
  assert.equal((await fetchApi('/api/manual-image/'+id+'/'+imageId)).status, 404);

  const adjustment = '@FIT_IMG_V1:'+JSON.stringify([{text:'シートを調整',imageId}]);
  const instructions = '@FIT_IMG_V1:'+JSON.stringify([{text:'背中を付ける',imageId:secondId}]);
  assert.equal((await fetchApi('/api/admin/machines/'+id,'PATCH',{...values,adjustment})).status, 200);
  const photo = await fetchApi('/api/manual-image/'+id+'/'+imageId);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),new Uint8Array(jpeg));
  assert.equal((await fetchApi('/api/manual-image/'+other+'/'+imageId)).status, 404);
  assert.equal((await fetchApi('/api/manual-image/'+id+'/'+secondId)).status, 404);

  const raw = await (await fetchApi('/api/catalog')).json();
  assert.equal(raw.machines.find(m => m.id === id).adjustment,adjustment);
  assert.equal((await fetchApi('/api/admin/machines/'+id,'PATCH',{...values,adjustment:'@FIT_IMG_V1:{bad json'})).status, 400);

  // Removing the image reference deletes its stored KV value through the cleanup queue.
  assert.equal((await fetchApi('/api/admin/machines/'+id,'PATCH',values)).status, 200);
  assert.equal((await fetchApi('/api/manual-image/'+id+'/'+imageId)).status, 404);
  assert.equal(env.VIDEO_KV.values.has('manual:'+id+':'+imageId),false);

  // Deleting a store cascades to all machines and queued image data.
  assert.equal((await fetchApi('/api/admin/machines/'+id+'/images/'+secondId,'PUT',jpeg)).status, 200);
  assert.equal((await fetchApi('/api/admin/machines/'+id,'PATCH',{...values,instructions})).status, 200);
  assert.equal((await fetchApi('/api/admin/stores/'+storeId,'DELETE')).status, 200);
  assert.equal(env.VIDEO_KV.values.has('manual:'+id+':'+secondId),false);
});

test('manual photo uploads require an admin session', async () => {
  const { fetchApi } = fixture();
  const imageId='123e4567-e89b-42d3-a456-426614174003';
  const machineId='123e4567-e89b-42d3-a456-426614174004';
  const jpeg = Uint8Array.from([255,216,255,0]).buffer;
  assert.equal((await fetchApi('/api/admin/machines/'+machineId+'/images/'+imageId,'PUT',jpeg)).status, 401);
});

test('machine manuals can be created across multiple stores atomically', async () => {
  const { env, fetchApi } = fixture();
  const first = await fetchApi('/api/admin/machines', 'POST', {
    name:'未認証',areaIds:['123e4567-e89b-42d3-a456-426614174000']
  });
  assert.equal(first.status, 401);
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const stores = [];
  for (const name of ['江古田店', '大宮店', '池袋店']) {
    const id = (await (await fetchApi('/api/admin/stores','POST',{name})).json()).id;
    const areaA = (await (await fetchApi('/api/admin/areas','POST',{storeId:id,name:'ウェイト'})).json()).id;
    const areaB = (await (await fetchApi('/api/admin/areas','POST',{storeId:id,name:'フリー'})).json()).id;
    stores.push({id, areaA, areaB});
  }
  const areaIds = [stores[0].areaB, stores[1].areaA, stores[2].areaB];
  const values = {
    name:'チェストプレス',areaIds,overview:'胸を鍛える',
    adjustment:'シートを調整',instructions:'1. 構える',
    tips:'ゆっくり動かす',safety:'無理はしない'
  };
  let r = await fetchApi('/api/admin/machines','POST',values);
  assert.equal(r.status, 201);
  const created = await r.json();
  assert.equal(created.ids.length,3);
  assert.equal(created.id,created.ids[0]);
  assert.deepEqual(created.areaIds,areaIds);
  assert.equal(new Set(created.ids).size,3);
  let catalog = await (await fetchApi('/api/catalog')).json();
  for (let i=0; i<3; i++) {
    const machine=catalog.machines.find(m=>m.id===created.ids[i]);
    assert.equal(machine.areaId,areaIds[i]);
    assert.equal(machine.name,values.name);
    assert.equal(machine.adjustment,values.adjustment);
    assert.equal(machine.instructions,values.instructions);
  }

  // Each store receives an independent manual that can be edited after creation.
  r = await fetchApi('/api/admin/machines/'+created.ids[1],'PATCH',{
    ...values,areaId:areaIds[1],instructions:'大宮店専用の説明'
  });
  assert.equal(r.status,200);
  catalog = await (await fetchApi('/api/catalog')).json();
  assert.equal(catalog.machines.find(m=>m.id===created.ids[1]).instructions,'大宮店専用の説明');
  assert.equal(catalog.machines.find(m=>m.id===created.ids[0]).instructions,values.instructions);

  // Invalid batches must not register any machines.
  const before = catalog.machines.length;
  for(const badIds of [
    [stores[0].areaB, stores[0].areaB], // duplicated area
    [stores[0].areaB, '123e4567-e89b-42d3-a456-426614174000'], // unknown area
    [], // empty destination list
    [...Array(21)].map((_,i)=>'123e4567-e89b-42d3-a456-'+String(i).padStart(12,'0')) // too many
  ]) {
    const failed=await fetchApi('/api/admin/machines','POST',{...values,areaIds:badIds});
    assert.ok(failed.status===400 || failed.status===404);
  }
  catalog = await (await fetchApi('/api/catalog')).json();
  assert.equal(catalog.machines.length,before);

  // The old one-area API remains valid.
  r=await fetchApi('/api/admin/machines','POST',{
    ...values,areaIds:undefined,areaId:stores[0].areaA,name:'ラットプルダウン'
  });
  assert.equal(r.status,201);
  const single=await r.json();
  assert.equal(single.ids.length,1);
  assert.equal(single.id,single.ids[0]);
});

test('multi-store step images belong to each registered machine', async () => {
  const { env, fetchApi } = fixture();
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const storeA=(await (await fetchApi('/api/admin/stores','POST',{name:'店舗A'})).json()).id;
  const storeB=(await (await fetchApi('/api/admin/stores','POST',{name:'店舗B'})).json()).id;
  const areaA=(await (await fetchApi('/api/admin/areas','POST',{name:'マシン',storeId:storeA})).json()).id;
  const areaB=(await (await fetchApi('/api/admin/areas','POST',{name:'マシン',storeId:storeB})).json()).id;
  const imageId='123e4567-e89b-42d3-a456-426614174000';
  const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1]).buffer;
  const adjustment='@FIT_IMG_V1:'+JSON.stringify([{text:'シートを合わせる',imageId}]);
  const payload={name:'レッグプレス',areaIds:[areaA,areaB],overview:'',adjustment:'',instructions:'',tips:'',safety:''};
  const result=await (await fetchApi('/api/admin/machines','POST',payload)).json();
  for(let i=0; i<result.ids.length; i++){
    const id=result.ids[i];
    assert.equal((await fetchApi('/api/admin/machines/'+id+'/images/'+imageId,'PUT',jpeg)).status,200);
    assert.equal((await fetchApi('/api/admin/machines/'+id,'PATCH',
      {...payload,areaId:payload.areaIds[i],adjustment})).status,200);
    assert.equal((await fetchApi('/api/manual-image/'+id+'/'+imageId)).status,200);
  }
  // Removing one manual does not delete the other store's image.
  assert.equal((await fetchApi('/api/admin/machines/'+result.ids[0],'DELETE')).status,200);
  assert.equal((await fetchApi('/api/manual-image/'+result.ids[0]+'/'+imageId)).status,404);
  assert.equal((await fetchApi('/api/manual-image/'+result.ids[1]+'/'+imageId)).status,200);
});

test('areas can be registered across multiple stores without affecting older single-store API', async () => {
  const { env, fetchApi } = fixture();
  assert.equal((await fetchApi('/api/admin/areas','POST',{name:'ストレッチ',storeIds:[]})).status,401);
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const storeIds=[];
  for (const name of ['店舗A','店舗B','店舗C']) {
    storeIds.push((await (await fetchApi('/api/admin/stores','POST',{name})).json()).id);
  }
  const name='マシンエリア';
  const result=await fetchApi('/api/admin/areas','POST',{name,storeIds});
  assert.equal(result.status,201);
  const created=await result.json();
  assert.equal(created.ids.length,3);
  assert.equal(new Set(created.ids).size,3);
  assert.equal(created.id,created.ids[0]);
  assert.deepEqual(created.storeIds,storeIds);
  let data=await (await fetchApi('/api/catalog')).json();
  for(let i=0;i<storeIds.length;i++) {
    const a=data.areas.find(row=>row.id===created.ids[i]);
    assert.equal(a.storeId,storeIds[i]);
    assert.equal(a.name,name);
  }
  // Copies can be renamed independently.
  assert.equal((await fetchApi('/api/admin/areas/'+created.ids[1],'PATCH',
    {name:'店舗Bだけ変更',storeId:storeIds[1]})).status,200);
  data=await (await fetchApi('/api/catalog')).json();
  assert.equal(data.areas.find(a=>a.id===created.ids[0]).name,name);
  assert.equal(data.areas.find(a=>a.id===created.ids[1]).name,'店舗Bだけ変更');
  assert.equal(data.areas.find(a=>a.id===created.ids[2]).name,name);

  const count=data.areas.length;
  const missing='123e4567-e89b-42d3-a456-426614174099';
  for(const invalid of [
    [],[storeIds[0],storeIds[0]],[storeIds[0],missing],
    Array(21).fill(storeIds[0])
  ]) {
    const failed=await fetchApi('/api/admin/areas','POST',{name:'作成されない',storeIds:invalid});
    assert.ok([400,404].includes(failed.status));
  }
  data=await (await fetchApi('/api/catalog')).json();
  assert.equal(data.areas.length,count);
  assert.equal(data.areas.some(a=>a.name==='作成されない'),false);

  // A legacy single-store request still works.
  const single=await fetchApi('/api/admin/areas','POST',{name:'単独エリア',storeId:storeIds[0]});
  assert.equal(single.status,201);
  const legacy=await single.json();
  assert.deepEqual(legacy.ids,[legacy.id]);
  assert.deepEqual(legacy.storeIds,[storeIds[0]]);
});

test('machine registration selects stores without pre-existing areas',async()=>{
  const { env, fetchApi }=fixture();
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const first=(await (await fetchApi('/api/admin/stores','POST',{name:'新規店舗A'})).json()).id;
  const second=(await (await fetchApi('/api/admin/stores','POST',{name:'新規店舗B'})).json()).id;
  const initial=await (await fetchApi('/api/catalog')).json();
  assert.equal(initial.areas.length,0);
  const values={name:'チェストプレス',storeSelections:[
    {storeId:first,areaId:null},{storeId:second,areaId:null}
  ],overview:'胸を鍛える',adjustment:'シートの高さを設定',
  instructions:'胸を張る',tips:'ゆっくり動作',safety:'重量を確認'};
  const result=await fetchApi('/api/admin/machines','POST',values);
  assert.equal(result.status,201);
  const created=await result.json();
  assert.equal(created.ids.length,2);
  assert.equal(created.areaIds.length,2);
  const data=await (await fetchApi('/api/catalog')).json();
  for(let i=0;i<2;i++){
    const machine=data.machines.find(m=>m.id===created.ids[i]);
    const area=data.areas.find(a=>a.id===created.areaIds[i]);
    assert.equal(machine.areaId,area.id);
    assert.equal(machine.instructions,values.instructions);
    assert.equal(area.name,'マシン');
    assert.equal(area.storeId,i===0?first:second);
  }
  const existing=data.areas.find(a=>a.storeId===first).id;
  const bad=await fetchApi('/api/admin/machines','POST',{
    ...values,storeSelections:[{storeId:first,areaId:created.areaIds[1]}]
  });
  assert.equal(bad.status,400);
  assert.equal((await (await fetchApi('/api/catalog')).json()).machines.length,2);
  assert.ok(existing);
});

test('machine registration applies one selected area across multiple stores', async () => {
  const { env, fetchApi } = fixture();
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const storeA = (await (await fetchApi('/api/admin/stores','POST',{name:'江古田店'})).json()).id;
  const storeB = (await (await fetchApi('/api/admin/stores','POST',{name:'大宮店'})).json()).id;
  const storeC = (await (await fetchApi('/api/admin/stores','POST',{name:'新店舗'})).json()).id;
  const areaA = (await (await fetchApi('/api/admin/areas','POST',{storeId:storeA,name:'有酸素'})).json()).id;
  const areaAOther = (await (await fetchApi('/api/admin/areas','POST',{storeId:storeA,name:'マシン'})).json()).id;
  const areaB = (await (await fetchApi('/api/admin/areas','POST',{storeId:storeB,name:'有酸素'})).json()).id;
  const areaBOther = (await (await fetchApi('/api/admin/areas','POST',{storeId:storeB,name:'マシン'})).json()).id;
  // Store C has areas, but not the selected category. It should receive "有酸素".
  await fetchApi('/api/admin/areas','POST',{storeId:storeC,name:'マシン'});
  const selected = [
    {storeId:storeA,areaId:areaA},
    {storeId:storeB,areaId:areaB},
    {storeId:storeC,areaId:null}
  ];
  const values={name:'ランニングマシン',areaName:'有酸素',storeSelections:selected,
    overview:'有酸素運動',adjustment:'速度を設定',instructions:'歩き始める',
    tips:'前を見る',safety:'急な速度変更を避ける'};
  const createdResponse=await fetchApi('/api/admin/machines','POST',values);
  assert.equal(createdResponse.status,201);
  const created=await createdResponse.json();
  assert.equal(created.ids.length,3);
  assert.equal(new Set(created.ids).size,3);
  assert.deepEqual(created.areaIds.slice(0,2),[areaA,areaB]);
  const catalog=await (await fetchApi('/api/catalog')).json();
  for(let i=0;i<3;i++){
    const machine=catalog.machines.find(m=>m.id===created.ids[i]);
    const area=catalog.areas.find(a=>a.id===machine.areaId);
    assert.equal(machine.areaId,created.areaIds[i]);
    assert.equal(area.name,'有酸素');
    assert.equal(area.storeId,selected[i].storeId);
    assert.equal(machine.instructions,values.instructions);
  }
  // A different area in a store is never selected by accident.
  assert.equal(catalog.machines.some(m=>m.areaId===areaAOther || m.areaId===areaBOther),false);

  const count=catalog.machines.length;
  const invalid=[
    // Same store must not be registered twice, even into different areas.
    [{storeId:storeA,areaId:areaA},{storeId:storeA,areaId:areaAOther}],
    [{storeId:storeA,areaId:areaA},{storeId:storeA,areaId:areaA}],
    // The selected area must match every provided destination area.
    [{storeId:storeA,areaId:areaAOther}],
    [{storeId:storeA,areaId:areaA},{storeId:storeB,areaId:areaBOther}],
    [{storeId:storeA,areaId:areaB}],
    [{storeId:storeC,areaId:null}]
  ];
  for(const storeSelections of invalid){
    const response=await fetchApi('/api/admin/machines','POST',{...values,storeSelections});
    assert.ok([400,404,409].includes(response.status));
  }
  assert.equal((await (await fetchApi('/api/catalog')).json()).machines.length,count);
  // Older clients without a category name can still register their own existing area.
  const legacy=await fetchApi('/api/admin/machines','POST',{
    ...values,areaName:undefined,storeSelections:undefined,
    areaIds:[areaA],name:'バイク'
  });
  assert.equal(legacy.status,201);
  assert.equal((await legacy.json()).ids.length,1);
});

test('machine picker thumbnails require admin uploads and display publicly', async () => {
  const { env, fetchApi } = fixture();
  const jpeg = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1]).buffer;
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0]).buffer;
  const authless = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal((await fetchApi('/api/admin/machines/'+authless+'/thumbnail','PUT',jpeg)).status,401);
  assert.equal((await fetchApi('/api/machine-thumbnail/'+authless)).status,404);
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const store = (await (await fetchApi('/api/admin/stores','POST',{name:'江古田店'})).json()).id;
  const area = (await (await fetchApi('/api/admin/areas','POST',{name:'ウェイト',storeId:store})).json()).id;
  const machine = (await (await fetchApi('/api/admin/machines','POST',{
    name:'チェストプレス',areaId:area,overview:'',adjustment:'',instructions:'',tips:'',safety:''
  })).json()).id;
  const photoUrl='/api/machine-thumbnail/'+machine;
  assert.equal((await fetchApi(photoUrl)).status,404);
  assert.equal((await fetchApi('/api/admin/machines/'+machine+'/thumbnail','PUT',png)).status,400);
  assert.equal((await fetchApi('/api/admin/machines/'+machine+'/thumbnail','PUT',jpeg)).status,200);
  const photo=await fetchApi(photoUrl);
  assert.equal(photo.status,200);
  assert.equal(photo.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),new Uint8Array(jpeg));
  assert.equal((await fetchApi(photoUrl,'HEAD')).status,200);
  assert.equal((await fetchApi('/api/admin/machines/'+machine+'/thumbnail','DELETE')).status,200);
  assert.equal((await fetchApi(photoUrl)).status,404);
  assert.equal(env.VIDEO_KV.values.has('machine-thumb:'+machine),false);
});

test('machine picker thumbnail copies stay independent and parent deletion cleans KV', async () => {
  const { env, fetchApi } = fixture();
  await fetchApi('/api/admin/login','POST',{password:env.ADMIN_PASSWORD});
  const storeIds=[];
  for(const name of ['A店','B店'])
    storeIds.push((await (await fetchApi('/api/admin/stores','POST',{name})).json()).id);
  const areas=[];
  for(const storeId of storeIds)
    areas.push((await (await fetchApi('/api/admin/areas','POST',{name:'マシン',storeId})).json()).id);
  const created=await (await fetchApi('/api/admin/machines','POST',{
    name:'レッグプレス',areaIds:areas,overview:'',adjustment:'',instructions:'',tips:'',safety:''
  })).json();
  assert.equal(created.ids.length,2);
  const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1]).buffer;
  for(const mid of created.ids)
    assert.equal((await fetchApi('/api/admin/machines/'+mid+'/thumbnail','PUT',jpeg)).status,200);
  for(const mid of created.ids)
    assert.equal((await fetchApi('/api/machine-thumbnail/'+mid)).status,200);
  assert.equal((await fetchApi('/api/admin/machines/'+created.ids[0],'DELETE')).status,200);
  assert.equal(env.VIDEO_KV.values.has('machine-thumb:'+created.ids[0]),false);
  assert.equal((await fetchApi('/api/machine-thumbnail/'+created.ids[1])).status,200);
  assert.equal((await fetchApi('/api/admin/stores/'+storeIds[1],'DELETE')).status,200);
  assert.equal(env.VIDEO_KV.values.has('machine-thumb:'+created.ids[1]),false);
});
