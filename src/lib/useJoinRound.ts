import { useCallback, useRef, useState } from "react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { track } from "./analytics";
import { formatDate } from "./format";
import type { GolfCall } from "../types";

// The one join path behind both "Join" buttons (round card and round page),
// always reached through ConfirmJoinModal. That sheet is the golfer's own
// "yes, put me in", not host approval: real rounds are instant-join.
// A quick double tap never sends a second join while the first is running,
// and round_joined is only counted once the join really went through.
// `call` may be undefined while a round page is still resolving its id
// (hooks run before that page's early returns); join() then does nothing.
export function useJoinRound(call: Pick<GolfCall, "id" | "dateISO" | "joinMode"> | undefined) {
  const { joinGolfCall } = useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const [joining, setJoining] = useState(false);
  const inFlight = useRef(false);
  const id = call?.id;
  const joinMode = call?.joinMode;
  const dateISO = call?.dateISO;

  const join = useCallback(async () => {
    if (inFlight.current || !id || !dateISO) return;
    inFlight.current = true;
    setJoining(true);
    try {
      await joinGolfCall(id);
      track("round_joined");
      showToast(
        joinMode === "instant"
          ? t("golfCallDetail.joinedInstantToast", { date: formatDate(dateISO, locale, t) })
          : t("golfCallDetail.requestSentToast"),
        "success",
      );
    } catch (err) {
      // Real, atomic failure (e.g. someone else took the last spot first):
      // surfaced, never a silent no-op.
      showToast(err instanceof Error ? err.message : t("golfCallDetail.joinError"), "warning");
    } finally {
      inFlight.current = false;
      setJoining(false);
    }
  }, [joinGolfCall, id, joinMode, dateISO, showToast, t, locale]);

  return { joining, join };
}
