import { lazy } from "react";
import type { ComponentType } from "react";

const RELOAD_FLAG = "golfme:chunkReloadAt";
const RELOAD_COOLDOWN_MS = 30_000;

// React.lazy for this codebase's named page exports. If the chunk fails to
// load — typically because a new deploy replaced the hashed file while this
// tab (or the long-lived Capacitor webview) was still on the old build — do
// one full reload to pick up the new index.html. The cooldown stops a
// genuinely offline device from reload-looping; after that the error
// surfaces normally.
export function lazyPage<T extends Record<string, unknown>, K extends keyof T & string>(
  load: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => {
    try {
      const mod = await load();
      return { default: mod[exportName] as ComponentType };
    } catch (err) {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      } catch {
        // Storage unavailable — fall through and reload once.
      }
      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        try {
          sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        } catch {
          // Ignore.
        }
        window.location.reload();
        // Keep Suspense showing its fallback while the page reloads.
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
