import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from '../src/pages/Home';
import { PostDetail } from '../src/pages/PostDetail';
import { RealCommunityProvider } from '../src/context/RealCommunityContext';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import { ToastProvider } from '../src/context/ToastContext';
import '../src/index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><LocaleProvider><ToastProvider><RealCommunityProvider><div style={{position:"fixed",top:0,left:0,right:0,zIndex:2147483647}} className="bg-amber-100 p-2 text-center text-xs font-bold text-amber-900">SYNTHETIC LOCAL TEST — {new URLSearchParams(location.search).get('version')} — no live accounts</div><main className="mx-auto max-w-2xl px-4 py-5"><Routes><Route path="/home" element={<Home/>}/><Route path="/community/:id" element={<PostDetail/>}/></Routes></main></RealCommunityProvider></ToastProvider></LocaleProvider></BrowserRouter>);
