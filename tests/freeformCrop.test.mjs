import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_FREEFORM_CROP,containedImageBounds,adjustFreeformCrop,freeformOutputSize}
  from '../src/freeformCrop.js';

test('portrait and landscape photos are letterboxed inside crop workspace',()=>{
  assert.deepEqual(containedImageBounds(800,600),{x:0,y:0,w:1200,h:900});
  assert.deepEqual(containedImageBounds(600,800),{x:262.5,y:0,w:675,h:900});
});
test('dragging selection moves it without resizing and keeps it in the image',()=>{
  assert.deepEqual(adjustFreeformCrop(INITIAL_FREEFORM_CROP,'move',.05,0),{
    x:.09999999999999998,y:.05,w:.9,h:.9
  });
  const moved=adjustFreeformCrop(INITIAL_FREEFORM_CROP,'move',3,-3);
  assert.ok(Math.abs(moved.x-.1)<1e-8);
  assert.equal(moved.y,0);
  assert.equal(moved.w,.9);
});
test('corners and edges resize without a fixed aspect ratio',()=>{
  const crop={x:.2,y:.2,w:.4,h:.4};
  assert.deepEqual(adjustFreeformCrop(crop,'se',.2,-.1),{x:.2,y:.2,w:.6000000000000001,h:.30000000000000004});
  const left=adjustFreeformCrop(crop,'w',.1,0);
  assert.ok(Math.abs(left.w-.3)<1e-8);
  assert.equal(left.h,.4);
  const north=adjustFreeformCrop(crop,'n',0,.1);
  assert.ok(Math.abs(north.h-.3)<1e-8);
  assert.equal(north.w,.4);
});
test('resize clamps at source edges and maintains a usable minimum crop',()=>{
  const result=adjustFreeformCrop({x:.2,y:.2,w:.4,h:.4},'nw',9,9);
  assert.ok(result.w>=.1-1e-8 && result.h>=.1-1e-8);
  const expanded=adjustFreeformCrop({x:.2,y:.2,w:.4,h:.4},'se',9,9);
  assert.ok(expanded.x+expanded.w<=1 && expanded.y+expanded.h<=1);
});
test('export dimensions follow the selected rectangle and never stretch it',()=>{
  const rect={x:.25,y:.25,w:.5,h:.25};
  assert.deepEqual(freeformOutputSize(2400,1600,rect),{width:1200,height:400});
  assert.deepEqual(freeformOutputSize(600,800,{x:0,y:0,w:.5,h:.75}),{width:300,height:600});
});
