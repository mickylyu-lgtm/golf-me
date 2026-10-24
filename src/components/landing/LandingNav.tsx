import { useNavigate } from "react-router-dom";
import { GolfMeIcon } from "../brand/GolfMeIcon";
import { GolfMeWordmark } from "../brand/GolfMeWordmark";
import { AppStoreButton } from "./AppStoreButton";
import { useActiveSection } from "./Interactive";
import { useLocale } from "../../i18n/LocaleContext";

// Public landing nav: logo, section anchors (desktop), Log In, and the App
// Store button as the one highlighted action. Never the authenticated
// app's Home/Play/Caddie/Me nav, which stays gated behind a real session
// (see AppShell/BottomNav/SideNav, untouched by this page). Anchors are
// plain <a href="#..."> so they work in the static prerender with no JS.
export function LandingNav() {
  const { t } = useLocale();
  const navigate = useNavigate();

  const anchors: { id: string; label: string }[] = [
    { id: "find-partners", label: t("landing.nav.findPartners") },
    { id: "community", label: t("landing.nav.community") },
    { id: "caddie", label: t("landing.nav.caddie") },
    { id: "how-it-works", label: t("landing.nav.howItWorks") },
  ];
  const active = useActiveSection(anchors.map((a) => a.id));

  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-fairway-950/85 backdrop-blur-md" aria-label="Main">
      {/* Installed-PWA/native-wrapper standalone mode has no browser chrome
          above this nav — it sits flush under the status bar/notch, so pad
          by the safe-area inset (same max(fallback, env(...)) pattern as
          BottomNav/CaddieProcessingBanner). */}
      <div
        className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 pb-3 sm:gap-3 sm:px-6"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 shrink items-center gap-5 lg:gap-8">
          <a href="/" className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2" aria-label="GolfMe home">
            <GolfMeIcon size={22} className="shrink-0" dotColor="#f8faf8" flagColor="#86efac" holeColor="#052e16" />
            <span className="truncate text-base font-extrabold tracking-tight sm:text-lg">
              <GolfMeWordmark golfClassName="text-white" meClassName="text-sun-300" />
            </span>
          </a>
          <div className="hidden items-center gap-5 lg:flex">
            {anchors.map((a) => (
              <a
                key={a.id}
                href={`#${a.id}`}
                aria-current={active === a.id ? "location" : undefined}
                className={`relative text-sm font-semibold transition-colors hover:text-white ${active === a.id ? "text-white" : "text-fairway-100"}`}
              >
                {a.label}
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-1.5 left-0 h-0.5 rounded-full bg-sun-300 transition-all duration-300 ${active === a.id ? "w-full" : "w-0"}`}
                />
              </a>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <button
            onClick={() => navigate("/login")}
            className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold text-fairway-100 transition-colors hover:text-white sm:text-sm"
          >
            {t("welcome.logIn")}
          </button>
          <AppStoreButton size="sm" placement="nav" />
        </div>
      </div>
    </nav>
  );
}
