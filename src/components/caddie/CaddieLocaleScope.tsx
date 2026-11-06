import type { ReactNode } from "react";
import { LOCALES, LocaleScope, useLocale } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/LocaleContext";
import { useCaddieFeedbackLanguage } from "../../lib/useCaddieFeedbackLanguage";

// Every Caddie screen (the Caddie tab, Analyze/upload/trim, an analysis with
// Coach Replay, Swing Check, cue cards and loading scenes) renders in the
// Caddie feedback language (lib/caddieFeedbackLanguage), not just the AI
// text: Micky, 2026-11-05, "the language switcher should switch all
// languages within Caddie". Mounted around the Caddie routes in App.tsx and
// the Caddie panel of RootTabCarousel, so the top bar, bottom nav and every
// other screen keep the app language. Inside, useLocale() returns the Caddie
// language (dates included) and toasts raised there use it too; setLocale
// still changes the app language.
export function CaddieLocaleScope({ children }: { children: ReactNode }) {
  const { locale: appLocale } = useLocale();
  const language = useCaddieFeedbackLanguage();
  const known = LOCALES.find((l) => l.value === language)?.value;
  const locale: Locale = known ?? appLocale;
  return <LocaleScope locale={locale}>{children}</LocaleScope>;
}
