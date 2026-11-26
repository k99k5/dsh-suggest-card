import {deliver, reviewedCard, reviewRouteForCard, taskActions, viewForTail} from './actions.js';
import {createSettings,settingsCopy,visibleCard} from './settings.js';

const ns = 'dsh-suggest-card';
const css = `
.dsc-wrap{max-width:37rem;min-width:0;margin-block:16px 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);overflow-wrap:anywhere}
.dsc-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:8px;color:inherit}
.dsc-card{width:100%;max-width:26rem;overflow:hidden;text-align:start;font:inherit}
.dsc-caption{padding:4px 12px;background:var(--dsw-alias-bg-layer-1);font-weight:550;line-height:1.4}
.dsc-caption-next{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-block:8px 0;padding-inline-end:8px}
.dsc-caption-next>.dsc-close{flex:none;margin-block:-4px}
.dsc-body{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:4px;padding:6px 8px 6px 12px}
.dsc-caption-next+.dsc-body{display:block;padding-inline:12px}
.dsc-copy{display:grid;gap:2px}.dsc-title{font-weight:550;line-height:1.45}.dsc-desc{color:var(--dsw-alias-label-secondary);line-height:1.5;white-space:pre-wrap}
.dsc-actions,.dsc-placements,.dsc-replies{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.dsc-actions,.dsc-replies{padding:0 12px 6px}.dsc-placements{max-width:100%;margin-inline-start:auto;justify-content:flex-end}.dsc-actions .dsc-btn:not(.dsc-primary){background:transparent}.dsc-question{padding:6px 12px}
.dsc-wrap button{cursor:pointer}.dsc-btn,.dsc-close{border:0;font:inherit;color:inherit}.dsc-btn{max-width:100%;padding:6px 12px;border-radius:6px;line-height:1.4;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
.dsc-btn.dsc-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}.dsc-close{font-size:1.25em;background:transparent;line-height:1;width:28px;height:28px;border-radius:5px}
.dsc-wrap button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsc-wrap button:disabled{opacity:.6;cursor:default}
@media(hover:hover){.dsc-close:hover:not(:disabled),.dsc-btn:not(.dsc-primary):hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dsc-primary:hover:not(:disabled){opacity:.85}}
.dsc-note{color:var(--dsw-alias-label-secondary);margin-top:5px}.dsc-error{color:var(--dsw-alias-state-error-primary)}
`;
const dict = {
  zh:{next:'下一步建议',placement:'选择会话',here:'在这里做',new:'在新会话中开始',close:'关闭建议',sent:'已发送',busy:'正在发送…',failed:'未确认发送，请重试：',reply:'快捷回复',replyHint:'请选择本轮问题的答复。',unavailable:'当前不可发送'},
  en:{next:'Suggested next step',placement:'Choose a session',here:'Do it here',new:'Start in a new session',close:'Dismiss suggestion',sent:'Sent',busy:'Sending…',failed:'Delivery not confirmed. Retry: ',reply:'Quick reply',replyHint:'Choose a reply to the question above.',unavailable:'Sending unavailable'}
};

