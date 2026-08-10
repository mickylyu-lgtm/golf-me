import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import type { PreferenceCheck } from "../../lib/preferenceMatch";
import { PREFERENCE_KEY_LABEL } from "../../lib/preferenceMatch";

// Tappable "N Shared Preferences" line — Part D of the spec: never just a
// bare score, always an honest MATCHED / NOT MATCHED breakdown a tap away.
export function SharedPreferencesBadge({ checks }: { checks: PreferenceCheck[] }) {
  const [open, setOpen] = useState(false);
  if (checks.length === 0) return null;

  const matched = checks.filter((c) => c.matched);
  const unmatched = checks.filter((c) => !c.matched);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="flex items-center gap-1 text-xs font-semibold text-fairway-700 underline-offset-2 hover:underline"
      >
        {matched.length} Shared Preference{matched.length === 1 ? "" : "s"}
        <ChevronRight size={12} />
      </button>

      {open && (
        <Modal title="Shared Preferences" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-4">
            {matched.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">Matched</p>
                <ul className="flex flex-col gap-1">
                  {matched.map((c) => (
                    <li key={c.key} className="flex items-center gap-1.5 text-sm text-fairway-800">
                      <span aria-hidden className="font-bold">
                        ✓
                      </span>
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unmatched.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Not Matched</p>
                <ul className="flex flex-col gap-1">
                  {unmatched.map((c) => (
                    <li key={c.key} className="flex items-center gap-1.5 text-sm text-slate-500">
                      <span aria-hidden>•</span>
                      {PREFERENCE_KEY_LABEL[c.key]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
