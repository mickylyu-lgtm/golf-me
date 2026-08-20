import { NavLink } from "react-router-dom";
import { MOBILE_NAV_ITEMS } from "../../lib/nav";
import { useLocale } from "../../i18n/LocaleContext";
import { useData } from "../../context/DataContext";

export function BottomNav() {
  const { t } = useLocale();
  const { dmConversations } = useData();
  const unreadCount = dmConversations.filter((c) => c.unread).length;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur-sm sm:hidden">
      {MOBILE_NAV_ITEMS.map(({ labelKey, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors duration-200 ease-out active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-inset motion-reduce:transition-none ${
              isActive ? "text-fairway-700" : "text-slate-400"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {/* Fixed-height wrapper keeps every label starting at the
                  same offset regardless of icon size — Caddie's icon
                  renders larger (so its "AI" lettering stays legible)
                  but must not push its label out of line with its
                  siblings' labels below. */}
              <span className="relative flex h-7 items-center justify-center">
                <Icon size={path === "/caddie" ? 28 : 22} strokeWidth={isActive ? 2.5 : 2} />
                {path === "/messages" && unreadCount > 0 && (
                  <span
                    className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-fairway-500 px-1 text-[9px] font-bold leading-none text-white"
                    aria-label={`${unreadCount} unread messages`}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              {t(labelKey)}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
