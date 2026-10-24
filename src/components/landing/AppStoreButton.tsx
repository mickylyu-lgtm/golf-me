import { APP_STORE_URL } from "../../lib/appStore";
import { useLocale } from "../../i18n/LocaleContext";

interface AppStoreButtonProps {
  /** "lg" for hero/bottom CTAs, "sm" for the sticky nav. */
  size?: "lg" | "sm";
  /** Where on the page this button sits — recorded on the link for
   * analytics (data attribute only; nothing is sent anywhere here). */
  placement: string;
  className?: string;
}

// The primary conversion action everywhere on the public landing page: a
// plain <a> to the App Store listing (crawlable, works with JS off, opens
// the native listing on iOS). Styled after Apple's black badge — no Apple
// artwork is embedded, only text — so it can later be swapped for the
// official badge asset from developer.apple.com without touching callers.
export function AppStoreButton({ size = "lg", placement, className = "" }: AppStoreButtonProps) {
  const { t } = useLocale();
  const large = size === "lg";
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener"
      data-placement={placement}
      aria-label={t("landing.cta.appStoreAria")}
      className={`group inline-flex items-center justify-center gap-2.5 rounded-full bg-slate-950 text-white shadow-lg shadow-slate-950/25 ring-1 ring-white/10 transition hover:-translate-y-px hover:bg-slate-900 active:translate-y-0 ${
        large ? "px-6 py-3" : "px-3.5 py-1.5"
      } ${className}`}
    >
      <svg
        width={large ? 22 : 16}
        height={large ? 22 : 16}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-sun-300 transition-transform group-hover:translate-y-px"
      >
        <path d="M12 3v11m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      {large ? (
        <span className="flex flex-col items-start leading-none">
          <span className="text-[11px] font-medium text-white/70">{t("landing.cta.appStoreTop")}</span>
          <span className="mt-0.5 text-lg font-bold tracking-tight">{t("landing.cta.appStoreMain")}</span>
        </span>
      ) : (
        <span className="text-xs font-bold sm:text-sm">{t("landing.cta.appStoreShort")}</span>
      )}
    </a>
  );
}
