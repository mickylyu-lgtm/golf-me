import { isFounder } from "../../lib/founder";

// Presentation only: stored/copy/preview text stays plain. Match the exact
// approved welcome and authenticated sender id, never a display name or HTML.
export const FOUNDER_WELCOME_TEXT = "Hey! I’m Micky, GolfMe’s founder. Glad you’re here. GolfMe is for finding people to golf with. It is not a dating app. Keep Community posts appropriate and respectful. We’d love to see more golf content, like round invites, swing clips, and course photos. Best way to start: host your first round in Play, and I’ll help fill it. Or film a swing in Caddie AI for a free score and tips. Questions or ideas? Message me here anytime.";
const TERMS = ["not a dating app", "appropriate and respectful", "golf content"] as const;

export function FounderWelcomeText({ senderId, text }: { senderId: string; text: string }) {
  if (!isFounder(senderId) || text !== FOUNDER_WELCOME_TEXT) return <>{text}</>;
  let offset = 0;
  const parts = TERMS.map((term) => {
    const start = text.indexOf(term, offset);
    const plain = text.slice(offset, start);
    offset = start + term.length;
    return <span key={term}>{plain}<strong className="font-semibold">{term}</strong></span>;
  });
  return <>{parts}{text.slice(offset)}</>;
}
