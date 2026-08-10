import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bookmark } from "lucide-react";
import { useData } from "../context/DataContext";
import { EmptyState } from "../components/ui/EmptyState";
import { PostCard } from "../components/community/PostCard";

export function SavedPosts() {
  const { savedPostsList } = useData();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Saved Posts</h1>
        <p className="text-sm text-slate-500">Memes, advice, and discussions you've saved for later.</p>
      </div>

      {savedPostsList.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={20} />}
          title="Nothing saved yet."
          description="Tap the save icon on any Community post to keep it here."
          action={
            <button onClick={() => navigate("/community")} className="text-sm font-semibold text-fairway-700 hover:underline">
              Browse Community
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {savedPostsList.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
