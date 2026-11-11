// Session-only thumbnail preloader. The public endpoint intentionally sends
// "no-store" to enforce publication changes, so browser HTTP caching alone
// cannot make repeat navigation fast. Keep a small in-memory blob URL cache
// rather than weakening server-side access controls.
const cached = new Map();
const SUCCESS_MS = 90_000;
const FAILURE_MS = 8_000;
const MAX_ENTRIES = 80;

function cachedRecord(id) {
  const record = cached.get(id);
  return record && (record.pending || record.until > Date.now()) ? record : null;
}

export function peekThumbnail(id) {
  return cachedRecord(id)?.url || null;
}

function pruneCache() {
  if (cached.size <= MAX_ENTRIES) return;
  // Do not revoke visible images while a screen is mounted: retain URLs
  // until this page unloads, limiting the number of actively prefetched IDs.
  for (const [id,record] of cached) {
    if (cached.size <= MAX_ENTRIES) break;
    if (!record.pending && !record.url) cached.delete(id);
  }
}

export function loadThumbnail(id) {
  if (!id) return Promise.resolve(null);
  const old = cachedRecord(id);
  if (old) return old.pending || Promise.resolve(old.url);
  const record = {url:null,pending:null,until:Date.now()+FAILURE_MS};
  cached.set(id,record);
  record.pending = fetch('/api/machine-thumbnail/'+encodeURIComponent(id),{
    credentials:'same-origin',cache:'no-store',priority:'high'
  }).then(async response=>{
    if(!response.ok)return null;
    const blob=await response.blob();
    if(!blob.size || !blob.type.startsWith('image/'))return null;
    const url=URL.createObjectURL(blob);
    // Decoding is started before the visitor selects the area. Do not block
    // returning the URL when a cold network request finishes.
    if(typeof Image!=='undefined'){
      const preview=new Image();
      preview.src=url;
      if(preview.decode)preview.decode().catch(()=>{});
    }
    record.url=url;
    record.until=Date.now()+SUCCESS_MS;
    return url;
  }).catch(()=>null).finally(()=>{
    record.pending=null;
    pruneCache();
  });
  return record.pending;
}

export function warmThumbnails(ids) {
  // Preload a bounded number while the visitor is selecting an area, with
  // limited concurrency to avoid spiking Cloudflare Free requests.
  const unique=[...new Set(ids)].slice(0,24);
  let position=0;
  async function worker(){
    while(position<unique.length) {
      const id=unique[position++];
      await loadThumbnail(id);
    }
  }
  for(let i=0;i<Math.min(3,unique.length);i++)worker();
}
