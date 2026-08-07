import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Car, Flag, Footprints, MapPin, MoreHorizontal, ShieldAlert, ShieldOff, UserPlus, Users, Wallet } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ReportModal } from "../components/trust/ReportModal";
import { CompatibilityBadge } from "../components/golfer/CompatibilityBadge";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { TrustBadgeRow } from "../components/golfer/TrustBadges";
import { computeCompatibility } from "../lib/compatibility";
import { handicapLabel } from "../lib/format";
import { VIBE_TONE } from "../lib/theme";

export function GolferProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, getGolfer, isBlocked, blockUser, unblockUser, hasPlayedWith, isInCircle, addToCircle } = useData();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);

  const golfer = id ? getGolfer(id) : undefined;
  const compat = useMemo(() => (golfer ? computeCompatibility(currentUser, golfer) : null), [currentUser, golfer]);

  if (id === currentUser.id) return <Navigate to="/profile" replace />;
  if (!golfer) {
    return (
      <div className="py-12 text-center text-slate-500">
        Golfer not found.
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const blocked = isBlocked(golfer.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More options"
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <ShieldAlert size={15} /> Report {golfer.name}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (blocked) {
                    unblockUser(golfer.id);
                    showToast(`Unblocked ${golfer.name}.`, "info");
                  } else {
                    setBlockConfirmOpen(true);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <ShieldOff size={15} /> {blocked ? `Unblock ${golfer.name}` : `Block ${golfer.name}`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar golfer={golfer} size="xl" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {golfer.name} <span className="font-normal text-slate-400">· {golfer.ageRange}</span>
          </h1>
          <p className="flex items-center justify-center gap-1 text-sm text-slate-500">
            <MapPin size={13} /> {golfer.distanceMiles.toFixed(1)} mi away · {golfer.areaLabel}
          </p>
        </div>
        {compat && <CompatibilityBadge score={compat.overall} />}
        <TrustBadgeRow golfer={golfer} />
        {hasPlayedWith(golfer.id) &&
          (isInCircle(golfer.id) ? (
            <Badge tone="fairway" icon={<Users size={12} />}>
              In your Golf Circle
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={<UserPlus size={14} />}
              onClick={() => {
                addToCircle(golfer.id);
                showToast(`Added ${golfer.name} to your Golf Circle.`, "success");
              }}
            >
              Add to Golf Circle
            </Button>
          ))}
      </div>

      {blocked && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-600">
          You've blocked {golfer.name}. You won't see each other's profiles or Golf Calls.
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="text-sm leading-relaxed text-slate-600">{golfer.bio}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Handicap</p>
          <p className="mt-1 font-bold text-slate-800">{handicapLabel(golfer.handicap)}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wallet size={12} /> Budget / round
          </p>
          <p className="mt-1 font-bold text-slate-800">
            ${golfer.budgetMin}–${golfer.budgetMax}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {golfer.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />} Preference
          </p>
          <p className="mt-1 font-bold text-slate-800">{golfer.walkOrCart}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Availability</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{golfer.availability.length} time slots/week</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Golf vibe</p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.vibes.map((v) => (
            <Badge key={v} tone={VIBE_TONE[v]}>
              {v}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Free</p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.availability.map((a) => (
            <Badge key={a} tone="outline">
              {a}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Flag size={12} /> Favorite courses
        </p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.favoriteCourses.map((c) => (
            <Badge key={c} tone="outline">
              {c}
            </Badge>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Golf Reputation</p>
        <ReputationRow golfer={golfer} />
      </div>

      {reportOpen && (
        <ReportModal reportedId={golfer.id} reportedName={golfer.name} context="profile" onClose={() => setReportOpen(false)} />
      )}
      {blockConfirmOpen && (
        <ConfirmDialog
          title={`Block ${golfer.name}?`}
          message="You won't see each other's profiles or Golf Calls, and they won't be able to message you. You can unblock anytime from this profile."
          confirmLabel="Block"
          danger
          onConfirm={() => {
            blockUser(golfer.id);
            setBlockConfirmOpen(false);
            showToast(`Blocked ${golfer.name}.`, "info");
          }}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}
