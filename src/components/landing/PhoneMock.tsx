import type { CSSProperties, ReactNode } from "react";
import { Bell, ChevronRight, Flag, MapPin, Search, Sparkles, Users } from "lucide-react";
import { GolfMeIcon } from "../brand/GolfMeIcon";
import { GolfMeWordmark } from "../brand/GolfMeWordmark";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";

// Illustrative phone screens for the public landing page, drawn in the
// authenticated app's own visual language (cream page, white cards, forest
// green actions, Inter) rather than embedded screenshots — crisp at every
// pixel density, ~0 KB of images, fully crawlable text, and no real
// user's name, avatar or messages ever ends up on the marketing page. The
// golfers, rounds and scores shown are examples, labelled as such where
// they appear (landing.hero.mockLabel). Courses are real NYC-area public
// courses; people are not real users.

export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative mx-auto w-[260px] rounded-[2.4rem] border-[6px] border-slate-900 bg-slate-900 shadow-2xl shadow-fairway-950/40 ${className}`}
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-900" />
      <div className="relative h-[520px] overflow-hidden rounded-[2rem] bg-[#faf9f6] text-slate-900">
        <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-semibold text-slate-900">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-900" />
            <span className="inline-block h-2.5 w-5 rounded-sm border border-slate-900" />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function MockTopBar() {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight">
        <GolfMeIcon size={18} />
        <GolfMeWordmark />
      </span>
      <span className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
          <Bell size={13} />
        </span>
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-fairway-300 to-fairway-600" />
      </span>
    </div>
  );
}

function MockTabBar({ active }: { active: "home" | "play" | "caddie" }) {
  const tab = (label: string, icon: ReactNode, on: boolean) => (
    <span className={`flex flex-col items-center gap-0.5 text-[9px] font-semibold ${on ? "text-fairway-800" : "text-slate-400"}`}>
      <span className={`flex h-7 w-7 items-center justify-center rounded-full ${on ? "bg-fairway-100" : ""}`}>{icon}</span>
      {label}
    </span>
  );
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-slate-200 bg-white px-2 pb-3 pt-2">
      {tab("Home", <span className="h-3.5 w-3.5 rounded-sm border-2 border-current" />, active === "home")}
      {tab("Chat", <span className="h-3.5 w-3.5 rounded-md border-2 border-current" />, false)}
      {tab("Play", <Flag size={14} />, active === "play")}
      {tab("Caddie", <CaddieNavIcon size={15} />, active === "caddie")}
      {tab("Me", <span className="h-3.5 w-3.5 rounded-full border-2 border-current" />, false)}
    </div>
  );
}

function Avatar({ initials, tone }: { initials: string; tone: string }) {
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${tone}`}>
      {initials}
    </span>
  );
}

