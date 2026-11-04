import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { MatchPreferencesPanel } from "../golfer/MatchPreferencesPanel";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { matchPreferencesFromGolfer } from "../../lib/matchPreferences";
import type { MatchPreferencesValue } from "../../lib/matchPreferences";

// Match Preferences edited in place on Auto-Match (Micky, 2026-11-04: "u
// should be able to change preference right here in auto-match"), with the
// same panel as the Match Preferences page. Saved only on Save, and the
// sheet closes only once the write has succeeded; a failure keeps the draft
// open with an error toast. Auto-Match re-ranks from the saved profile, so
// the results update as soon as this closes.
export function EditMatchPreferencesSheet({ onClose }: { onClose: () => void }) {
  const { currentUser, updateCurrentUserProfile } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [draft, setDraft] = useState<MatchPreferencesValue>(() => matchPreferencesFromGolfer(currentUser));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(matchPreferencesFromGolfer(currentUser));

  async function save() {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateCurrentUserProfile({ ...draft });
      showToast(t("preferences.savedToast"), "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("preferences.saveError"), "warning");
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("preferences.title")}
      // A save in flight can't be dismissed: it would look canceled while
      // the write still lands.
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <Button fullWidth disabled={saving} onClick={save}>
          {saving ? t("preferences.saving") : t("common.saveChanges")}
        </Button>
      }
      // The panel's course search is a text field: the sheet sits on top of
      // the iOS keyboard and keeps the focused field visible in its own
      // scroller (and locks the page behind it) instead of letting iOS pan
      // the whole screen.
      keyboardAware
    >
      <MatchPreferencesPanel
        value={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        nearLocation={{ label: currentUser.areaLabel, coords: currentUser.playingAreaCoords }}
      />
    </Modal>
  );
}
