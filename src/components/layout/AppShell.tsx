import type { ReactNode } from "react";
import { SideNav } from "./SideNav";
import { BottomNav } from "./BottomNav";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf8f2]">
      <SideNav />
      <div className="flex min-h-screen flex-col sm:pl-20 lg:pl-60">
        <TopBar />
        <main className="flex-1 pb-24 sm:pb-10">
          <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
