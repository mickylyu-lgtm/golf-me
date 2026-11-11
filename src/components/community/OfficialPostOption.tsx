import { ShieldCheck } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";

interface OfficialPostOptionProps {
  allowed: boolean;
  selected: boolean;
  loading: boolean;
  disabled?: boolean;
  onChange: (selected: boolean) => void;
  onRetry: () => void;
}

export function OfficialPostOption({ allowed, selected, loading, disabled, onChange, onRetry }: OfficialPostOptionProps) {
  const { t } = useLocale();
  // A failed/revoked capability must never silently change an intended
  // announcement into a personal post. Keep the choice visible to turn off.
  if (!allowed && !selected) return null;
  return (
    <div className="rounded-2xl border border-fairway-200 bg-fairway-50 p-3" data-testid="official-post-option">
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={selected} disabled={disabled || (!allowed && !selected)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-fairway-700" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fairway-800">
            <ShieldCheck size={15} aria-hidden />{t("composer.postAsGolfMe")}
          </span>
          <span className="mt-0.5 block text-xs text-fairway-700">{t("composer.officialPostHint")}</span>
        </span>
      </label>
      {selected && !allowed && (
        <div className="mt-2 text-sm text-slate-700" role="status">
          <p>{t(loading ? "composer.checkingOfficialAccess" : "composer.officialPostUnavailable")}</p>
          {!loading && <button type="button" onClick={onRetry} disabled={disabled}
            className="mt-1 min-h-11 font-semibold text-fairway-800 underline">{t("loading.retry")}</button>}
        </div>
      )}
    </div>
  );
}
