import { NavLink } from "react-router-dom";
import { Flag } from "lucide-react";
import { NAV_ITEMS } from "../../lib/nav";

export function SideNav() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-slate-200 bg-white py-6 sm:flex lg:w-60">
      <div className="mb-8 flex items-center gap-2 px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fairway-600 text-white">
          <Flag size={18} fill="currentColor" />
        </span>
        <span className="hidden text-lg font-extrabold tracking-tight text-fairway-900 lg:inline">Golf Me</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive ? "bg-fairway-50 text-fairway-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`
            }
          >
            <Icon size={20} />
            <span className="hidden lg:inline">{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
