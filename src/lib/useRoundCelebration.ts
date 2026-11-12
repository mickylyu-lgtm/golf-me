import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addSeen, parseSeen, seenKey, shouldCelebrateOnView } from "./roundCelebration";
import { tapHaptic } from "./tapFeedback";

interface CallLike {
  id: string;
  status: string;
  dateISO: string;
}

// Keep the same once-per-round guarantee when storage is blocked. Bounded
// per user like the persisted list; never shared between accounts.
const sessionSeen = new Map<string, string[]>();

function readSeen(userId: string): string[] {
  let seen = sessionSeen.get(userId) ?? [];
  try {
    for (const id of parseSeen(window.localStorage.getItem(seenKey(userId)))) seen = addSeen(seen, id);
  } catch {
    // Session memory still prevents repeated feedback on route remounts.
  }
  return seen;
}

function writeSeen(userId: string, callId: string): void {
  const seen = addSeen(readSeen(userId), callId);
  sessionSeen.set(userId, seen);
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify(seen));
  } catch {
    // Session memory is enough until the app is restarted.
  }
}

// The host calls celebrate only after a confirmed write; other members use
// the fetched completed state. Both paths claim the same once-per-round gate.
// Feedback belongs to that event, never to mounting/replaying the visual card.
export function useRoundCelebration(call: CallLike | undefined, userId: string, isMember: boolean) {
  const callId = call?.id;
  const status = call?.status;
  const dateISO = call?.dateISO;
  const key = JSON.stringify([userId, callId]);
  const [celebratingKey, setCelebratingKey] = useState<string | null>(null);
  const activeRef = useRef<{ key: string; isMember: boolean } | null>(null);

  useLayoutEffect(() => {
    activeRef.current = { key, isMember };
    return () => { activeRef.current = null; };
  }, [key, isMember]);

  const start = useCallback(
    () => {
      if (!callId || !userId || activeRef.current?.key !== key || !activeRef.current.isMember) return;
      if (readSeen(userId).includes(callId)) return;
      // Claim before feedback/state so explicit completion and realtime,
      // rapid retries, StrictMode and route remounts cannot buzz twice.
      writeSeen(userId, callId);
      tapHaptic("success");
      setCelebratingKey(key);
    },
    [callId, userId, key],
  );

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
      start();
    }
  }, [callId, status, dateISO, userId, isMember, start]);

  const done = useCallback(() => setCelebratingKey(null), []);
  return { celebrating: celebratingKey === key, celebrate: start, done };
}
