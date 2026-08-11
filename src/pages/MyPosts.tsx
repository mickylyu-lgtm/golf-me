import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { PostCard } from "../components/community/PostCard";

export function MyPosts() {
  const { currentUser, posts } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const myPosts = posts.filter((p) => p.authorId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("myPosts.title")}</h1>
          <p className="text-sm text-slate-500">{t("myPosts.subtitle")}</p>
        </div>
        <button
          onClick={() => navigate("/saved-posts")}
          className="shrink-0 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
        >
          {t("myPosts.savedPosts")}
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
        <div className="flex flex-col gap-3">
          {myPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
