import test from 'node:test';
import assert from 'node:assert/strict';
import {loadThumbnail,peekThumbnail,warmThumbnails} from '../src/thumbnailCache.js';

test('prefetch and visible render share a single thumbnail request',async()=>{
  const originalFetch=globalThis.fetch;
  const originalImage=globalThis.Image;
  const originalObjectURL=URL.createObjectURL;
  const id='11111111-1111-4111-8111-111111111111';
  let count=0;
  try {
    globalThis.Image=undefined;
    URL.createObjectURL=()=> 'blob:test-thumbnail';
    globalThis.fetch=async()=>{count++;return {ok:true,blob:async()=>({size:15,type:'image/jpeg'})};};
    warmThumbnails([id,id,id]);
    const url=await loadThumbnail(id);
    assert.equal(url,'blob:test-thumbnail');
    assert.equal(peekThumbnail(id),url);
    assert.equal(await loadThumbnail(id),url);
    assert.equal(count,1);
  } finally {
    globalThis.fetch=originalFetch;
    globalThis.Image=originalImage;
    URL.createObjectURL=originalObjectURL;
  }
});

test('unpublished or absent images stay empty instead of broken-image icons',async()=>{
  const originalFetch=globalThis.fetch;
  const id='22222222-2222-4222-8222-222222222222';
  let count=0;
  try {
    globalThis.fetch=async()=>{count++;return {ok:false,status:404};};
    assert.equal(await loadThumbnail(id),null);
    assert.equal(peekThumbnail(id),null);
    assert.equal(await loadThumbnail(id),null);
    assert.equal(count,1);
  } finally {globalThis.fetch=originalFetch;}
});

test('store-area prefetch limits speculative requests to 24 IDs',async()=>{
  const originalFetch=globalThis.fetch;
  const ids=Array.from({length:35},(_,n)=>'thumb-prefetch-'+n);
  const requested=[];
  try {
    globalThis.fetch=async path=>{
      requested.push(path);
      return {ok:false,status:404};
    };
    warmThumbnails(ids);
    await Promise.all(ids.slice(0,24).map(id=>loadThumbnail(id)));
    assert.equal(requested.length,24);
    assert.equal(new Set(requested).size,24);
  } finally {globalThis.fetch=originalFetch;}
});
