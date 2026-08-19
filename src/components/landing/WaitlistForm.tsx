import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { useWaitlistSignup } from "../../lib/useWaitlistSignup";
import { HighlightGolfMe } from "../brand/HighlightGolfMe";
import { Button } from "../ui/Button";
import { inputClass, labelClass } from "../ui/FormControls";

// Founder-curated launch-decision regions (section 12 of the brief: home
// region needs to stay clean/groupable so waitlist concentration can guide
// where GolfMe launches next) — deliberately NOT src/data/regions.ts, which
// is a different, generic city list for the authenticated app's course
// search and doesn't even contain most of these areas (Long Island, New
// Jersey as distinct from NYC proper, etc).
const WAITLIST_REGIONS = ["New York / Long Island", "Boston", "New Jersey", "Los Angeles", "Miami"];
const OTHER = "__other__";

export function WaitlistForm() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const { submit, submitting } = useWaitlistSignup();
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState("");
  const [otherRegion, setOtherRegion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ region: string } | null>(null);

  // Lightweight ?ref=nyu / ?ref=friend / ?ref=instagram tracking only —
  // never surfaced as a form field, never a full referral/rewards system.
  const referralSource = searchParams.get("ref");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const effectiveRegion = region === OTHER ? otherRegion : region;
    const outcome = await submit(email, effectiveRegion, referralSource);
    switch (outcome) {
      case "success":
        setSuccess({ region: effectiveRegion.trim() });
        break;
      case "duplicate":
        setError(t("landing.waitlist.errorDuplicate"));
        break;
      case "invalid-email":
        setError(t("landing.waitlist.errorInvalidEmail"));
        break;
      case "missing-region":
        setError(t("landing.waitlist.errorMissingRegion"));
        break;
      case "error":
        setError(t("landing.waitlist.errorGeneric"));
        break;
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-white p-8 text-center shadow-xl shadow-fairway-950/10">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fairway-50 text-fairway-600">
          <CheckCircle2 size={26} />
        </span>
        <h3 className="text-xl font-extrabold text-slate-900">{t("landing.waitlist.successTitle")}</h3>
        <p className="max-w-xs text-sm text-slate-500">
          <HighlightGolfMe text={t("landing.waitlist.successBody")} />
        </p>
        {success.region && (
          <p className="text-xs text-slate-400">
            {t("landing.waitlist.successRegionLabel")} <span className="font-semibold text-slate-600">{success.region}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl shadow-fairway-950/10 sm:p-8">
      <div>
        <label className={labelClass} htmlFor="waitlist-email">
          {t("landing.waitlist.emailLabel")}
        </label>
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("landing.waitlist.emailPlaceholder")}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>{t("landing.waitlist.regionLabel")}</label>
        <div className="flex flex-wrap gap-2">
          {WAITLIST_REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                region === r ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRegion(OTHER)}
            className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
              region === OTHER ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
            }`}
          >
            {t("landing.waitlist.regionOther")}
          </button>
        </div>
        {region === OTHER && (
          <input
            autoFocus
            value={otherRegion}
            onChange={(e) => setOtherRegion(e.target.value)}
            placeholder={t("landing.waitlist.regionOtherPlaceholder")}
            className={`${inputClass} mt-2`}
          />
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-rose-600">
          <HighlightGolfMe text={error} />
        </p>
      )}

      <Button type="submit" size="lg" fullWidth disabled={submitting}>
        {submitting ? t("landing.waitlist.submitting") : t("landing.waitlist.submit")}
      </Button>
      <p className="text-center text-xs text-slate-400">
        <HighlightGolfMe text={t("landing.waitlist.disclaimer")} />
      </p>
    </form>
  );
}
