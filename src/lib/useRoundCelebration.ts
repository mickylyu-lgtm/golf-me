import { useCallback, useEffect, useRef, useState } from "react";
import { addSeen, parseSeen, seenKey, shouldCelebrateOnView } from "./roundCelebration";

interface CallLike {
  id: string;
  status: string;
  dateISO: string;
}

function readSeen(userId: string): string[] {
  try {
    return parseSeen(window.localStorage.getItem(seenKey(userId)));
  } catch {
    return [];
  }
}

function writeSeen(userId: string, callId: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify(addSeen(readSeen(userId), callId)));
  } catch {
    // Private mode / blocked storage: worst case it celebrates again.
  }
}

// Which round (if any) is celebrating right now. `celebrate()` is the host's
// explicit "I marked it completed"; the effect covers everyone else (see
// roundCelebration.ts for the rules). Each round celebrates at most once per
// page visit, so the host's explicit call and the realtime status flip that
// follows it never play it twice.
export function useRoundCelebration(call: CallLike | undefined, userId: string, isMember: boolean) {
  const [celebrating, setCelebrating] = useState(false);
  const playedRef = useRef<Set<string>>(new Set());

  const start = useCallback(
    (callId: string) => {
      if (playedRef.current.has(callId)) return;
      playedRef.current.add(callId);
      writeSeen(userId, callId);
      setCelebrating(true);
    },
    [userId],
  );

  const callId = call?.id;
  const status = call?.status;
  const dateISO = call?.dateISO;
  useEffect(() => {
    if (!callId || !dateISO || !userId) return;
    if (
      shouldCelebrateOnView({
        isCompleted: status === "completed",
        isJoined: isMember,
        callId,
        dateISO,
        now: Date.now(),
        seen: readSeen(userId),
      })
    ) {
      start(callId);
    }
  }, [callId, status, dateISO, userId, isMember, start]);

  const celebrate = useCallback(() => {
    if (callId) start(callId);
  }, [callId, start]);
  const done = useCallback(() => setCelebrating(false), []);

  return { celebrating, celebrate, done };
}
