import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bookmark } from "lucide-react";
import { useData } from "../context/DataContext";
import { EmptyState } from "../components/ui/EmptyState";
import { PostCard } from "../components/community/PostCard";
import { goBack } from "../lib/goBack";
import { useLocale } from "../i18n/LocaleContext";

export function SavedPosts() {
  const { savedPostsList } = useData();
  const navigate = useNavigate();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => goBack(navigate)}
        className="-my-2.5 flex items-center gap-1.5 self-start py-2.5 pr-3 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("savedPosts.title")}</h1>
        <p className="text-sm text-slate-500">{t("savedPosts.subtitle")}</p>
      </div>

      {savedPostsList.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={20} />}
          title={t("savedPosts.emptyTitle")}
          description={t("savedPosts.emptyDescription")}
          action={
            <button onClick={() => navigate("/community")} className="text-sm font-semibold text-fairway-700 hover:underline">
              {t("savedPosts.browseCommunity")}
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
