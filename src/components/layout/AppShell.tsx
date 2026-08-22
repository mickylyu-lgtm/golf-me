import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";
import { BottomNav } from "./BottomNav";
import { TopBar } from "./TopBar";
import { RootTabCarousel } from "./RootTabCarousel";
import { NotificationPopupHost } from "../notifications/NotificationPopupHost";
import { CaddieProcessingBanner } from "../caddie/CaddieProcessingBanner";
import { MOBILE_NAV_ITEMS } from "../../lib/nav";

const ROOT_PATHS = new Set<string>(MOBILE_NAV_ITEMS.map((item) => item.path));

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // Only the 5 root tabs get the swipeable carousel — everything else
  // (Golf Call detail, a golfer's profile, chat, forms, settings...) stays
  // on React Router's normal single-page-per-route rendering, so a
  // horizontal gesture inside those deeper screens can never throw the
  // user into a different main tab.
  const isRootTab = ROOT_PATHS.has(pathname);

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <NotificationPopupHost />
      <CaddieProcessingBanner />
      <SideNav />
      <div className="flex min-h-screen flex-col sm:pl-20 lg:pl-60">
        <TopBar />
        <main className="flex flex-1 flex-col pb-24 sm:pb-10">
          {/* flex-1 on both this wrapper and, for root tabs, on
              RootTabCarousel's own root — lets the swipe-detection region
              fill any leftover viewport space below a short tab's actual
              content (e.g. Chat with few conversations) without growing
              the page's scrollable height, since flex-1 only claims space
              already available in this column, never adds to it. */}
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-8">
            {isRootTab ? <RootTabCarousel activePath={pathname} /> : children}
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
