import { useSyncExternalStore } from "react";
import { useLocale } from "../i18n/LocaleContext";
import { caddieFeedbackLanguage, storedCaddieFeedbackLanguage, subscribeCaddieFeedbackLanguage } from "./caddieFeedbackLanguage";

// Caddie's feedback language (lib/caddieFeedbackLanguage.ts): the golfer's
// pick on the Caddie screen, else the app language. Re-renders on a pick.
export function useCaddieFeedbackLanguage(): string {
  const { locale } = useLocale();
  const stored = useSyncExternalStore(subscribeCaddieFeedbackLanguage, storedCaddieFeedbackLanguage, () => null);
  return stored ?? caddieFeedbackLanguage(locale);
}
