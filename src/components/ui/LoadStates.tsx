import { useState } from "react";
import { RotateCcw, WifiOff } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

// The error halves of lib/loadStatus.ts's list states. Same copy and retry
// label as AppGate's profile-load retry (App.tsx): loading.unreachable /
// loading.retry.

/** A first load failed and nothing is on screen: say so, with a retry. Never shown in demo. */
export function LoadErrorState({ onRetry }: { onRetry: () => Promise<void> | void }) {
  const { t } = useLocale();
  const [retrying, setRetrying] = useState(false);
  return (
    <EmptyState
      tone="error"
      icon={<WifiOff size={20} />}
      title={t("loading.unreachable")}
      action={
        <Button
          size="sm"
          variant="outline"
          icon={<RotateCcw size={14} />}
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
        >
          {t("loading.retry")}
        </Button>
      }
    />
  );
}

/** A background refresh failed while older data is shown: keep the data, show this small notice above it. */
export function StaleDataNotice({ onRetry }: { onRetry: () => Promise<void> | void }) {
  const { t } = useLocale();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
      <WifiOff size={13} className="shrink-0" />
      <p className="flex-1">{t("loading.refreshFailed")}</p>
      <button
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await onRetry();
          } finally {
            setRetrying(false);
          }
        }}
        className="shrink-0 font-semibold text-amber-900 hover:underline disabled:opacity-50"
      >
        {t("loading.retry")}
      </button>
    </div>
  );
}
