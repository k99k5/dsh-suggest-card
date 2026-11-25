import {createAutosave} from './autosave.js';
export const settingsCopy = {
  zh:{page:'下一步建议',enabled:'启用下一步建议',model:'检查模型',local:'不调用外部模型',loading:'正在读取设置…',unavailableForm:'设置暂不可用',readonly:'当前配置只读',saving:'正在保存…',saveError:'设置未保存，请重试。',catalogError:'未能读取模型列表',empty:'暂无可选模型',retry:'重新加载模型',privacy:'选择模型后，本轮用户文字和最终回复会发送给该模型，可能产生费用。',reviewError:'本轮建议检查未完成。'},
  en:{page:'Next step cards',enabled:'Enable next step cards',model:'Review model',local:'No external model',loading:'Loading settings…',unavailableForm:'Settings unavailable',readonly:'These settings are read-only',saving:'Saving…',saveError:'Settings not saved. Try again.',catalogError:'Could not load models',empty:'No models available',retry:'Reload models',privacy:'Selecting a model sends the user text and final reply from each turn to that model. Charges may apply.',reviewError:'The suggestion check did not complete.'}
};
export function visibleCard(snapshot) {
  return snapshot.status==='ready' && snapshot.value?.enabled===true;
}
export function createSettings(React,form,t) {
  const h=React.createElement, subscribe=fn=>form.subscribe(fn), read=()=>form.getSnapshot();
  const editor=createAutosave(form);
  function useSettings(){return React.useSyncExternalStore(subscribe,read);}
  function Page(){
    const snap=useSettings(), {draft,saving,error}=React.useSyncExternalStore(editor.subscribe,editor.read);
    const [models,setModels]=React.useState(null),[load,setLoad]=React.useState(0),[catalogError,setCatalogError]=React.useState(false);
    React.useEffect(()=>{const c=new AbortController();setCatalogError(false);setModels(null);
      fetch('api/dsh-suggest-card.models',{signal:c.signal,cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(list=>{if(!Array.isArray(list))throw Error();if(!c.signal.aborted)setModels(list);}).catch(()=>{if(!c.signal.aborted)setCatalogError(true);});return ()=>c.abort();},[load]);
    const route=draft.reviewModel??snap.value?.reviewModel??'', locked=!snap.writable,change=editor.change;
    const notice=snap.status!=='ready'?(snap.status==='loading'?'loading':'unavailableForm'):!snap.writable?'readonly':saving?'saving':error?'saveError':null;
    return h('section',{className:'dsc-settings'},h('style',null,`
      .dsc-settings{color:var(--dsw-alias-label-primary);font:inherit}.dsc-settings h2{font-size:1.1em;margin:0 0 16px;font-weight:600}
      .dsc-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.dsc-setting span{min-width:0;overflow-wrap:anywhere}
      .dsc-setting input{appearance:none;position:relative;flex:none;width:36px;height:22px;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
      .dsc-setting input::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.dsc-setting input:checked{background:var(--dsw-alias-label-primary)}.dsc-setting input:checked::after{left:17px;background:var(--dsw-alias-bg-base)}
      .dsc-setting input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dsc-setting input:disabled{opacity:.55;cursor:default}.dsc-settings p{color:var(--dsw-alias-label-secondary)}
      @media(forced-colors:active){.dsc-setting input{appearance:auto}.dsc-setting input::after{display:none}}
      .dsc-setting select{max-width:65%;min-width:0;font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px}.dsc-settings small{color:var(--dsw-alias-label-secondary)}
    `),h('h2',null,t('page')),snap.status==='ready'&&h(React.Fragment,null,
      h('label',{className:'dsc-setting'},t('enabled'),h('input',{type:'checkbox',role:'switch',checked:draft.enabled??visibleCard(snap),disabled:locked,onChange:e=>void change('enabled',e.target.checked)})),
      h('label',{className:'dsc-setting'},t('model'),h('select',{value:route,disabled:locked,onChange:e=>void change('reviewModel',e.target.value)},h('option',{value:''},t('local')),route&&!models?.some(m=>m.id===route)&&h('option',{value:route},route),models?.map(m=>h('option',{key:m.id,value:m.id},m.label)))),
      h('p',null,h('small',null,t('privacy'))), (catalogError||models?.length===0)&&h('p',null,t(catalogError?'catalogError':'empty'),' ',h('button',{type:'button',onClick:()=>setLoad(n=>n+1)},t('retry')))),h('p',{role:'status'},notice?t(notice):null));
  }
  return {Page,useSettings};
}
