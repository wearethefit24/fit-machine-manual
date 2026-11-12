import test from 'node:test';
import assert from 'node:assert/strict';
import {manualReturnPath} from '../src/manualNavigation.js';

const areaA={id:'area-a',storeId:'store-a'};
const areaB={id:'area-b',storeId:'store-b'};
const context={manualListOrigin:{machineId:'machine-a',areaId:areaB.id}};

test('manual selected from a store-area machine list returns to the exact area',()=>{
  assert.equal(manualReturnPath('machine-a',context,[areaA,areaB]),'/area/area-b');
});
test('manual opened from an external QR URL returns to store selection',()=>{
  assert.equal(manualReturnPath('machine-a',null,[areaA,areaB]),'/');
  assert.equal(manualReturnPath('machine-a',{},[areaA,areaB]),'/');
});
test('manual opened through built-in QR scanner ignores the prior list origin',()=>{
  assert.equal(manualReturnPath('machine-a',{},[areaB]),'/');
});
test('stale origin from another manual or hidden/removed area returns to root',()=>{
  assert.equal(manualReturnPath('machine-b',context,[areaA,areaB]),'/');
  assert.equal(manualReturnPath('machine-a',context,[areaA]),'/');
});
