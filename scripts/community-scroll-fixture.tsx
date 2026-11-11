import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Community } from "../src/pages/Community";
import { PostDetail } from "../src/pages/PostDetail";
import { ScrollToTop } from "../src/components/layout/ScrollToTop";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { ToastProvider } from "../src/context/ToastContext";
import "../src/index.css";
export function Harness() {
  const navigate = useNavigate();
  useLayoutEffect(() => { (window as any).__navigate = navigate; }, [navigate]);
  return <><ScrollToTop /><main className="mx-auto max-w-3xl px-4 py-5 pb-24">
    <Routes><Route path="/community" element={<Community />} /><Route path="/community/:id" element={<PostDetail />} /><Route path="/other" element={<div style={{ height: 4000 }}>Other destination</div>} /></Routes>
  </main></>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><LocaleProvider><ToastProvider><Harness /></ToastProvider></LocaleProvider></BrowserRouter></StrictMode>);
