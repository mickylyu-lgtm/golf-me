import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";

const GUIDELINES = [
  "Keep discussion respectful — golf disagreements are fine, harassment is not.",
  "No scams or deceptive promotions.",
  "No impersonation — be who you say you are.",
  "No posting private information about yourself or others.",
  "No hateful or abusive content.",
  "No spam.",
  "GolfMe is for meeting real golfers in real life — keep it safe.",
];

export function CommunityGuidelines() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck size={20} className="text-fairway-600" /> Community Guidelines
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          GolfMe Community exists to help golfers connect, learn, and find rounds — these keep it a place people actually want to use.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-100 bg-white p-4">
        {GUIDELINES.map((g) => (
          <div key={g} className="flex items-start gap-2.5 text-sm text-slate-700">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-fairway-600" />
            {g}
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Posts and comments that break these guidelines can be reported directly from the overflow menu on any post or comment. Our
        trust &amp; safety team reviews every report.
      </p>
    </div>
  );
}
