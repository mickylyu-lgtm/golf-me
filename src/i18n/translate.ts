// The translator and locale-scope rules behind LocaleContext.tsx, kept free
// of React and of the dictionaries themselves so tests/localeScope.test.ts
// runs under plain node --test.

export type TranslationVars = Record<string, string | number>;

// `dict` may be missing keys (or be absent while it loads); English is
// every key's fallback.
export function makeTranslator<K extends string>(dict: Partial<Record<K, string>> | undefined, fallback: Record<K, string>) {
  return (key: K, vars?: TranslationVars): string => {
    let str = dict?.[key] ?? fallback[key];
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        // replaceAll: a placeholder can appear more than once (review.intro uses {name} twice).
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

// A nested scope (LocaleScope) changes only what its subtree reads: `locale`
// and `t`. Everything else, setLocale included, is the parent's, so a
// language switcher inside a scope still changes the app's language, and
// the scope itself never writes the app's locale or its storage.
export function scopeLocaleValue<V extends { locale: string; t: unknown }>(parent: V, locale: V["locale"], t: V["t"]): V {
  return { ...parent, locale, t };
}
