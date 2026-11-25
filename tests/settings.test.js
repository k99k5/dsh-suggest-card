import test from 'node:test';
import assert from 'node:assert/strict';
import {installReviews,parseReview,collect} from '../review.js';
import {visibleCard} from '../settings.js';

const txt=text=>({type:'text',text});
const events=[{type:'turn/start',data:{turn:2}},
  {type:'user/message',surfaceOp:'append',data:{source:{kind:'user',rpcId:'test'},content:[txt('请求'),{type:'image',data:'hidden'}]}},
  {type:'user/message',surfaceOp:'append',data:{source:{kind:'agent-context'},content:[txt('private')]}},
  {type:'tool/result',data:{secret:'private'}},
  {type:'assistant/message',data:{turn:2,message:{content:[{type:'reasoning',text:'private'},txt('继续吗？')]}}},
  {type:'turn/end',data:{turn:2,reason:{kind:'completed'}}}].map((e,seq)=>({...e,seq}));
const end=events.at(-1),session={id:'session',header:{},isOwnSeq:()=>true,snapshotEvents:(a,b)=>events.slice(a,b)};
test('只提取本轮用户文字和最终回复',()=>{const s={turn:2,user:'',reply:''};for(const e of events)collect(s,e);assert.deepEqual(s,{turn:2,user:'请求',reply:'继续吗？'});});
test('非所有者参与时丢弃本轮文字并停止收集',()=>{const s={turn:2,user:'owner',reply:''};collect(s,{...events[1],data:{...events[1].data,source:{kind:'user',principal:{kind:'guest'}}}});for(const e of events)collect(s,e);assert.deepEqual(s,{turn:2,user:'',reply:'',blocked:true});});
test('总开关只采纳已确认配置',()=>{assert.ok(visibleCard({status:'ready',value:{enabled:true}}));assert.ok(!visibleCard({status:'ready',value:{enabled:false}}));assert.ok(!visibleCard({status:'loading'}));});
test('快捷回复只展示实际末行问题，不采用模型补写的说明',()=>{
  const raw=JSON.stringify({kind:'question',labels:['继续','不用'],description:'模型改写'});
  assert.deepEqual(parseReview(raw,'已完成检查。\r\n继续排查吗？\n'),{kind:'question',labels:['继续','不用'],description:'继续排查吗？'});
});
test('无卡和问答结果校验',()=>{
  assert.equal(parseReview('{"kind":"none"}',''),null);assert.deepEqual(parseReview('{"kind":"question","labels":["继续","不用"]}','继续吗？').labels,['继续','不用']);
  assert.throws(()=>parseReview('{"kind":"question","labels":["X","Y"]}','已完成。'));
  assert.throws(()=>parseReview('{"kind":"next_task","title":"A","description":"B","prompt":"hidden"}',''));
});
test('有效回合只检查一次，刷新和关闭状态不触发，非所有者不可读取',async()=>{
  let handler,calls=0,route=JSON.stringify(['p','m']),enabled=true,owner=true;const routes={};
  const llm={async *stream(o){calls++;assert.equal(o.provider,'p');assert.equal(o.model,'m');assert.deepEqual(JSON.parse(o.messages[0].content[0].text),{user:'请求',reply:'继续吗？'});yield {type:'text-delta',text:'{"kind":"next_task","title":"A","description":"B"}'};yield {type:'finish',reason:{kind:'stop'}};}};
  installReviews({llm,on:(_,fn)=>handler=fn,effect(){},connection:{admit:()=>({peer:{principal:{kind:owner?'owner':'remote'}}}),fetch:{register(r){routes[r.path]=r.fetch;}}}},{enabled:{get:()=>enabled},reviewModel:{get:()=>route}});
  const read=()=>routes['/api/dsh-suggest-card.result'](new Request(`http://localhost/x?key=session:${end.seq}`));
  enabled=false;handler(session,end);enabled=true;handler(session,{...end,data:{...end.data,reason:{kind:'aborted'}}});assert.equal(calls,0);
  for(const e of events){
    if(e===events[3]){
      handler(session,{type:'tool/call',data:{turn:2,name:'offer_task_card',callId:'offer',arguments:JSON.stringify({kind:'next_task',title:'C',description:'D'})}});
      handler(session,{type:'tool/result',data:{turn:2,message:{toolCallId:'offer',isError:false}}});
    }
    handler(session,e);
  }
  handler(session,end);await Promise.resolve();assert.equal(calls,1);
  assert.equal((await (await read()).json()).card.title,'A');await read();assert.equal(calls,1);
  owner=false;assert.equal((await read()).status,403);owner=true;route='';assert.equal((await (await read()).json()).card,null);
});
