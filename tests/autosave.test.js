import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutosave} from '../autosave.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){const calls=[],receipts=[];const store=createAutosave({getSnapshot:()=>({writable:true}),mutate:ops=>{calls.push(ops);return new Promise((resolve,reject)=>receipts.push({resolve,reject}));}});return {store,calls,receipts};}
test('设置立即响应，慢回执不会覆盖新选择，关闭面板继续保存',async()=>{
  const {store,calls,receipts}=fixture(),off=store.subscribe(()=>{});
  store.change('reviewModel','A');assert.equal(store.read().draft.reviewModel,'A');await tick();
  store.change('reviewModel','B');store.change('enabled',false);store.change('reviewModel','C');off();
  assert.equal(calls.length,1);receipts[0].resolve(true);await tick();
  assert.deepEqual(store.read().draft,{reviewModel:'C',enabled:false});assert.equal(calls.length,2);
  assert.deepEqual(calls[1].map(o=>o.value),['C',false]);receipts[1].resolve(true);await tick();
  assert.deepEqual(store.read(),{draft:{},saving:false,error:false});
});
test('拒绝保存会撤回待写值，失败可重试',async()=>{
  const {store,receipts}=fixture();store.change('enabled',false);await tick();receipts[0].reject(Error('offline'));await tick();
  assert.deepEqual(store.read(),{draft:{},saving:false,error:true});store.change('enabled',false);await tick();receipts[1].resolve(true);await tick();
  assert.equal(store.read().error,false);
});
