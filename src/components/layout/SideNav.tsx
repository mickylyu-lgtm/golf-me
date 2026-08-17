import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/nav";
import { GolfMeLogo } from "../brand/GolfMeLogo";
import { useLocale } from "../../i18n/LocaleContext";

export function SideNav() {
  const { t } = useLocale();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-slate-200 bg-white py-6 sm:flex lg:w-60">
      <div className="mb-8 px-5">
        <GolfMeLogo size={20} wordmarkClassName="hidden text-lg font-extrabold tracking-tight lg:inline" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ labelKey, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none ${
                isActive
                  ? "bg-fairway-50 text-fairway-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 active:bg-slate-100"
              }`
            }
          >
            {/* Caddie's icon carries small "AI" lettering the other
                glyphs don't, so it's rendered a bit larger than its
                siblings to keep that detail legible. */}
            <Icon size={path === "/caddie" ? 24 : 20} />
            <span className="hidden lg:inline">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
