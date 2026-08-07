import { useNavigate } from "react-router-dom";
import { ChevronDown, Flag } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";

export function TopBar() {
  const { currentUser } = useData();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-[#faf8f2]/90 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-2 sm:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fairway-600 text-white">
          <Flag size={16} fill="currentColor" />
        </span>
        <span className="text-lg font-extrabold tracking-tight text-fairway-900">Golf Me</span>
      </div>
      <div className="hidden sm:block" />
      <button
        onClick={() => navigate("/settings")}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <Avatar golfer={currentUser} size="xs" />
        <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{currentUser.name}</span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>
    </header>
  );
}
