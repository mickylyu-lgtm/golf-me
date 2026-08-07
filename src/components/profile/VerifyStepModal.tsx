import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface VerifyStepModalProps {
  channel: "phone" | "email";
  target: string;
  onClose: () => void;
  onVerified: () => void;
}

export function VerifyStepModal({ channel, target, onClose, onVerified }: VerifyStepModalProps) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(true);

  return (
    <Modal title={`Verify your ${channel}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          {sent ? (
            <>
              We sent a 6-digit code to <strong>{target}</strong>. This is a prototype — any code works.
            </>
          ) : (
            "Sending code..."
          )}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6-digit code"
          inputMode="numeric"
          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-fairway-400"
        />
        <Button disabled={code.length < 6} fullWidth onClick={onVerified}>
          Confirm
        </Button>
        <button onClick={() => setSent(true)} className="text-xs font-medium text-fairway-700 hover:underline">
          Resend code
        </button>
      </div>
    </Modal>
  );
}
