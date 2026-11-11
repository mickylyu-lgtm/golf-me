import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { LocaleProvider, useLocale } from "../src/i18n/LocaleContext";
import { ToastProvider } from "../src/context/ToastContext";
import { CreatePost } from "../src/pages/CreatePost";
import { PostCard } from "../src/components/community/PostCard";
import { FixtureProvider, qa } from "./official-post-context";
import "../src/index.css";
export function Fixture() {
  const navigate = useNavigate(); const { setLocale } = useLocale();
  (window as any).officialQa.navigate = navigate;
  (window as any).officialQa.setLocale = setLocale;
  const base = { id: "qa-official", authorId: "qa-admin-a", text: "Local synthetic announcement", type: "text", category: "General", createdAt: new Date().toISOString() };
  return <main className="mx-auto max-w-lg p-3">
    <p className="mb-3 text-xs text-slate-500">Local synthetic QA. No live accounts or posts.</p>
    <Routes>
      <Route path="/" element={<button onClick={() => navigate("/community/new")}>New post</button>} />
      <Route path="/community/new" element={<CreatePost />} />
      <Route path="/community" element={<><button onClick={() => navigate("/community/new")}>New post</button>
        <section data-testid="published">{qa.posts.map(post => <PostCard key={post.id} post={post} />)}</section>
        <section data-testid="official-feed"><PostCard post={{ ...base, isOfficial: true } as any} /></section>
        <section data-testid="official-detail"><PostCard post={{ ...base, isOfficial: true } as any} linkToDetail={false} /></section>
        <section data-testid="ordinary"><PostCard post={{ ...base, id: "qa-ordinary" } as any} /></section>
      </>} />
      <Route path="/community/:id" element={<p data-testid="check-post">Check publication before retrying.</p>} />
    </Routes>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={["/community/new"]}><FixtureProvider><LocaleProvider><ToastProvider><Fixture /></ToastProvider></LocaleProvider></FixtureProvider></MemoryRouter></StrictMode>);
