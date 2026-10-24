import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, MapPin, MessageCircle, Sparkles, Target, Users } from "lucide-react";
import { LandingNav } from "../components/landing/LandingNav";
import { AppStoreButton } from "../components/landing/AppStoreButton";
import { FoundingCounter } from "../components/landing/FoundingCounter";
import { PhoneFrame, RoundsScreen, GolfersScreen, CaddieScreen, RoundCard, ChatVignette, ScoreRing } from "../components/landing/PhoneMock";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { HighlightGolfMe } from "../components/brand/HighlightGolfMe";
import { CaddieNavIcon } from "../components/icons/CaddieNavIcon";
import { Reveal } from "../components/ui/Reveal";
import { useLocale } from "../i18n/LocaleContext";
import { APP_STORE_URL } from "../lib/appStore";

// Public / logged-out landing experience at /welcome (and what logged-out
// visitors to / are sent to). The authenticated app (Home/Play/Caddie/Me,
// real Supabase auth) is completely untouched by this file — a visitor
// here has no session. The page is also rendered to static HTML at build
// time (scripts/prerender-landing.mjs) so crawlers and link previews see
// the real content, which drives a few constraints here:
//   - section anchors and the App Store CTA are plain <a> links;
//   - the FAQ is native <details>/<summary> (works with no JS, indexable);
//   - every section's text is in the DOM regardless of scroll position
//     (<Reveal> only animates; see its data-prerender note);
//   - nothing here reads auth or user data — FoundingCounter's live count
//     is the one network call, and it renders nothing until it answers.
// Rounds, golfers and scores inside the phone mockups are illustrative
// examples (see PhoneMock.tsx), never real users or claims.

type HeroTab = "rounds" | "golfers" | "caddie";

