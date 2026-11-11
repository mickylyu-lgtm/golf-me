
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatComposer } from '../../src/components/chat/ChatComposer';
import { PausedChatComposer } from '../../src/components/chat/PausedChatComposer';
import { EditMessageBubble } from '../../src/components/chat/EditMessageBubble';
import { LocaleProvider } from '../../src/i18n/LocaleContext';
import '../../src/index.css';
let result = 'failed';
let calls: (string|undefined)[] = [];
let resolve: ((value: string) => void) | null = null;
export function Harness() {
  const [version,setVersion]=useState(0);
  const [open,setOpen]=useState(true);
  const [gone,setGone]=useState(false);
  const [draft,setDraft]=useState('Fixture draft stays here');
  Object.assign(window,{qa:{
    reset:()=>{calls=[];setGone(false);setVersion(v=>v+1);setOpen(true);},
    result:(value:string)=>{result=value;},
    calls:()=>calls,
    gone:()=>setGone(true),
    resolve:()=>resolve?.('edited'),
  }});
  return <LocaleProvider><main className="flex justify-end p-6"><div className="max-w-[75%]">{open?<EditMessageBubble key={version} initialText="Original" currentText="Original" gone={gone} onSave={async(text,expected)=>{calls.push(expected);if(result==='pending') return await new Promise(r=>{resolve=r;});return result as any;}} onClose={()=>setOpen(false)}/>:<p>Closed</p>}</div></main><PausedChatComposer paused={open}><ChatComposer value={draft} onChange={setDraft} onSend={()=>setDraft('')} disabled={open} placeholder="Type a message..." /></PausedChatComposer></LocaleProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
