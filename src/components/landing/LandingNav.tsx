import { useNavigate } from "react-router-dom";
import { GolfMeIcon } from "../brand/GolfMeIcon";
import { GolfMeWordmark } from "../brand/GolfMeWordmark";
import { useLocale } from "../../i18n/LocaleContext";

// Deliberately minimal — logo, two anchor links, Log In, Join Waitlist.
// Never the authenticated app's Home/Play/Caddie/Me nav, which stays gated
// behind a real session (see AppShell/BottomNav/SideNav, untouched by this
// page).
export function LandingNav() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-fairway-950/90 backdrop-blur-sm">
      {/* Installed-PWA/native-wrapper standalone mode has no browser chrome
          above this nav — it sits flush under the status bar/notch without
          safe-area padding, which visibly collided with the clock/battery
          icons and made Log In/Join Waitlist hard to tap (reported live).
          Same max(fallback, env(...)) pattern already used for BottomNav/
          CaddieProcessingBanner/NotificationPopupHost. */}
      <div
        className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 pb-3 sm:gap-3 sm:px-6"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 shrink items-center gap-5 sm:gap-8">
          <span className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
            <GolfMeIcon size={20} className="shrink-0" dotColor="#f8faf8" flagColor="#86efac" holeColor="#166534" />
            <span className="truncate text-sm font-extrabold tracking-tight sm:text-base">
              <GolfMeWordmark golfClassName="text-white" meClassName="text-sun-300" />
            </span>
          </span>
          <div className="hidden items-center gap-5 sm:flex">
            <a href="#how-it-works" className="text-sm font-semibold text-fairway-100 transition-colors hover:text-white">
              {t("landing.nav.howItWorks")}
            </a>
            <a href="#caddie" className="text-sm font-semibold text-fairway-100 transition-colors hover:text-white">
              {t("landing.nav.caddie")}
            </a>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <button
            onClick={() => navigate("/login")}
            className="whitespace-nowrap rounded-full px-2 py-1.5 text-xs font-semibold text-fairway-100 transition-colors hover:text-white sm:text-sm"
          >
            {t("welcome.logIn")}
          </button>
          <a
            href="#waitlist"
            className="whitespace-nowrap rounded-full bg-sun-400 px-2.5 py-1.5 text-xs font-bold text-fairway-950 shadow-sm transition hover:bg-sun-300 sm:px-4 sm:text-sm"
          >
            {t("landing.nav.joinWaitlist")}
          </a>
        </div>
      </div>
    </nav>
  );
}
