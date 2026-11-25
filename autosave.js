// Shared by page mounts. Only the editor sees pending values; behavior uses Host receipts.
export function createAutosave(form){
  const pending=new Map(), listeners=new Set(), failed=new Set();
  let running=false, scheduled=false, state={draft:{},saving:false,error:false};
  function notify(){state={draft:Object.fromEntries([...pending].map(([k,v])=>[k,v.value])),saving:pending.size>0,error:failed.size>0};for(const fn of listeners)fn();}
  async function drain(){
    scheduled=false;if(running)return;running=true;
    try{while(pending.size){
      const batch=[...pending];let ok=false;
      try{ok=await form.mutate(batch.map(([key,item])=>({op:'set',path:[key],value:item.value})));}catch{/* The accepted form snapshot remains authoritative. */}
      for(const [key,item] of batch){if(pending.get(key)!==item)continue;pending.delete(key);if(!ok)failed.add(key);}
      notify();
    }}finally{running=false;}
  }
  return {read:()=>state,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},change(key,value){
    if(!form.getSnapshot().writable)return;
    failed.delete(key);pending.set(key,{value});notify();
    if(!running&&!scheduled){scheduled=true;queueMicrotask(drain);}
  }};
}
