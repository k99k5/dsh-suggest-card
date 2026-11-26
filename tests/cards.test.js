import test from 'node:test';
import assert from 'node:assert/strict';
import {closingDecision, taskCard, initial, fold, toolName} from '../logic.js';
import {apply} from '../index.js';
import {deliver, reviewedCard, reviewRouteForCard, taskActions, viewForTail} from '../actions.js';

const task={kind:'next_task',title:'核对列名',description:'检查导出表格的列名和说明。'};
for(const [q,labels] of [
  ['已完成。\n你想导出 PDF，还是 Markdown？',['导出 PDF','Markdown']],
  ['你希望「中文」还是「英文」？',['中文','英文']],
  ['需要我继续吗？',['好的','暂时不用']],
  ['还需要我补一组测试吗？',['好的','暂时不用']],
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
test('普通追问优先于工具提议；没有问题时才显示独立任务',()=>{
  assert.equal(run(start,call,result,answer).visible,null);
  assert.equal(run(start,call,result,answer,end).visible.card.kind,'question');
  assert.deepEqual(run(start,call,result,end).visible,{seq:6,card:task});
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
  let state=projection.init();for(const event of [start,call,result,end]) state=projection.stateSchema.parse(projection.apply(state,event));
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
test('普通问题与明确任务不被检查模型覆盖，两种配置遵循同样的优先级',()=>{
  const route='["p","m"]';
  for(const kind of ['next_task','session_choice']){
    const offer=ev('tool/call',{...call.data,arguments:JSON.stringify({...task,kind})});
    const local=run(start,offer,result,answer,end).visible.card;
    assert.equal(local.kind,'question');
    assert.equal(reviewRouteForCard(local,route),'');
    const offered=run(start,offer,result,end).visible.card;
    assert.equal(offered.kind,kind);assert.equal(reviewRouteForCard(offered,route),'');
  }
  const failed=ev('tool/result',{message:{toolCallId:'x',isError:true}});
  for(const {card} of [run(start,call,failed,end).visible,run(start,end).visible]){
    assert.equal(reviewRouteForCard(card,route),route);
    assert.equal(reviewRouteForCard(card,''),'');
  }
});
test('明确询问执行位置时，有任务才提供真正的会话路由',async()=>{
  const placement={...task,kind:'session_choice'}, route='["p","m"]';
  const offer=ev('tool/call',{...call.data,arguments:JSON.stringify(placement)});
  for (const text of ['在这里继续，还是在新会话中开始？','在本次会话继续，还是另开一个？','你希望在这里修改文档，还是在新会话中修改？','你希望在这里修复文档，还是在新会话中修复？','要我在新会话中开始吗？','Would you prefer a new chat or this chat?']) {
    const ask=ev('assistant/message',{message:{content:[{type:'text',text}]}});
    const routed=run(start,offer,result,ask,end).visible.card;
    assert.deepEqual(routed,placement);
    const {ctx,calls}=setup();const target=taskActions(routed.kind).at(-1);
    await deliver(ctx,{requestId:'placement'},target,routed.title+'\n\n'+routed.description,origin,()=>{});
    assert.equal(calls[0][0],'create');assert.deepEqual(calls.at(-1),['open','child']);
    const question=run(start,ask,end).visible.card;
    assert.equal(question.kind,'question');assert.equal(reviewRouteForCard(question,route),route);
    assert.deepEqual(reviewedCard(question,placement),placement);
    for(const fallback of [null,task])assert.deepEqual(reviewedCard(question,fallback),question);
  }
  for(const text of ['你想修改这里的图标，还是新会话的按钮？','Would you prefer a screenshot of this chat or a screenshot of a new chat?']){
    const aboutUI=ev('assistant/message',{message:{content:[{type:'text',text}]}});
    const question=run(start,offer,result,aboutUI,end).visible.card;
    assert.equal(question.kind,'question');assert.equal(reviewRouteForCard(question,route),'');
    const {ctx,calls}=setup();await deliver(ctx,{requestId:'reply'},'here',question.labels[1],origin,()=>{});
    assert.deepEqual(calls.map(c=>c.slice(0,2)),[['using','parent'],['prompt',[{type:'text',text:question.labels[1]}]]]);
  }
  assert.deepEqual(reviewedCard(null,task),task);
});
test('开放问题中的“还是”不会产生选项或盖住独立建议',()=>{
  const text='为什么重试后还是失败？';
  const ask=ev('assistant/message',{message:{content:[{type:'text',text}]}});
  assert.equal(run(start,ask,end).visible.card,null);
  assert.deepEqual(run(start,call,result,ask,end).visible.card,task);
});
function setup(){
  const calls=[]; let reject=false;
  const session={getSnapshot:()=>({openState:'open'}),prompt:async(...args)=>{calls.push(['prompt',...args]);return reject?{ok:false,error:{message:'offline'}}:{ok:true,value:{accepted:true}};}};
  const ctx={sessions:{create:async opts=>{calls.push(['create',opts]);return 'child';},using:async(id,opts,cb)=>{calls.push(['using',id]);return cb({binding:{session}});}},uiWorkspace:{openSession:id=>calls.push(['open',id])}};
  return {ctx,calls,failure:v=>{reject=v;}};
}
const origin={id:'parent',options:{workspaceId:'ws'}};
test('独立建议只发送到原会话，只有选择会话卡提供新会话操作',async()=>{
  const {ctx,calls}=setup(), text=task.title+'\n\n'+task.description;
  assert.deepEqual(taskActions('next_task'),['here']);
  for(const place of taskActions('next_task'))await deliver(ctx,{requestId:'offer'},place,text,origin,()=>{});
  assert.deepEqual(calls,[['using','parent'],['prompt',[{type:'text',text}],'queue',undefined,'offer']]);
  assert.deepEqual(taskActions('session_choice'),['here','new']);
});
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
