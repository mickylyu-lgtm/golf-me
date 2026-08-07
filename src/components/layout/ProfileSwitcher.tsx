import { Check } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { isNewAccount } from "../../lib/format";

export function ProfileSwitcher({ onClose }: { onClose: () => void }) {
  const { golfers, currentUser, switchCurrentUser } = useData();
  const { showToast } = useToast();

  return (
    <Modal title="Preview Golf Me as..." onClose={onClose}>
      <p className="mb-3 text-xs text-slate-500">
        Prototype tool — switch identities to see the app from different golfers' perspectives (hosts, new members,
        varying reputation). In the shipped app this maps to real sign-in.
      </p>
      <div className="flex flex-col gap-1">
        {golfers.map((g) => {
          const isActive = g.id === currentUser.id;
          return (
            <button
              key={g.id}
              onClick={() => {
                switchCurrentUser(g.id);
                showToast(`Now viewing Golf Me as ${g.name}`, "info");
                onClose();
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                isActive ? "bg-fairway-50" : "hover:bg-slate-50"
              }`}
            >
              <Avatar golfer={g} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                <p className="text-xs text-slate-500">
                  {isNewAccount(g.reputation.completedRounds) ? "New account" : `${g.reputation.completedRounds} rounds played`}
                </p>
              </div>
              {isActive && <Check size={16} className="text-fairway-600" />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
