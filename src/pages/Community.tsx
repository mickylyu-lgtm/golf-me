import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquareText, Plus, Search } from "lucide-react";
import { useData } from "../context/DataContext";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PostCard } from "../components/community/PostCard";
import { rankForYou, rankFollowing, rankNearby } from "../lib/communityFeed";
import type { FeedContext } from "../lib/communityFeed";

type FeedTab = "forYou" | "following" | "nearby";
const TABS: { value: FeedTab; label: string }[] = [
  { value: "forYou", label: "For You" },
  { value: "following", label: "Following" },
  { value: "nearby", label: "Nearby" },
];

export function Community() {
  const { currentUser, getGolfer, visiblePosts, followingGolfers, circleGolfers, postUpvoteCount } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FeedTab>("forYou");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const ctx: FeedContext = useMemo(
    () => ({
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      circleIds: new Set(circleGolfers.map((g) => g.id)),
      preferredCourses: currentUser.preferredCourses,
      areaLabel: currentUser.areaLabel,
      upvoteCount: postUpvoteCount,
    }),
    [followingGolfers, circleGolfers, currentUser.preferredCourses, currentUser.areaLabel, postUpvoteCount],
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
    return rankForYou(searched, ctx, getGolfer);
  }, [tab, searched, ctx, getGolfer]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Community</h1>
          <p className="text-sm text-slate-500">Golf talk, memes, course chat, and rounds looking for players.</p>
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
            Create Post
          </Button>
        </div>
      </div>

      {showSearch && (
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search posts, golfers, courses, categories..."
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-fairway-400"
        />
      )}

      <div className="flex rounded-full border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
              tab === t.value ? "bg-fairway-600 text-white" : "text-slate-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feed.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText size={20} />}
          title={search ? "No posts match your search." : "Nothing here yet."}
          description={
            tab === "following"
              ? "Follow a few golfers to see their posts here."
              : tab === "nearby"
                ? "Nothing from your area yet — check back soon."
                : "Be the first to start a conversation."
          }
          action={
            <Button size="sm" onClick={() => navigate("/community/new")}>
              Create Post
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
