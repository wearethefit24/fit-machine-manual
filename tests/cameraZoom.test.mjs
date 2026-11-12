import test from 'node:test';
import assert from 'node:assert/strict';
import {QR_CAMERA_ZOOM,applyPreferredQrZoom} from '../src/cameraZoom.js';

test('QR camera sets real camera zoom to exactly 1.5 when supported', async()=>{
  let options;
  const track={
    getCapabilities:()=>({zoom:{min:1,max:3,step:.1}}),
    applyConstraints:async value=>{options=value;},
    getSettings:()=>({zoom:1.5})
  };
  assert.equal(await applyPreferredQrZoom(track),true);
  assert.deepEqual(options,{advanced:[{zoom:QR_CAMERA_ZOOM}]});
});
test('unsupported or out-of-range native zoom falls back without failing QR',async()=>{
  assert.equal(await applyPreferredQrZoom({}),false);
  assert.equal(await applyPreferredQrZoom({
    getCapabilities:()=>({zoom:{min:2,max:4}}),
    applyConstraints:async()=>{throw Error('should not be called');}
  }),false);
  assert.equal(await applyPreferredQrZoom({
    getCapabilities:()=>({zoom:{min:1,max:4}}),
    applyConstraints:async()=>{throw Error('unsupported');}
  }),false);
});
test('camera zoom missing from settings can still succeed on capable tracks',async()=>{
  assert.equal(await applyPreferredQrZoom({
    getCapabilities:()=>({zoom:{min:1,max:2}}),
    applyConstraints:async()=>{},
    getSettings:()=>({})
  }),true);
  assert.equal(await applyPreferredQrZoom({
    getCapabilities:()=>({zoom:{min:1,max:2}}),
    applyConstraints:async()=>{},
    getSettings:()=>({zoom:1})
  }),false);
});
