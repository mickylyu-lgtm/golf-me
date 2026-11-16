import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, SearchModal } from '../src/components/ui/Modal';
import '../src/index.css';
function Fixture() {
 const [open,setOpen]=useState(false); const [nested,setNested]=useState(false); const [kind,setKind]=useState('default');
 Object.assign(window,{openSheet: (k='default')=>{setKind(k);setOpen(true)},closeParent:()=>setOpen(false)});
 const content=<><button onClick={()=>setNested(true)}>Open nested</button>{Array.from({length:40},(_,i)=><p key={i} style={{padding:16}}>Settings row {i}</p>)}</>;
 return <><div style={{height:3000,paddingTop:200}}>Profile background</div>{open && (kind==='search'? <SearchModal title="Settings and more" searchHeader={<input placeholder="Search"/>} onClose={()=>setOpen(false)}>{content}</SearchModal>:<Modal title="Settings and more" keyboardAware={kind==='keyboard'} onClose={()=>setOpen(false)}>{content}</Modal>)}{nested&&<Modal title="Nested" onClose={()=>setNested(false)}>Nested content</Modal>}</>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
