import { Share2 } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { useShareActions } from "../../lib/useShareActions";
import type { GolfCall } from "../../types";
import { Button } from "../ui/Button";

// Visibility stays with the parent: only real hosts of active rounds can
// invite. This action never joins a round or posts to Community.
export function RoundShareButton({ call }: { call: Pick<GolfCall, "id" | "course" | "dateISO" | "timeLabel"> }) {
  const { t } = useLocale();
  const { shareRound } = useShareActions(call.id);
  return (
    <Button type="button" fullWidth className="min-h-11" icon={<Share2 size={18} aria-hidden="true" />} onClick={() => void shareRound(call)}>
      {t("share.shareRoundButton")}
    </Button>
  );
}
