// Appearance (Settings -> Appearance): Light, Dark, or Match iPhone (follow
// the system). Stored per device in localStorage; nothing goes to the
// database. index.html runs the same rules in a tiny inline script before
// first paint (keep the two in step: storage key, values, default, colours),
// so a dark launch never flashes cream. Pure helpers here, no DOM, so they
// run under node --test; useAppearance.ts wires them to the page.

export type AppearanceSetting = "light" | "dark" | "system";
export type ColorScheme = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "golfme:appearance";
export const APPEARANCE_SETTINGS: readonly AppearanceSetting[] = ["light", "dark", "system"];
// What a device that never chose gets: Light (Micky, 2026-11-08). Dark and
// Match iPhone are a choice in Settings -> Appearance. Only an explicit
// choice is ever stored, so devices that never picked switch to Light, and
// anyone who picked Match iPhone or Dark keeps it.
export const DEFAULT_APPEARANCE: AppearanceSetting = "light";

// <meta name="theme-color">: light keeps the colour it always had; dark is
// the dark page colour so browser chrome blends with the app.
export const THEME_COLOR: Record<ColorScheme, string> = { light: "#166534", dark: "#0d1210" };

export function parseAppearance(value: unknown): AppearanceSetting {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_APPEARANCE;
}

export function resolveScheme(setting: AppearanceSetting, systemDark: boolean): ColorScheme {
  if (setting === "system") return systemDark ? "dark" : "light";
  return setting;
}

// A screen that always stays light (the public landing page) wins over the
// setting while it is showing.
export function effectiveScheme(setting: AppearanceSetting, systemDark: boolean, forcedLight: boolean): ColorScheme {
  return forcedLight ? "light" : resolveScheme(setting, systemDark);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// Private mode, blocked storage, or no window at all: fall back to the
// default rather than throw.
export function readAppearance(storage: StorageLike | null | undefined): AppearanceSetting {
  try {
    return parseAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(storage: StorageLike | null | undefined, setting: AppearanceSetting): boolean {
  try {
    if (!storage) return false;
    storage.setItem(APPEARANCE_STORAGE_KEY, setting);
    return true;
  } catch {
    return false;
  }
}
