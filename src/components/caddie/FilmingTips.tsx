import { useState } from "react";
import { Camera, ChevronDown, MoveHorizontal, PersonStanding, Smartphone, Sun, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";

// How to film a clip Caddie can read. Most failed analyses are clips where
// Roboflow never sees a whole body (pose_not_found), so the upload screen
// shows these before the golfer picks a video, and the failure card shows
// them again. On the upload screen it can be folded away; that choice is
// remembered per device (a convenience only: without storage it just
// starts open).
const COLLAPSED_KEY = "golfme:caddieFilmingTipsCollapsed";

const TIPS: { icon: LucideIcon; key: TranslationKey }[] = [
  { icon: PersonStanding, key: "caddie.tips.wholeBody" },
  { icon: MoveHorizontal, key: "caddie.tips.distance" },
  { icon: Smartphone, key: "caddie.tips.phone" },
  { icon: Sun, key: "caddie.tips.light" },
  { icon: Camera, key: "caddie.tips.angle" },
];

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage blocked: the card simply opens again next time.
  }
}

export function TipList({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  return (
    <ul className={`flex flex-col gap-1.5 ${className}`}>
      {TIPS.map(({ icon: Icon, key }) => (
        <li key={key} className="flex items-start gap-2 text-xs leading-snug">
          <Icon size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FilmingTips() {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  }

  return (
    <div className="rounded-xl bg-fairway-50/60 text-fairway-800" data-testid="caddie-filming-tips">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold"
      >
        <span className="flex items-center gap-2">
          <Video size={14} className="shrink-0" aria-hidden="true" />
          {t("caddie.tips.title")}
        </span>
        <span className="flex items-center gap-1 font-medium text-fairway-700">
          {collapsed ? t("caddie.tips.show") : t("caddie.tips.hide")}
          <ChevronDown size={14} aria-hidden="true" className={`motion-safe:transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </span>
      </button>
      {!collapsed && <TipList className="px-3 pb-2.5" />}
    </div>
  );
}
