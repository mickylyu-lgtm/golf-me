import { useNavigate } from "react-router-dom";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { Button } from "../components/ui/Button";
import { useLocale } from "../i18n/LocaleContext";

// Catch-all for unknown paths (a mistyped URL, a stale link). Standalone,
// outside GuestOnly and AuthedLayout (see App.tsx), so it renders with or
// without a session. The button goes to "/", and the existing guards take it
// from there: Welcome or Splash when signed out, profile setup mid-signup,
// Home when onboarded.
export function NotFound() {
  const navigate = useNavigate();
  const { t } = useLocale();

  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-5 px-6 pb-8 text-center"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-fairway-50">
        <GolfMeIcon size={34} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t("notFound.title")}</h1>
        <p className="text-sm text-slate-500">{t("notFound.body")}</p>
      </div>
      <Button size="lg" fullWidth onClick={() => navigate("/", { replace: true })}>
        {t("notFound.cta")}
      </Button>
    </div>
  );
}
