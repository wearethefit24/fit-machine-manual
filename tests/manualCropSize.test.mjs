import test from 'node:test';
import assert from 'node:assert/strict';
import {manualCropSize} from '../src/manualCropSize.js';

test('4:3 and 1:1 manual images keep expected output dimensions',()=>{
  assert.deepEqual(manualCropSize('4:3'),{width:1200,height:900});
  assert.deepEqual(manualCropSize('1:1'),{width:900,height:900});
});
test('custom landscape and portrait dimensions retain their requested aspect',()=>{
  assert.deepEqual(manualCropSize('custom',16,9),{width:1200,height:675});
  assert.deepEqual(manualCropSize('custom',3,4),{width:900,height:1200});
  assert.deepEqual(manualCropSize('custom',1,1),{width:1200,height:1200});
});
test('reject invalid and unreasonable custom ratios',()=>{
  for(const [w,h] of [[0,3],[3,0],['',3],['3',''],[100,3],[3,100],[-1,4],[1.3,2],['hi','no']])
    assert.equal(manualCropSize('custom',w,h),null);
  assert.equal(manualCropSize('missing'),null);
});
