import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import { zhTW } from "./locales/zh-TW";
import { es } from "./locales/es";
import { ko } from "./locales/ko";
import { ja } from "./locales/ja";
import type { TranslationKey } from "./locales/en";

export type Locale = "en" | "zh-CN" | "zh-TW" | "es" | "ko" | "ja";

export const LOCALES: { value: Locale; nativeName: string }[] = [
  { value: "en", nativeName: "English" },
  { value: "zh-CN", nativeName: "简体中文" },
  { value: "zh-TW", nativeName: "繁體中文" },
  { value: "es", nativeName: "Español" },
  { value: "ko", nativeName: "한국어" },
  { value: "ja", nativeName: "日本語" },
];

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  es,
  ko,
  ja,
};

// Separate from AppData's own localStorage key (golfme:data:v8) so
// switching or resetting demo data never touches the language choice, and
// vice versa — language is a device/UI preference, not app state.
const LOCALE_STORAGE_KEY = "golfme:locale";

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language ?? "en";
  if (lang.startsWith("zh")) {
    // zh-Hant / zh-TW / zh-HK read as Traditional; everything else zh-* (incl. bare "zh") as Simplified.
    return /^zh-(TW|HK|Hant)/i.test(lang) ? "zh-TW" : "zh-CN";
  }
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("ja")) return "ja";
  return "en";
}

function loadStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return raw && raw in DICTIONARIES ? (raw as Locale) : null;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // A stored explicit choice always wins; only a first-ever visit falls
  // back to browser-language detection — once picked, language never
  // silently changes again (per spec: explicit choice always overrides
  // browser settings after that point).
  const [locale, setLocaleState] = useState<Locale>(() => loadStoredLocale() ?? detectBrowserLocale());

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const t = useMemo(() => {
    const dict = DICTIONARIES[locale];
    return (key: TranslationKey, vars?: Record<string, string | number>) => {
      let str = dict[key] ?? en[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    };
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale: setLocaleState, t }), [locale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
