import { useState } from "react";
import { ChevronDown, Flag } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import { ProfileSwitcher } from "./ProfileSwitcher";

export function TopBar() {
  const { currentUser } = useData();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-[#faf8f2]/90 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="flex items-center gap-2 sm:hidden">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fairway-600 text-white">
            <Flag size={16} fill="currentColor" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-fairway-900">Golf Me</span>
        </div>
        <div className="hidden sm:block" />
        <button
          onClick={() => setSwitcherOpen(true)}
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 shadow-sm transition hover:border-fairway-300"
        >
          <Avatar golfer={currentUser} size="xs" />
          <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{currentUser.name}</span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
      </header>
      {switcherOpen && <ProfileSwitcher onClose={() => setSwitcherOpen(false)} />}
    </>
  );
}