window.__ModuleLoader__.load({id:'@k99k5/dsh-suggest-card',factory(require){
  const React = require('react'), h = React.createElement;
  return {inject:['slots','locale','sessions','uiWorkspace','configForms'],apply(ctx){
    const uiLocale = `${ns}.ui`;
    ctx.effect(()=>ctx.locale.register(uiLocale,{zh:{...dict.zh,...settingsCopy.zh},en:{...dict.en,...settingsCopy.en}}));
    const t = ctx.locale.bind(uiLocale);
    const {Page,useSettings}=createSettings(React,ctx.configForms.get(ns),t);
    ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:ns,order:95,label:()=>t('page'),locale:uiLocale},Page));
    // Only opaque routing receipts are stored, never task text or replies.
    const memory = new Map(), locks = new Set();
    function save(key, state){ memory.set(key,state); try {sessionStorage.setItem(key,JSON.stringify(state));} catch {} }
    function load(key){ if(memory.has(key)) return memory.get(key); try {return JSON.parse(sessionStorage.getItem(key)) || {};} catch {return {};} }
    function Card({card, origin, identity, allowHere, allowNew}){
      const [receipt,setReceipt] = React.useState(()=>load(identity));
      const [busy,setBusy] = React.useState(false), [error,setError] = React.useState('');
      const remember = state => {save(identity,state);setReceipt({...state});};
      async function send(where, text, action){
        const prior = load(identity);
        if(locks.has(identity) || prior.done || prior.dismissed || (where==='new' ? !allowNew : !allowHere) || (prior.possiblySent && prior.action!==action)) return;
        locks.add(identity);setBusy(true);setError('');
        try {
          const attempt = prior.action===action ? {...prior} : {action,requestId:crypto.randomUUID()};
          remember(attempt);
          await deliver(ctx,attempt,where,text,origin,()=>remember(attempt));
        } catch(e){setError(e.message || String(e));}
        finally{locks.delete(identity);setBusy(false);}
      }
      if(receipt.dismissed) return null;
      if(receipt.done) return h('div',{className:'dsc-wrap dsc-note',role:'status'}, t('sent'));
      const text = card.kind==='question' ? '' : `${card.title}\n\n${card.description}`;
      const disabled = (action, where) => busy || !!(receipt.possiblySent && receipt.action!==action) || (where==='new' ? !allowNew : !allowHere);
      const btn = (label,action,where,value,primary) => h('button',{type:'button',key:action,className:'dsc-btn'+(primary?' dsc-primary':''),disabled:disabled(action,where),onClick:()=>send(where,value,action)},label);
      let content;
      if(card.kind==='question') content=h('div',{className:'dsc-card',role:'group','aria-label':card.description||t('reply')},
        h('div',{className:'dsc-caption'},t('reply')),
        h('div',{className:'dsc-question dsc-desc'},card.description||t('replyHint')),
        h('div',{className:'dsc-replies'},card.labels.map((label,i)=>btn(label,String(i),'here',label,i===0))));
      else {
        const isNext=card.kind==='next_task';
        const close=h('button',{type:'button',className:'dsc-close',disabled:busy,title:t('close'),'aria-label':t('close'),onClick:()=>remember({dismissed:true})},'×');
        content=h('div',{className:'dsc-card',role:'group','aria-label':card.title},
          h('div',{className:isNext?'dsc-caption dsc-caption-next':'dsc-caption'},t(isNext?'next':'placement'),isNext&&close),
          h('div',{className:'dsc-body'},
            h('div',{className:'dsc-copy'},h('span',{className:'dsc-title'},card.title),h('span',{className:'dsc-desc'},card.description)),
            !isNext&&close),
          h('div',{className:'dsc-actions'},h('div',{className:'dsc-placements'},taskActions(card.kind).map(where=>btn(t(where),where,where,text,isNext||where==='new')))));
      }
      const denied = !allowHere && !(card.kind==='session_choice' && allowNew);
      return h('div',{className:'dsc-wrap'},h('style',null,css),content,h('div',{role:'status',className:'dsc-note'+(error?' dsc-error':'')},error?t('failed')+error:busy?t('busy'):denied?t('unavailable'):null));
    }
    function Reviewed({lookup,local,...props}){
      const [result,setResult]=React.useState(null);
      React.useEffect(()=>{const c=new AbortController();
        fetch(`api/dsh-suggest-card.result?key=${encodeURIComponent(lookup)}`,{signal:c.signal,cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(!c.signal.aborted)setResult(r);}).catch(()=>{if(!c.signal.aborted)setResult({error:true});});return ()=>c.abort();},[lookup]);
      if(!result)return null;
      const card=reviewedCard(local,result.card);
      if(!card && result.error)return h('small',{role:'status'},t('reviewError'));
      return card?h(Card,{...props,card}):null;
    }
    function Tail(p){
      const settings=useSettings();
      const view = p.useProjection('suggestCardV2',v=>viewForTail(p,v));
      const allowHere = p.useAccess('session/prompt');
      const allowCreate = p.useRemoteAccess('session/create');
      const cwd = p.useSessions(v=>v.byId[p.sessionId]?.cwd);
      const workspaceId = p.useWorkspaces(v=>v.items.find(w=>w.sessionIds.includes(p.sessionId))?.workspaceId);
      if(!view || !visibleCard(settings)) return null;
      const lookup=`${p.sessionId}:${view.seq}`,route=reviewRouteForCard(view.card,settings.value.reviewModel);
      const identity=`${ns}:${lookup}:${route||'local'}`;
      const props={key:identity,identity,allowHere,allowNew:allowHere&&allowCreate&&!!(workspaceId||cwd),origin:{id:p.sessionId,options:workspaceId?{workspaceId}:{cwd}}};
      return route?h(Reviewed,{...props,lookup,local:view.card}):view.card?h(Card,{...props,card:view.card}):null;
    }
    ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:ns,order:-5},Tail));
  }};
}});
