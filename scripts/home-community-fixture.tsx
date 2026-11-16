import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Home } from '../src/pages/Home';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import { ToastProvider } from '../src/context/ToastContext';
import '../src/index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><LocaleProvider><ToastProvider><div className="bg-amber-100 p-2 text-center text-xs font-bold text-amber-900">SYNTHETIC LOCAL TEST — {new URLSearchParams(location.search).get('version')} — no live accounts</div><main className="mx-auto max-w-2xl px-4 py-5"><Home /></main></ToastProvider></LocaleProvider></BrowserRouter>);
