import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { generateId } from "../lib/id";

export type ToastVariant = "success" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
};

// success previously used Tailwind's stock emerald scale, the one toast
// variant not drawn from the brand palette — now uses the new bright
// fairway-500 accent (#22c55e) for its border so a genuine success reads as
// a touch more vivid than a plain info toast, without introducing a second
// unrelated green into the app.
const STYLES: Record<ToastVariant, string> = {
  success: "border-fairway-500/50 bg-fairway-50 text-fairway-900",
  info: "border-fairway-500/30 bg-fairway-50 text-fairway-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = generateId("toast");
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-4 sm:items-end sm:right-4 sm:left-auto">
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto animate-slide-up flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${STYLES[t.variant]}`}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm font-medium">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-md p-0.5 opacity-60 transition hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
