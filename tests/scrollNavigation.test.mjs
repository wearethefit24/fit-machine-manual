import test from 'node:test';
import assert from 'node:assert/strict';
import {resetPageScroll} from '../src/scrollNavigation.js';

test('route transition resets the window and scrolling element immediately',()=>{
  const calls=[];
  const win={scrollTo:opts=>calls.push(opts)};
  const doc={documentElement:{style:{scrollBehavior:''}},
    scrollingElement:{scrollTop:415},body:{scrollTop:415}};
  resetPageScroll(win,doc);
  assert.deepEqual(calls,[{top:0,left:0,behavior:'instant'}]);
  assert.equal(doc.scrollingElement.scrollTop,0);
  assert.equal(doc.body.scrollTop,0);
  assert.equal(doc.documentElement.style.scrollBehavior,'');
});
test('scroll reset overrides smooth-scrolling only while resetting',()=>{
  let behaviorAtCall;
  const doc={documentElement:{style:{scrollBehavior:'smooth'}},
    scrollingElement:{scrollTop:200},body:{scrollTop:200}};
  resetPageScroll({scrollTo:()=>{behaviorAtCall=doc.documentElement.style.scrollBehavior;}},doc);
  assert.equal(behaviorAtCall,'auto');
  assert.equal(doc.documentElement.style.scrollBehavior,'smooth');
});
test('scroll style is restored after a browser scroll exception',()=>{
  const doc={documentElement:{style:{scrollBehavior:'smooth'}},
    scrollingElement:{scrollTop:5},body:{scrollTop:5}};
  assert.throws(()=>resetPageScroll({scrollTo:()=>{throw Error('not supported')}},doc));
  assert.equal(doc.documentElement.style.scrollBehavior,'smooth');
});

test('legacy iPhone scrollTo numeric fallback still jumps to the top',()=>{
  const calls=[];
  const doc={documentElement:{style:{scrollBehavior:'smooth'}},
    scrollingElement:{scrollTop:200},body:{scrollTop:200}};
  const win={scrollTo:(a,b)=>{
    if(typeof a==='object')throw new TypeError('unsupported options');
    calls.push([a,b]);
  }};
  resetPageScroll(win,doc);
  assert.deepEqual(calls,[[0,0]]);
  assert.equal(doc.scrollingElement.scrollTop,0);
  assert.equal(doc.documentElement.style.scrollBehavior,'smooth');
});
