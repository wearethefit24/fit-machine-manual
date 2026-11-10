import test from 'node:test';
import assert from 'node:assert/strict';
import { byteRange } from '../server/api.js';
test('full range', () => assert.deepEqual(byteRange(null, 100), {start:0,end:99,partial:false}));
test('partial prefix', () => assert.deepEqual(byteRange('bytes=0-9', 100), {start:0,end:9,partial:true}));
test('suffix range', () => assert.deepEqual(byteRange('bytes=-20', 100), {start:80,end:99,partial:true}));
test('clamps end', () => assert.deepEqual(byteRange('bytes=90-', 100), {start:90,end:99,partial:true}));
test('invalid bounds', () => assert.equal(byteRange('bytes=100-200', 100), null));
test('no multi range', () => assert.equal(byteRange('bytes=0-1,5-9', 100), null));
