import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./locales/en";
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

type Dictionary = Record<TranslationKey, string>;

// English ships in the main bundle (it's also every key's fallback); the
// other five (~50-65 KB each) load on demand so a golfer only downloads the
// language they use (Health Audit P3-4).
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  "zh-CN": () => import("./locales/zh-CN").then((m) => m.zhCN),
  "zh-TW": () => import("./locales/zh-TW").then((m) => m.zhTW),
  es: () => import("./locales/es").then((m) => m.es),
  ko: () => import("./locales/ko").then((m) => m.ko),
  ja: () => import("./locales/ja").then((m) => m.ja),
};

const loadedDictionaries: Partial<Record<Locale, Dictionary>> = { en };
const KNOWN_LOCALE_VALUES = new Set<string>(LOCALES.map((l) => l.value));

function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = loadedDictionaries[locale];
  if (cached) return Promise.resolve(cached);
  return LOADERS[locale as Exclude<Locale, "en">]().then((dict) => {
    loadedDictionaries[locale] = dict;
    return dict;
  });
}

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
  return raw && KNOWN_LOCALE_VALUES.has(raw) ? (raw as Locale) : null;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function buildT(locale: Locale) {
  const dict = loadedDictionaries[locale] ?? en;
  return (key: TranslationKey, vars?: Record<string, string | number>) => {
    let str = dict[key] ?? en[key];
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // A stored explicit choice always wins; only a first-ever visit falls
  // back to browser-language detection — once picked, language never
  // silently changes again (per spec: explicit choice always overrides
  // browser settings after that point).
  const [locale, setLocaleState] = useState<Locale>(() => loadStoredLocale() ?? detectBrowserLocale());
  // Bumped when a dictionary finishes loading so t is rebuilt with it.
  const [dictVersion, setDictVersion] = useState(0);
  // First paint waits (briefly) for a non-English golfer's dictionary so
  // the UI doesn't flash English first. A failed load falls back to
  // English rather than blocking forever.
  const [ready, setReady] = useState(() => Boolean(loadedDictionaries[locale]));

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (loadedDictionaries[locale]) {
      setReady(true);
      return;
    }
    let cancelled = false;
    loadDictionary(locale)
      .catch((err) => console.error(`GolfMe: failed to load ${locale} translations; using English.`, err))
      .finally(() => {
        if (cancelled) return;
        setDictVersion((v) => v + 1);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Switching language keeps the current one on screen until the new
  // dictionary has loaded, instead of dropping to English in between.
  const setLocale = useCallback((next: Locale) => {
    if (loadedDictionaries[next]) {
      setLocaleState(next);
      return;
    }
    loadDictionary(next)
      .catch((err) => console.error(`GolfMe: failed to load ${next} translations; using English.`, err))
      .finally(() => setLocaleState(next));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => buildT(locale), [locale, dictVersion]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  if (!ready) return null;
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// Pins a subtree to a fixed locale regardless of the device/account-wide
// choice in LocaleProvider above — e.g. the admin dashboard, which is an
// internal tool for the (English-speaking) GolfMe team and shouldn't
// re-render in whatever language the logged-in admin's own account happens
// to be set to. setLocale is a no-op since these subtrees never expose a
// language switcher.
export function ForceLocale({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useMemo(() => buildT(locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale: () => {}, t }), [locale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