function Kicker({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  return (
    <p className={`text-xs font-bold uppercase tracking-[0.18em] ${tone === "dark" ? "text-sun-300" : "text-fairway-700"}`}>{children}</p>
  );
}

function Points({ items, tone = "light" }: { items: string[]; tone?: "light" | "dark" }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((item) => (
        <li key={item} className={`flex items-start gap-3 text-sm sm:text-base ${tone === "dark" ? "text-fairway-100" : "text-slate-700"}`}>
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              tone === "dark" ? "bg-sun-400 text-fairway-950" : "bg-fairway-100 text-fairway-800"
            }`}
          >
            <Check size={12} strokeWidth={3} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function StepCard({ n, title, body, delayMs }: { n: number; title: string; body: string; delayMs: number }) {
  return (
    <Reveal delayMs={delayMs} className="relative rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <span className="absolute -top-4 left-6 flex h-9 w-9 items-center justify-center rounded-full bg-fairway-800 text-sm font-extrabold text-white ring-4 ring-[#faf9f6]">
        {n}
      </span>
      <h3 className="mt-3 text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-500 sm:text-base">{body}</p>
    </Reveal>
  );
}

export function Welcome() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [tab, setTab] = useState<HeroTab>("rounds");

  // The build-time prerender ships a static copy of this page in
  // <div id="prerender"> ahead of #root (see index.html + scripts/
  // prerender-landing.mjs). The moment the real page is mounted, swap it
  // out: identical markup, so the hand-off is invisible. Idempotent for
  // StrictMode's double effect.
  useEffect(() => {
    document.getElementById("prerender")?.remove();
    document.documentElement.classList.remove("gm-static-landing");
  }, []);

  const heroTabs: { id: HeroTab; label: string; icon: ReactNode }[] = [
    { id: "rounds", label: t("landing.hero.tabRounds"), icon: <Target size={14} /> },
    { id: "golfers", label: t("landing.hero.tabGolfers"), icon: <Users size={14} /> },
    { id: "caddie", label: t("landing.hero.tabCaddie"), icon: <CaddieNavIcon size={15} /> },
  ];

  const faq: { q: string; a: string }[] = [
    { q: t("landing.faq.q1"), a: t("landing.faq.a1") },
    { q: t("landing.faq.q2"), a: t("landing.faq.a2") },
    { q: t("landing.faq.q3"), a: t("landing.faq.a3") },
    { q: t("landing.faq.q4"), a: t("landing.faq.a4") },
    { q: t("landing.faq.q5"), a: t("landing.faq.a5") },
    { q: t("landing.faq.q6"), a: t("landing.faq.a6") },
  ];

  const nycCourses = ["Van Cortlandt Park", "Dyker Beach", "Forest Park", "Pelham Bay", "Marine Park", "Clearview", "Douglaston", "La Tourette"];
  const campuses = ["NYU", "Columbia", "Fordham", "CUNY", "St. John's", "Pace"];

  return (
    <div className="min-h-screen bg-[#faf9f6] text-slate-900">
      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      {/* No overflow-hidden on this wrapper: it holds the sticky nav, and a
          clipping ancestor would stop the nav sticking past the hero. The
          drifting blobs are clipped by the <section> below instead. */}
      <div className="bg-gradient-to-br from-fairway-800 via-fairway-900 to-fairway-950 text-white">
        <LandingNav />
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-fairway-400/25 blur-3xl animate-drift" />
            <div className="absolute -right-16 top-64 h-80 w-80 rounded-full bg-sun-400/15 blur-3xl animate-drift" style={{ animationDelay: "-9s" }} />
          </div>
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:pb-24 lg:pt-20">
          <div className="text-center lg:text-left">
            <Reveal delayMs={0}>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-fairway-100 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-fairway-300" />
                {t("landing.hero.eyebrow")}
              </span>
            </Reveal>
            <Reveal delayMs={200}>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                {t("landing.hero.headline")}
                <br />
                <span className="text-sun-300">{t("landing.hero.headline2")}</span>
              </h1>
            </Reveal>
            <Reveal delayMs={400}>
              <p className="mx-auto mt-5 max-w-xl text-base text-fairway-100 sm:text-lg lg:mx-0">
                <HighlightGolfMe text={t("landing.hero.subhead")} golfClassName="text-white" meClassName="text-sun-300" />
              </p>
            </Reveal>
            <Reveal delayMs={600} className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <AppStoreButton placement="hero" />
              <button
                onClick={() => navigate("/signup")}
                className="inline-flex items-center gap-1 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t("landing.hero.webCta")} <ChevronRight size={16} />
              </button>
            </Reveal>
            <Reveal delayMs={800}>
              <button onClick={() => navigate("/login")} className="mt-4 text-sm font-medium text-fairway-200/90 underline-offset-4 hover:text-white hover:underline">
                {t("landing.hero.secondaryCta")}
              </button>
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-fairway-200 lg:justify-start">
                {[t("landing.hero.proof1"), t("landing.hero.proof2"), t("landing.hero.proof3")].map((p) => (
                  <li key={p} className="flex items-center gap-1.5">
                    <Check size={13} className="text-sun-300" /> {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delayMs={300} className="relative">
            <div className="mx-auto flex w-fit flex-col items-center">
              <div role="tablist" aria-label={t("landing.hero.mockLabel")} className="mb-5 flex rounded-full border border-white/15 bg-white/10 p-1 text-xs font-semibold backdrop-blur-sm">
                {heroTabs.map((h) => (
                  <button
                    key={h.id}
                    role="tab"
                    aria-selected={tab === h.id}
                    onClick={() => setTab(h.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition ${
                      tab === h.id ? "bg-white text-fairway-900 shadow-sm" : "text-fairway-100 hover:text-white"
                    }`}
                  >
                    {h.icon} {h.label}
                  </button>
                ))}
              </div>
              <div className="animate-float">
                <PhoneFrame>
                  {tab === "rounds" && <RoundsScreen />}
                  {tab === "golfers" && <GolfersScreen />}
                  {tab === "caddie" && <CaddieScreen />}
                </PhoneFrame>
              </div>
              <p className="mt-4 text-[11px] text-fairway-200/70">{t("landing.hero.mockLabel")}</p>
            </div>
          </Reveal>
          </div>
        </section>
      </div>

      {/* ─── Why ──────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
        <Reveal>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{t("landing.explain.title")}</h2>
          <p className="mt-4 text-base text-slate-500 sm:text-lg">
            {t("landing.explain.body1")} {t("landing.explain.body2")}
          </p>
          <p className="mt-1 text-base text-slate-500 sm:text-lg">
            <HighlightGolfMe text={t("landing.explain.body3")} />
          </p>
        </Reveal>
      </section>

      {/* ─── Find partners ────────────────────────────────────────────── */}
      <section id="find-partners" className="scroll-mt-20 bg-white py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <Reveal>
            <Kicker>{t("landing.find.kicker")}</Kicker>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("landing.find.title")}</h2>
            <p className="mt-4 text-base text-slate-600 sm:text-lg">
              <HighlightGolfMe text={t("landing.find.body")} />
            </p>
            <Points items={[t("landing.find.point1"), t("landing.find.point2"), t("landing.find.point3")]} />
          </Reveal>
          <Reveal delayMs={200} className="relative">
            <div aria-hidden="true" className="absolute inset-x-8 bottom-4 top-12 rounded-[3rem] bg-gradient-to-br from-fairway-100 to-sun-100" />
            <PhoneFrame className="relative">
              <GolfersScreen />
            </PhoneFrame>
          </Reveal>
        </div>
      </section>

      {/* ─── Rounds ───────────────────────────────────────────────────── */}
      <section id="rounds" className="scroll-mt-20 py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <Reveal delayMs={200} className="order-2 lg:order-1">
            <div className="relative mx-auto max-w-sm space-y-3">
              <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-fairway-50 to-fairway-100" />
              <RoundCard
                course="Forest Park Golf Course"
                when="SAT · 8:20 AM"
                distance="4 mi away"
                spots="2 spots remaining"
                joined="2 of 4 joined"
                host="hosted by you"
                tags={["Casual & Social", "Walking"]}
                hosting
              />
              <RoundCard
                course="Pelham Bay Golf Course"
                when="SUN · 10:00 AM"
                distance="11 mi away"
                spots="1 spot remaining"
                joined="3 of 4 joined"
                host="hosted by Alexis"
                tags={["Beginner-Friendly"]}
                highlight
              />
              <RoundCard
                course="Marine Park Golf Course"
                when="WED · 5:30 PM"
                distance="8 mi away"
                spots="3 spots remaining"
                joined="1 of 4 joined"
                host="hosted by Theo"
                tags={["Twilight 9"]}
              />
            </div>
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <Kicker>{t("landing.rounds.kicker")}</Kicker>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("landing.rounds.title")}</h2>
            <p className="mt-4 text-base text-slate-600 sm:text-lg">{t("landing.rounds.body")}</p>
            <Points items={[t("landing.rounds.point1"), t("landing.rounds.point2"), t("landing.rounds.point3")]} />
          </Reveal>
        </div>
      </section>

      {/* ─── Community ────────────────────────────────────────────────── */}
      <section id="community" className="scroll-mt-20 bg-white py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <Reveal>
            <Kicker>{t("landing.community.kicker")}</Kicker>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("landing.community.title")}</h2>
            <p className="mt-4 text-base text-slate-600 sm:text-lg">
              <HighlightGolfMe text={t("landing.community.body")} />
            </p>
            <Points items={[t("landing.community.point1"), t("landing.community.point2"), t("landing.community.point3")]} />
          </Reveal>
          <Reveal delayMs={200}>
            <div className="relative mx-auto max-w-sm">
              <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-sun-50 to-fairway-50" />
              <ChatVignette />
              <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden="true">
                {[
                  { icon: <MessageCircle size={14} />, label: "Chat" },
                  { icon: <Users size={14} />, label: "Golf Circle" },
                  { icon: <Sparkles size={14} />, label: "Swing Posts" },
                ].map((c) => (
                  <div key={c.label} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 shadow-sm">
                    <span className="text-fairway-700">{c.icon}</span> {c.label}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Caddie ───────────────────────────────────────────────────── */}
      <section id="caddie" className="relative scroll-mt-20 overflow-hidden bg-fairway-950 py-16 text-white sm:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-fairway-500/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <Reveal delayMs={200} className="order-2 lg:order-1">
            <div className="mx-auto flex w-fit flex-col items-center gap-5 sm:flex-row sm:items-end">
              <PhoneFrame>
                <CaddieScreen />
              </PhoneFrame>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-center backdrop-blur-sm sm:mb-10">
                <ScoreRing score={81} size={120} />
                <p className="mt-2 text-xs font-semibold text-fairway-100">{t("landing.caddie.ringCaption")}</p>
              </div>
            </div>
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <Kicker tone="dark">{t("landing.caddie.kicker")}</Kicker>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("landing.caddie.title")}</h2>
            <p className="mt-4 text-base text-fairway-100 sm:text-lg">{t("landing.caddie.body")}</p>
            <Points tone="dark" items={[t("landing.caddie.point1"), t("landing.caddie.point2"), t("landing.caddie.point3")]} />
            <div className="mt-8">
              <AppStoreButton placement="caddie" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── NYC / college / Founding ─────────────────────────────────── */}
      <section id="nyc" className="scroll-mt-20 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <Reveal>
              <Kicker>{t("landing.nyc.kicker")}</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                <HighlightGolfMe text={t("landing.nyc.title")} />
              </h2>
              <p className="mt-4 text-base text-slate-600 sm:text-lg">
                <HighlightGolfMe text={t("landing.nyc.body")} />
              </p>
              <p className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-400">{t("landing.nyc.campusesLabel")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {campuses.map((c) => (
                  <span key={c} className="rounded-full border border-fairway-200 bg-fairway-50 px-3 py-1 text-sm font-semibold text-fairway-800">
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">{t("landing.nyc.coursesLabel")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {nycCourses.map((c) => (
                  <span key={c} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700">
                    <MapPin size={12} className="text-fairway-600" /> {c}
                  </span>
                ))}
              </div>
            </Reveal>
            <Reveal delayMs={200}>
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-fairway-800 to-fairway-950 p-6 text-white shadow-xl shadow-fairway-950/20 sm:p-8">
                <div aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sun-400/20 blur-2xl" />
                <Kicker tone="dark">{t("landing.founding.kicker")}</Kicker>
                <h3 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{t("landing.founding.title")}</h3>
                <p className="mt-3 text-sm text-fairway-100 sm:text-base">{t("landing.founding.body")}</p>
                <FoundingCounter className="mt-6" />
                <div className="mt-6">
                  <AppStoreButton placement="founding" />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ─── How it works ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal className="text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              <HighlightGolfMe text={t("landing.how.title")} />
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
            <StepCard n={1} title={t("landing.how.step1Title")} body={t("landing.how.step1Body")} delayMs={0} />
            <StepCard n={2} title={t("landing.how.step2Title")} body={t("landing.how.step2Body")} delayMs={200} />
            <StepCard n={3} title={t("landing.how.step3Title")} body={t("landing.how.step3Body")} delayMs={400} />
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <Reveal className="text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("landing.faq.title")}</h2>
          </Reveal>
          <Reveal delayMs={150} className="mt-10 divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-white px-6 shadow-sm">
            {faq.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold text-slate-900 sm:text-lg [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-800 transition-transform group-open:rotate-90">
                    <ChevronRight size={16} />
                  </span>
                </summary>
                <p className="mt-3 pr-10 text-sm text-slate-600 sm:text-base">
                  <HighlightGolfMe text={item.a} />
                </p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ─── Bottom CTA ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-fairway-800 via-fairway-900 to-fairway-950 px-6 py-20 text-center text-white sm:py-28">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun-400/10 blur-3xl" />
        <Reveal className="relative">
          <GolfMeIcon size={44} className="mx-auto mb-5" dotColor="#f8faf8" flagColor="#86efac" holeColor="#052e16" />
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{t("landing.bottom.headline")}</h2>
          <p className="mx-auto mt-4 max-w-md text-base text-fairway-100 sm:text-lg">
            <HighlightGolfMe text={t("landing.bottom.body")} golfClassName="text-white" meClassName="text-sun-300" />
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <AppStoreButton placement="bottom" />
            <button
              onClick={() => navigate("/signup")}
              className="inline-flex items-center gap-1 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {t("landing.hero.webCta")} <ChevronRight size={16} />
            </button>
          </div>
        </Reveal>
      </section>

      {/* ─── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
          <div className="text-center sm:text-left">
            <span className="flex items-center justify-center gap-1.5 text-base font-extrabold tracking-tight text-slate-900 sm:justify-start">
              <GolfMeIcon size={18} /> <HighlightGolfMe text="GolfMe" />
            </span>
            <p className="mt-1 text-xs text-slate-400">{t("landing.footer.tagline")}</p>
            <p className="mt-3 text-xs text-slate-400">© {new Date().getFullYear()} GolfMe · New York, NY</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-medium">
            <a href={APP_STORE_URL} target="_blank" rel="noopener" className="hover:text-fairway-800">
              {t("landing.footer.appStore")}
            </a>
            <a href="#caddie" className="hover:text-fairway-800">
              {t("landing.nav.caddie")}
            </a>
            <a href="#faq" className="hover:text-fairway-800">
              FAQ
            </a>
            <a href="/privacy" className="hover:text-fairway-800">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-fairway-800">
              Terms of Service
            </a>
            <a href="/support" className="hover:text-fairway-800">
              Support
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
