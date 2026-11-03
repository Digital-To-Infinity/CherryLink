import assert from 'node:assert/strict';
import test from 'node:test';
import {aggregateStatus,isUncertainHttpStatus,retryDelaySeconds} from '@cherrylink/shared';
test('partial success is never complete success',()=>assert.equal(aggregateStatus(['PUBLISHED','FAILED']),'PARTIALLY_PUBLISHED'));
test('all success is published',()=>assert.equal(aggregateStatus(['PUBLISHED','PUBLISHED']),'PUBLISHED'));
test('unknown is not retriable success',()=>assert.equal(aggregateStatus(['UNKNOWN']),'UNKNOWN'));
test('backoff is bounded',()=>{assert.equal(retryDelaySeconds(1),30);assert.equal(retryDelaySeconds(2),60);assert.ok(retryDelaySeconds(30)<=3600);});
test('timeouts and 5xx may have published',()=>{assert.equal(isUncertainHttpStatus(null),true);assert.equal(isUncertainHttpStatus(503),true);assert.equal(isUncertainHttpStatus(400),false);});
import {createPostSchema} from '@cherrylink/shared';
test('post schema refuses publishing without targets',()=>{
  const r=createPostSchema.safeParse({caption:'Test post',accountIds:[],saveDraft:false});assert.equal(r.success,false);
});
test('draft can be saved without connected targets',()=>{
  const r=createPostSchema.safeParse({caption:'Draft idea',accountIds:[],saveDraft:true});assert.equal(r.success,true);
});
