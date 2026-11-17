import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import { ToastProvider } from '../src/context/ToastContext';
import { PostShareButton } from '../src/components/community/PostShareButton';
import '../src/index.css';
createRoot(document.getElementById('root')!).render(<LocaleProvider><ToastProvider><main className="p-6"><PostShareButton postId="3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10" /></main></ToastProvider></LocaleProvider>);
