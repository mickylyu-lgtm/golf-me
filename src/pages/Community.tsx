import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageSquareText, Plus, Search } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PostCard } from "../components/community/PostCard";
import { rankForYou, rankFollowing, rankNearby } from "../lib/communityFeed";
import type { FeedContext } from "../lib/communityFeed";

type FeedTab = "forYou" | "following" | "nearby";
const TABS: { value: FeedTab; labelKey: "community.tabForYou" | "community.tabFollowing" | "community.tabNearby" }[] = [
  { value: "forYou", labelKey: "community.tabForYou" },
  { value: "following", labelKey: "community.tabFollowing" },
  { value: "nearby", labelKey: "community.tabNearby" },
];

export function Community() {
  const { currentUser, getGolfer, visiblePosts, followingGolfers } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FeedTab>("forYou");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const ctx: FeedContext = useMemo(
    () => ({
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      areaLabel: currentUser.areaLabel,
    }),
    [followingGolfers, currentUser.areaLabel],
  );

  const basePosts = useMemo(() => visiblePosts(), [visiblePosts]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return basePosts;
    return basePosts.filter((p) => {
      const author = getGolfer(p.authorId);
      return (
        p.text.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.courseTag ?? "").toLowerCase().includes(q) ||
        (author?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [basePosts, search, getGolfer]);

  const feed = useMemo(() => {
    if (tab === "following") return rankFollowing(searched, ctx);
    if (tab === "nearby") return rankNearby(searched, ctx, getGolfer);
    return rankForYou(searched);
  }, [tab, searched, ctx, getGolfer]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("community.title")}</h1>
          <p className="text-sm text-slate-500">{t("community.subtitle")}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowSearch((v) => !v)}
            aria-label="Search Community"
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-150 ${
              showSearch ? "border-fairway-300 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            <Search size={16} />
          </button>
          <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate("/community/new")}>
            {t("community.createPost")}
          </Button>
        </div>
      </div>

      {showSearch && (
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("community.searchPlaceholder")}
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-fairway-400"
        />
      )}

      <div className="flex rounded-full border border-slate-200 bg-white p-1">
        {TABS.map((tabOption) => (
          <button
            key={tabOption.value}
            onClick={() => setTab(tabOption.value)}
            className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
              tab === tabOption.value ? "bg-fairway-600 text-white" : "text-slate-500"
            }`}
          >
            {t(tabOption.labelKey)}
          </button>
        ))}
      </div>

      {feed.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText size={20} />}
          title={search ? t("community.emptyNoSearch") : t("community.emptyDefault")}
          description={
            tab === "following" ? t("community.emptyFollowing") : tab === "nearby" ? t("community.emptyNearby") : t("community.emptyForYou")
          }
          action={
            <Button size="sm" onClick={() => navigate("/community/new")}>
              {t("community.createPost")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
