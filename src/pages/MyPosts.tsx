import { useNavigate } from "react-router-dom";
import { Bookmark, MessageSquareText, Plus } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { PostCard } from "../components/community/PostCard";
import { PostFeedGrid } from "../components/community/PostFeedGrid";

// Me > Posts. Rendered inside the profile (Profile.tsx); the old
// /profile/posts URL redirects there. Saved posts open from here.
export function MyPosts() {
  const { currentUser, posts } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const myPosts = posts.filter((p) => p.authorId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {myPosts.length > 0 ? (
          <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => navigate("/community/new")}>
            {t("myPosts.createPost")}
          </Button>
        ) : (
          <span />
        )}
        <button
          onClick={() => navigate("/saved-posts")}
          className="flex min-h-10 shrink-0 items-center gap-1.5 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
        >
          <Bookmark size={14} /> {t("myPosts.savedPosts")}
        </button>
      </div>

      {myPosts.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText size={20} />}
          title={t("myPosts.empty")}
          description={t("myPosts.emptyDesc")}
          action={
            <Button size="sm" onClick={() => navigate("/community/new")}>
              {t("myPosts.createPost")}
            </Button>
          }
        />
      ) : (
        <PostFeedGrid>
          {myPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </PostFeedGrid>
      )}
    </div>
  );
}
