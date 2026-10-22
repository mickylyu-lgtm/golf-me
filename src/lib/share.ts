import type { SharePayload } from "./shareLinks";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

// Native share sheet when the browser has one (iOS Safari, the installed
// PWA, Android Chrome, and the iOS app's WKWebView on recent iOS), else the
// link is copied to the clipboard. @capacitor/share is deliberately not used:
// adding a native plugin needs a new App Store build, and navigator.share
// with this fallback works on the build that's live today. Never throws.
export async function shareOrCopy(payload: SharePayload): Promise<ShareOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && typeof nav.share === "function") {
    const data: ShareData = { title: payload.title, text: payload.text, url: payload.url };
    let canShare = true;
    try {
      if (typeof nav.canShare === "function") canShare = nav.canShare(data);
    } catch {
      canShare = true;
    }
    if (canShare) {
      try {
        await nav.share(data);
        return "shared";
      } catch (err) {
        // The person closed the sheet: not an error, and no copy fallback
        // (that would surprise them with a toast after they cancelled).
        if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
        // NotAllowedError (no user gesture) etc.: fall through to copying.
      }
    }
  }
  return (await copyText(`${payload.text} ${payload.url}`.trim())) ? "copied" : "failed";
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