export function RoundCard({
  course,
  when,
  distance,
  spots,
  joined,
  host,
  tags,
  cta,
  hosting = false,
  highlight = false,
}: {
  course: string;
  when: string;
  distance: string;
  spots: string;
  joined: string;
  host: string;
  tags: string[];
  cta?: string;
  hosting?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-3 shadow-sm ${highlight ? "border-fairway-300 ring-2 ring-fairway-200" : "border-slate-100"}`}>
      <p className="text-[12px] font-bold leading-tight text-slate-900">{course}</p>
      <p className="mt-0.5 text-[9.5px] text-slate-500">
        {when} · {distance}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded-full bg-fairway-100 px-2 py-0.5 text-[9px] font-semibold text-fairway-800">{spots}</span>
        {tags.map((tg) => (
          <span key={tg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-medium text-slate-600">
            {tg}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9px] text-slate-500">
          <span className="h-4 w-4 rounded-full bg-gradient-to-br from-sun-300 to-sun-500" />
          {joined} · {host}
        </span>
        {hosting ? (
          <span className="rounded-full bg-fairway-50 px-2 py-1 text-[9px] font-semibold text-fairway-700">You&apos;re hosting</span>
        ) : (
          <span className="flex items-center gap-0.5 rounded-full bg-fairway-900 px-2.5 py-1 text-[9.5px] font-bold text-white">
            {cta ?? "Join Round"} <ChevronRight size={10} />
          </span>
        )}
      </div>
    </div>
  );
}

export function RoundsScreen() {
  return (
    <>
      <MockTopBar />
      <div className="px-4">
        <p className="text-[15px] font-extrabold tracking-tight">Find golf near you</p>
        <p className="text-[9.5px] text-slate-500">Rounds looking for players, and the golfers behind them.</p>
        <div className="mt-2 flex rounded-full bg-slate-100 p-0.5 text-[10px] font-semibold">
          <span className="flex-1 rounded-full bg-fairway-900 py-1 text-center text-white">Rounds</span>
          <span className="flex-1 py-1 text-center text-slate-500">Golfers</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] text-slate-400">
          <Search size={11} /> Search rounds or courses
        </div>
        <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">Near you</p>
        <div className="mt-1.5 space-y-2">
          <RoundCard
            course="Van Cortlandt Park Golf Course"
            when="SAT · 7:40 AM"
            distance="6 mi away"
            spots="2 spots remaining"
            joined="2 of 4 joined"
            host="hosted by Priya"
            tags={["Casual & Social"]}
            highlight
          />
          <RoundCard
            course="Dyker Beach Golf Course"
            when="SUN · 1:10 PM"
            distance="9 mi away"
            spots="1 spot remaining"
            joined="3 of 4 joined"
            host="hosted by Marcus"
            tags={["Beginner-Friendly"]}
          />
        </div>
      </div>
      <MockTabBar active="play" />
    </>
  );
}

export function GolfersScreen() {
  const golfer = (initials: string, tone: string, name: string, meta: string, match: string) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
      <Avatar initials={initials} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-bold leading-tight">{name}</span>
        <span className="block truncate text-[9px] text-slate-500">{meta}</span>
      </span>
      <span className="rounded-full bg-sun-100 px-2 py-0.5 text-[9px] font-bold text-sun-700">{match}</span>
    </div>
  );
  return (
    <>
      <MockTopBar />
      <div className="px-4">
        <p className="text-[15px] font-extrabold tracking-tight">Golfers near you</p>
        <p className="text-[9.5px] text-slate-500">Matched on handicap, availability and how you like to play.</p>
        <div className="mt-2 flex rounded-full bg-slate-100 p-0.5 text-[10px] font-semibold">
          <span className="flex-1 py-1 text-center text-slate-500">Rounds</span>
          <span className="flex-1 rounded-full bg-fairway-900 py-1 text-center text-white">Golfers</span>
        </div>
        <div className="mt-3 space-y-2">
          {golfer("JL", "bg-fairway-700", "Jordan L.", "Handicap 14 · Weekends · Manhattan", "Great Match")}
          {golfer("SA", "bg-sky-600", "Sam A.", "Handicap 22 · Weeknights · Brooklyn", "Great Match")}
          {golfer("RK", "bg-rose-500", "Riya K.", "Beginner · Mornings · Queens", "Strong Match")}
          {golfer("DM", "bg-amber-600", "Dan M.", "Handicap 8 · Flexible · Bronx", "Strong Match")}
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-full bg-fairway-900 py-2 text-[10.5px] font-bold text-white">
          <Users size={12} /> Auto-Match Me
        </div>
      </div>
      <MockTabBar active="play" />
    </>
  );
}

// Animated score ring: CSS draws the arc once the section is in view (the
// keyframe lives in index.css as --animate-ring-draw). The dash geometry
// is r=34 -> circumference ~213.6; `score` sets the resting offset.
export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const circumference = 2 * Math.PI * 34;
  const offset = circumference * (1 - score / 100);
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" width={size} height={size} className="-rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke="#16a34a"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="animate-ring-draw"
          style={{ "--ring-offset": offset } as CSSProperties}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-2xl font-extrabold tracking-tight text-slate-900">{score}</span>
        <span className="text-[9px] font-semibold text-slate-400">/100</span>
      </span>
    </span>
  );
}

export function CaddieScreen() {
  const row = (club: string, date: string, score: number) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
      <span className="h-9 w-12 shrink-0 rounded-lg bg-gradient-to-br from-fairway-200 via-fairway-400 to-fairway-700" />
      <span className="flex-1">
        <span className="block text-[11px] font-bold leading-tight">{club}</span>
        <span className="block text-[9px] text-slate-500">{date}</span>
      </span>
      <span className="text-[12px] font-extrabold text-slate-900">{score}/100</span>
    </div>
  );
  return (
    <>
      <MockTopBar />
      <div className="px-4">
        <p className="text-[15px] font-extrabold tracking-tight">Caddie</p>
        <p className="text-[9.5px] text-slate-500">Your game, understood.</p>
        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-fairway-900 py-2.5 text-[11px] font-bold text-white">
          <Sparkles size={12} /> Analyze a Swing
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-fairway-200 bg-white p-3 shadow-sm">
          <ScoreRing score={81} size={72} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold">7 Iron · Today</span>
            <span className="mt-0.5 block text-[9px] leading-snug text-slate-500">
              Strong tempo. Hips open slightly early at the top — hold the turn a beat longer.
            </span>
          </span>
        </div>
        <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">Recent</p>
        <div className="mt-1.5 space-y-1.5">
          {row("5 Wood", "Oct 20", 76)}
          {row("7 Iron", "Oct 16", 73)}
          {row("5 Iron", "Oct 12", 67)}
        </div>
      </div>
      <MockTabBar active="caddie" />
    </>
  );
}

// Compact chat vignette for the Community section: two bubbles plus the
// composer, no phone frame (sits inside a card).
export function ChatVignette() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
        <Avatar initials="JL" tone="bg-fairway-700" />
        <span className="text-[12px] font-bold">Jordan L.</span>
        <span className="ml-auto flex items-center gap-1 text-[9px] text-slate-400">
          <MapPin size={10} /> Manhattan
        </span>
      </div>
      <div className="mt-2.5 space-y-1.5 text-[10.5px]">
        <p className="max-w-[80%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5 text-slate-800">
          Saw you&apos;re free Saturday — I&apos;ve got 2 spots at Van Cortlandt, 7:40 tee. Walking, casual.
        </p>
        <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-fairway-900 px-3 py-1.5 text-white">
          I&apos;m in. Total beginner, is that cool?
        </p>
        <p className="max-w-[80%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5 text-slate-800">100%. See you at the first tee 🏌️</p>
      </div>
      <div className="mt-2.5 flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-[10px] text-slate-400">
        Message… <span className="ml-auto h-5 w-5 rounded-full bg-fairway-900" />
      </div>
    </div>
  );
}
