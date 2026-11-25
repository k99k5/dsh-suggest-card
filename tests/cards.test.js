import test from 'node:test';
import assert from 'node:assert/strict';
import {closingDecision, taskCard, initial, fold, toolName} from '../logic.js';
import {apply} from '../index.js';
import {deliver, reviewRouteForCard, viewForTail} from '../actions.js';

const task={kind:'next_task',title:'核对列名',description:'检查导出表格的列名和说明。'};
for(const [q,labels] of [
  ['已完成。\n你想导出 PDF，还是 Markdown？',['导出 PDF','Markdown']],
  ['你希望「中文」还是「英文」？',['中文','英文']],
  ['需要我继续吗？',['好的','暂时不用']],
  ['Would you prefer CSV or JSON?',['CSV','JSON']],
  ['Shall we continue?',['Yes','Not now']],
  ['> 需要我继续吗？',null],['```text\n需要我继续吗？',null],['    需要我继续吗？',null],
  ['你想选择 A、B 还是 C？',null],['需要我继续吗？\n这是引用。',null],['已完成。需要我继续吗？',null],['文件在哪里？',null],['没有下一步。',null]
]) test(`末行：${q}`,()=>assert.deepEqual(closingDecision(q)?.labels??null,labels));

const ev=(type,data,seq=1)=>({type,seq,data:{turn:1,...data}});
const start=ev('turn/start',{}), call=ev('tool/call',{name:toolName,arguments:JSON.stringify(task),callId:'x'});
const result=ev('tool/result',{message:{toolCallId:'x'}}), end=ev('turn/end',{reason:{kind:'completed'}},6);
const answer=ev('assistant/message',{message:{content:[{type:'text',text:'需要我继续吗？'}]}});
const run=(...events)=>events.reduce(fold,initial());
test('工具产生的提议只在本轮成功结束后显示，且优先于问题',()=>{
  assert.equal(run(start,call,result,answer).visible,null);
  assert.deepEqual(run(start,call,result,answer,end).visible,{seq:6,card:task});
  assert.equal(run(start,call,end).visible.card,null);
  assert.equal(run(start,call,ev('tool/result',{message:{toolCallId:'x',isError:true}}),end).visible.card,null);
  assert.equal(run(start,call,result,ev('turn/end',{reason:{kind:'aborted'}})).visible,null);
});
test('只采用最后一条助手答复，新一轮清除旧问题',()=>{
  assert.equal(run(start,answer,end).visible.card.kind,'question');
  assert.equal(run(start,answer,ev('assistant/message',{message:{content:[{type:'text',text:'已完成。'}]}}),end).visible.card,null);
  assert.equal(run(start,answer,end,ev('turn/start',{turn:2})).visible,null);
});
test('只接受可见正文，不允许隐藏指令或自定义操作',()=>{
  assert.equal(taskCard({...task,prompt:'other'}),null);assert.equal(taskCard({...task,title:'  '}),null);
  assert.equal(taskCard({...task,kind:'session_choice'}).kind,'session_choice');
});
test('宿主声明的 schema 能保存并恢复实际卡片',async()=>{
  let projection,tool;
  await apply({effect(){},on(){},connection:{fetch:{register(){}}},inject(){},sessionProjections:{register:async d=>{projection=d;}},tools:{register:d=>{tool=d;}},systemPrompt:{section(){}}},{enabled:{get:()=>true},reviewModel:{get:()=>''}});
  assert.equal(await tool.execute(task),true); await assert.rejects(tool.execute({...task,kind:'other'}));
  let state=projection.init();for(const event of [start,call,result,answer,end]) state=projection.stateSchema.parse(projection.apply(state,event));
  assert.deepEqual(projection.wire.viewSchema.parse(projection.wire.view(state)).card,task);
  const {card}=projection.wire.viewSchema.parse(run(start,answer,end).visible);
  assert.deepEqual(card,{kind:'question',labels:['好的','暂时不用'],description:'需要我继续吗？'});
  assert.ok(projection.wire.viewSchema.safeParse({seq:6,card:{kind:'question',labels:card.labels}}).success);
});
test('选择检查模型时仍允许助手提议，总开关关闭后拒绝提议',async()=>{
  let enabled=true,tool,when,prompt;
  await apply({effect(){},on(){},inject(){},connection:{fetch:{register(){}}},sessionProjections:{register(){}},
    tools:{register(d,options){tool=d;when=options.when;}},systemPrompt:{section(d){prompt=d.text;}}},
    {enabled:{get:()=>enabled},reviewModel:{get:()=>'["p","m"]'}});
  assert.ok(when());assert.match(prompt(),/offer_task_card/);
  for(const kind of ['next_task','session_choice']) assert.equal(await tool.execute({...task,kind}),true);
  enabled=false;assert.ok(!when());assert.equal(prompt(),'');await assert.rejects(tool.execute(task));
});
test('只有成功的助手提议优先于模型结果，本地问题不占位',()=>{
  const route='["p","m"]';
  for(const kind of ['next_task','session_choice']){
    const offer=ev('tool/call',{...call.data,arguments:JSON.stringify({...task,kind})});
    const {card}=run(start,offer,result,answer,end).visible;
    assert.equal(reviewRouteForCard(card,route),'');
    assert.equal(reviewRouteForCard(card,''),'');
  }
  const failed=ev('tool/result',{message:{toolCallId:'x',isError:true}});
  for(const {card} of [run(start,call,failed,answer,end).visible,run(start,end).visible]){
    assert.equal(reviewRouteForCard(card,route),route);
    assert.equal(reviewRouteForCard(card,''),'');
  }
});
function setup(){
  const calls=[]; let reject=false;
  const session={getSnapshot:()=>({openState:'open'}),prompt:async(...args)=>{calls.push(['prompt',...args]);return reject?{ok:false,error:{message:'offline'}}:{ok:true,value:{accepted:true}};}};
  const ctx={sessions:{create:async opts=>{calls.push(['create',opts]);return 'child';},using:async(id,opts,cb)=>{calls.push(['using',id]);return cb({binding:{session}});}},uiWorkspace:{openSession:id=>calls.push(['open',id])}};
  return {ctx,calls,failure:v=>{reject=v;}};
}
const origin={id:'parent',options:{workspaceId:'ws'}};
test('正文序号和结束序号不同，仍匹配到正确回合',()=>{
  const view=run(start,answer,end).visible;
  assert.equal(viewForTail({seq:3,turn:{end}},view),view);
  assert.equal(viewForTail({seq:6,turn:{end:{seq:12}}},view),null);
});
test('创建失败未尝试发送；重试复用候选会话 ID',async()=>{
  const a={requestId:'r'},ids=[];const ctx={sessions:{create:async o=>{ids.push(o.sessionId);throw Error('create failed');}}};
  for(let n=0;n<2;n++) await assert.rejects(deliver(ctx,a,'new','t',origin,()=>{}));
  assert.ok(ids[0]);assert.equal(ids[0],ids[1]);assert.ok(!a.possiblySent);
});
test('新会话点击后直接发送，收到回执再导航',async()=>{
  const {ctx,calls}=setup(), a={requestId:'id'};
  await deliver(ctx,a,'new','标题\n\n说明',origin,()=>{});
  assert.deepEqual(calls,[['create',{workspaceId:'ws',sessionId:a.candidate}],['using','child'],['prompt',[{type:'text',text:'标题\n\n说明'}],'queue',undefined,'id'],['open','child']]);assert.equal(a.done,true);
});
test('当前会话只发送原文，不新建、切换或读写草稿',async()=>{
  const {ctx,calls}=setup();await deliver(ctx,{requestId:'id'},'here','暂时不用',origin,()=>{});
  assert.deepEqual(calls,[['using','parent'],['prompt',[{type:'text',text:'暂时不用'}],'queue',undefined,'id']]);
});
test('未确认的发送重试复用已建会话和请求标识',async()=>{
  const {ctx,calls,failure}=setup(),a={requestId:'id'};failure(true);
  await assert.rejects(deliver(ctx,a,'new','t',origin,()=>{}),/offline/);assert.ok(!a.done);
  failure(false);await deliver(ctx,a,'new','t',origin,()=>{});
  assert.equal(calls.filter(c=>c[0]==='create').length,1);assert.deepEqual(calls.filter(c=>c[0]==='prompt').map(c=>c.at(-1)),['id','id']);
});
