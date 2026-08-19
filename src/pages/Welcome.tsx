import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, Users } from "lucide-react";
import { LandingNav } from "../components/landing/LandingNav";
import { WaitlistForm } from "../components/landing/WaitlistForm";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { CaddieNavIcon } from "../components/icons/CaddieNavIcon";
import { useLocale } from "../i18n/LocaleContext";

function PillarCard({
  id,
  icon,
  title,
  body,
  delayMs,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  body: string;
  delayMs: number;
}) {
  return (
    <div
      id={id}
      className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-sm animate-slide-up motion-reduce:animate-none"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: "backwards" }}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">{icon}</span>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500">{body}</p>
    </div>
  );
}

function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-fairway-600 text-base font-extrabold text-white">{n}</span>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="max-w-[16rem] text-sm text-slate-500">{body}</p>
    </div>
  );
}

// Public / logged-out landing experience — pre-TestFlight waitlist capture.
// The authenticated app (Home/Play/Caddie/Me, real Supabase auth, the whole
// existing product) is completely untouched by this file; a visitor here
// has no session at all. "Get Started" self-serve signup is deliberately
// no longer the page's primary action (Join Waitlist is) but /onboarding,
// /signup, /login all still work unchanged for anyone who reaches them
// directly — this page just stops advertising self-serve signup as the
// front door.
export function Welcome() {
  const navigate = useNavigate();
  const { t } = useLocale();

  return (
    <div className="min-h-screen bg-[#faf8f2] text-slate-900">
      <div className="bg-gradient-to-br from-fairway-700 via-fairway-800 to-fairway-950 text-white">
        <LandingNav />
        <section className="mx-auto flex max-w-2xl flex-col items-center gap-5 px-6 py-14 text-center sm:py-20">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: "0ms", animationFillMode: "backwards" }}
          >
            <GolfMeIcon size={34} dotColor="#f8faf8" targetColor="#8bc09a" holeColor="#19422a" />
          </span>
          <h1
            className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: "90ms", animationFillMode: "backwards" }}
          >
            {t("landing.hero.headline")}
          </h1>
          <p
            className="max-w-lg text-base text-fairway-100 sm:text-lg animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: "180ms", animationFillMode: "backwards" }}
          >
            {t("landing.hero.subhead")}
          </p>
          <p
            className="max-w-md text-sm text-fairway-200/80 animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: "260ms", animationFillMode: "backwards" }}
          >
            {t("landing.hero.explainer")}
          </p>
          <div
            className="mt-2 flex w-full max-w-xs flex-col items-center gap-3 animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: "330ms", animationFillMode: "backwards" }}
          >
            <a
              href="#waitlist"
              className="flex w-full items-center justify-center rounded-full bg-sun-400 px-6 py-3.5 text-base font-bold text-fairway-950 shadow-md shadow-fairway-950/20 transition hover:-translate-y-px hover:bg-sun-300"
            >
              {t("landing.hero.primaryCta")}
            </a>
            <button
              onClick={() => navigate("/login")}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:text-white"
            >
              {t("landing.hero.secondaryCta")}
            </button>
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{t("landing.explain.title")}</h2>
          <p className="mt-3 text-sm text-slate-500 sm:text-base">
            {t("landing.explain.body1")} {t("landing.explain.body2")}
          </p>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">{t("landing.explain.body3")}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <PillarCard icon={<Flag size={18} />} title={t("landing.pillar.playTitle")} body={t("landing.pillar.playBody")} delayMs={0} />
          <PillarCard icon={<Users size={18} />} title={t("landing.pillar.communityTitle")} body={t("landing.pillar.communityBody")} delayMs={100} />
          <PillarCard id="caddie" icon={<CaddieNavIcon size={20} />} title={t("landing.pillar.caddieTitle")} body={t("landing.pillar.caddieBody")} delayMs={200} />
        </div>
      </section>

      <section id="how-it-works" className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{t("landing.how.title")}</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            <StepCard n={1} title={t("landing.how.step1Title")} body={t("landing.how.step1Body")} />
            <StepCard n={2} title={t("landing.how.step2Title")} body={t("landing.how.step2Body")} />
            <StepCard n={3} title={t("landing.how.step3Title")} body={t("landing.how.step3Body")} />
          </div>
        </div>
      </section>

      <section id="waitlist" className="mx-auto max-w-lg px-6 py-16">
        <div className="mb-7 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{t("landing.waitlist.title")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("landing.waitlist.subtitle")}</p>
        </div>
        <WaitlistForm />
      </section>

      <section className="bg-fairway-950 px-6 py-16 text-center text-white">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("landing.bottom.headline")}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-fairway-100">{t("landing.bottom.body")}</p>
        <a
          href="#waitlist"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-sun-400 px-6 py-3.5 text-base font-bold text-fairway-950 shadow-md shadow-fairway-950/20 transition hover:-translate-y-px hover:bg-sun-300"
        >
          {t("landing.hero.primaryCta")}
        </a>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-slate-400">
        <GolfMeIcon size={14} className="mx-auto mb-2 opacity-60" />
        {new Date().getFullYear()} GolfMe
      </footer>
    </div>
  );
}
