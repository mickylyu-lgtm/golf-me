import { useState } from "react";
import { X } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { CURRENT_WHATS_NEW, readDismissedWhatsNew, shouldShowWhatsNew, splitBold, storeDismissedWhatsNew } from "../../lib/whatsNew";

// The "What's new" card at the top of the main tabs (see lib/whatsNew.ts for
// how to announce a change). Closing it stores the entry's id on this
// device, so it stays closed until the next announcement.
export function WhatsNewBanner() {
  const { currentUser } = useData();
  const { t } = useLocale();
  const entry = CURRENT_WHATS_NEW;
  const [dismissedId, setDismissedId] = useState(readDismissedWhatsNew);
  // Fixed when the screen first renders, so it never vanishes mid-read.
  const [now] = useState(() => Date.now());

  if (!entry || !shouldShowWhatsNew(entry, { dismissedId, now, memberSince: currentUser?.memberSince })) return null;

  function close() {
    if (!entry) return;
    storeDismissedWhatsNew(entry.id);
    setDismissedId(entry.id);
  }

  return (
    <div className="mx-auto mt-3 flex w-full max-w-3xl px-4 sm:px-6">
      <section
        aria-labelledby="whats-new-title"
        className="relative w-full rounded-2xl border border-fairway-200 bg-fairway-50 py-3.5 pl-4 pr-11"
      >
        <h2 id="whats-new-title" className="text-sm font-bold text-fairway-900">
          {t("whatsNew.title")}
        </h2>
        <ul className="mt-1.5 flex flex-col gap-1">
          {entry.items.map((key) => (
            <li key={key} className="flex gap-2 text-sm leading-snug text-fairway-900/85">
              <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-fairway-600" />
              <span className="min-w-0">
                {splitBold(t(key)).map((part, i) =>
                  part.bold ? (
                    <strong key={i} className="font-semibold text-fairway-900">
                      {part.text}
                    </strong>
                  ) : (
                    part.text
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={close}
          aria-label={t("whatsNew.close")}
          data-haptic="selection"
          className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-fairway-800/70 transition-colors hover:bg-fairway-100 hover:text-fairway-900"
        >
          <X size={18} />
        </button>
      </section>
    </div>
  );
}
