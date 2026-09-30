import { Component, type ErrorInfo, type ReactNode } from "react";
import { GolfMeIcon } from "./brand/GolfMeIcon";

// Top-level safety net (wraps <App /> in main.tsx): a render crash anywhere
// shows this screen instead of a blank white page. It sits OUTSIDE every app
// provider on purpose -- if LocaleContext or DataContext is what crashed, the
// fallback still has to render -- so it carries its own tiny dictionary and
// reads the saved language straight from localStorage. Unlike the rest of the
// (light-only) app it also follows the OS dark setting, since it can appear
// before any app styling state exists.

type Copy = { title: string; body: string; reload: string; home: string };

const COPY: Record<string, Copy> = {
  en: { title: "Something went wrong", body: "GolfMe hit an unexpected problem. Reloading usually fixes it.", reload: "Reload", home: "Go to Home" },
  es: { title: "Algo salió mal", body: "GolfMe tuvo un problema inesperado. Recargar suele solucionarlo.", reload: "Recargar", home: "Ir al inicio" },
  ja: { title: "問題が発生しました", body: "GolfMeで予期しない問題が発生しました。再読み込みで解決することがほとんどです。", reload: "再読み込み", home: "ホームへ" },
  ko: { title: "문제가 발생했습니다", body: "GolfMe에 예기치 않은 문제가 발생했습니다. 새로고침하면 대부분 해결됩니다.", reload: "새로고침", home: "홈으로" },
  "zh-CN": { title: "出了点问题", body: "GolfMe 遇到了意外问题。重新加载通常可以解决。", reload: "重新加载", home: "返回首页" },
  "zh-TW": { title: "出了點問題", body: "GolfMe 遇到了意外問題。重新載入通常可以解決。", reload: "重新載入", home: "返回首頁" },
};

// Same key and fallback order as LocaleContext (saved choice, then the
// device language), duplicated here because the context may be what failed.
function pickCopy(): Copy {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem("golfme:locale");
  } catch {
    // Storage blocked: fall through to the device language.
  }
  if (saved && COPY[saved]) return COPY[saved];
  const lang = (navigator.language || "en").toLowerCase();
  if (lang.startsWith("zh")) return lang.includes("tw") || lang.includes("hk") || lang.includes("hant") ? COPY["zh-TW"] : COPY["zh-CN"];
  if (lang.startsWith("es")) return COPY.es;
  if (lang.startsWith("ko")) return COPY.ko;
  if (lang.startsWith("ja")) return COPY.ja;
  return COPY.en;
}

// Stale lazy page chunks after a deploy are already handled upstream:
// lazyPage (src/lib/lazyPage.ts) reloads once on a failed chunk load. If
// that reload doesn't help, the error lands here and shows this screen.

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("GolfMe: unexpected render error.", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const copy = pickCopy();
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center bg-[#faf9f6] px-6 text-center dark:bg-[#0f1612]"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <GolfMeIcon size={48} variant="gradient" className="mb-5 rounded-2xl" />
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{copy.title}</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-300">{copy.body}</p>
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-full bg-[#1b4a2d] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:border dark:border-[#3f7d55]"
          >
            {copy.reload}
          </button>
          <button
            type="button"
            onClick={() => window.location.assign("/")}
            className="min-h-11 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {copy.home}
          </button>
        </div>
      </div>
    );
  }
}
