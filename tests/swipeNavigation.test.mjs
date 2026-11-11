import test from 'node:test';
import assert from 'node:assert/strict';
import {getViewerParentRoute,shouldCompleteSwipe} from '../src/swipeNavigation.js';

const catalog={
  stores:[{id:'store-a'}],
  areas:[{id:'area-a',storeId:'store-a'}],
  machines:[{id:'machine-a',areaId:'area-a'}]
};

test('viewer edge swipe goes to the correct hierarchy parent',()=>{
  assert.equal(getViewerParentRoute('/store/store-a',catalog),'/');
  assert.equal(getViewerParentRoute('/area/area-a',catalog),'/store/store-a');
  assert.equal(getViewerParentRoute('/machine/machine-a',catalog),'/area/area-a');
});
test('no swipe navigation on home, admin, or invalid public routes',()=>{
  for(const path of ['/','/admin','/admin/machines','/unknown','/area/removed',
    '/machine/removed','/store/removed'])
    assert.equal(getViewerParentRoute(path,catalog),null,path);
});
test('missing parent falls back to the visitor home screen',()=>{
  assert.equal(getViewerParentRoute('/area/area-a',{...catalog,stores:[]}),'/');
  assert.equal(getViewerParentRoute('/machine/machine-a',{...catalog,areas:[]}),'/');
});
test('slow drags cancel until they pass the distance threshold',()=>{
  assert.equal(shouldCompleteSwipe(0,390,0),false);
  assert.equal(shouldCompleteSwipe(-25,390,1),false);
  assert.equal(shouldCompleteSwipe(45,390,0.1),false);
  assert.equal(shouldCompleteSwipe(115,390,0.1),true);
});
test('quick flicks can complete a shorter drag',()=>{
  assert.equal(shouldCompleteSwipe(55,390,0.85),false);
  assert.equal(shouldCompleteSwipe(57,390,0.85),true);
  assert.equal(shouldCompleteSwipe(57,390,0.12),false);
  assert.equal(shouldCompleteSwipe(171,1200,0),true);
});
