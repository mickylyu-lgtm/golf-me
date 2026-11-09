import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";
import { BottomNav } from "./BottomNav";
import { TopBar } from "./TopBar";
import { RootTabCarousel } from "./RootTabCarousel";
import { DesktopChatLayout } from "./DesktopChatLayout";
import { NotificationPopupHost } from "../notifications/NotificationPopupHost";
import { NotificationRouteClearer } from "../notifications/NotificationRouteClearer";
import { FoundingRevealHost } from "../golfer/FoundingRevealHost";
import { CaddieDoneHaptic } from "../caddie/CaddieDoneHaptic";
import { SuspensionBanner } from "../moderation/SuspensionBanner";
import { MOBILE_NAV_ITEMS } from "../../lib/nav";
import { useChatRouteMotion } from "../../lib/useChatRouteMotion";
import { useIsDesktop } from "../../lib/useIsDesktop";

const ROOT_PATHS = new Set<string>(MOBILE_NAV_ITEMS.map((item) => item.path));

// Desktop (lg+) content width. Browsing screens (feeds, lists, dashboards)
// use the room: up to 72rem, with their own two-column grids. Everything
// else (detail pages, forms, settings, a conversation) keeps the 48rem
// reading column. Phones never see the difference: these are lg: classes.
const WIDE_EXACT = new Set<string>(["/", "/find", "/caddie", "/profile", "/community", "/golf-calls", "/my-rounds", "/saved-posts", "/profile/posts", "/discover", "/courses/nearby", "/tee-times"]);

// Two-pane chat needs room for a 340px list plus a conversation at least
// as wide as a phone, so it starts at xl (1280px); below that, chat keeps
// the single reading column.
const TWO_PANE_CHAT_MIN_WIDTH = 1280;

function contentWidthClass(pathname: string): string {
  if (isChatRoute(pathname)) return "xl:max-w-6xl xl:px-8";
  if (WIDE_EXACT.has(pathname) || pathname.startsWith("/admin/")) return "lg:max-w-6xl lg:px-8";
  return "";
}

// The chat list and its conversations: /messages, /messages/:id,
// /messages/round/:id.
function isChatRoute(pathname: string): boolean {
  return pathname === "/messages" || pathname.startsWith("/messages/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const twoPaneChatFits = useIsDesktop(TWO_PANE_CHAT_MIN_WIDTH);
  // Only the 5 root tabs get the swipeable carousel — everything else
  // (Golf Call detail, a golfer's profile, chat, forms, settings...) stays
  // on React Router's normal single-page-per-route rendering, so a
  // horizontal gesture inside those deeper screens can never throw the
  // user into a different main tab.
  const isRootTab = ROOT_PATHS.has(pathname);
  // Desktop chat is two panes (list + conversation), so the phone's
  // list <-> conversation slide doesn't apply there.
  const desktopChat = twoPaneChatFits && isChatRoute(pathname);
  const contentRef = useRef<HTMLDivElement>(null);
  useChatRouteMotion(contentRef);

  return (
    <div className="min-h-screen bg-page">
      <NotificationPopupHost />
      <NotificationRouteClearer />
      <FoundingRevealHost />
      <CaddieDoneHaptic />
      <SideNav />
      <div className="flex min-h-screen flex-col sm:pl-20 lg:pl-60">
        <TopBar />
        <main className="flex flex-1 flex-col pb-24 sm:pb-10">
          <SuspensionBanner />
          {/* flex-1 on both this wrapper and, for root tabs, on
              RootTabCarousel's own root — lets the swipe-detection region
              fill any leftover viewport space below a short tab's actual
              content (e.g. Chat with few conversations) without growing
              the page's scrollable height, since flex-1 only claims space
              already available in this column, never adds to it. */}
          {/* contentRef: the column the chat list <-> conversation
              transition moves (lib/useChatRouteMotion.ts); main clips its
              horizontal overflow while it runs. */}
          <div
            ref={desktopChat ? undefined : contentRef}
            className={`mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-8 ${contentWidthClass(pathname)}`}
          >
            {desktopChat ? (
              <DesktopChatLayout>{pathname === "/messages" ? null : children}</DesktopChatLayout>
            ) : isRootTab ? (
              <RootTabCarousel activePath={pathname} />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
