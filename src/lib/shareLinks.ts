// Pure share-link + share-text builders (no React/i18n/DOM), unit-tested by
// tests/shareLinks.test.ts. Privacy rule: a shared link or message carries
// only the round id, the course name and the round's date/time. Never a
// participant or host name, email, user id or anything else from the round.

export const CANONICAL_ORIGIN = "https://golfme.app";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// window.location.origin when it's a real web origin (golfme.app in
// production and in the iOS shell, which loads the live site; a preview or
// localhost while developing), else the canonical production origin.
export function shareOrigin(locationOrigin: string | undefined | null): string {
  if (locationOrigin && /^https?:\/\/[^/]+$/i.test(locationOrigin)) return locationOrigin;
  return CANONICAL_ORIGIN;
}

export function isShareableRoundId(id: string): boolean {
  return UUID_RE.test(id);
}

export function roundShareUrl(roundId: string, origin: string): string {
  return `${origin}/golf-calls/${encodeURIComponent(roundId)}`;
}

// Collapses whitespace/newlines and caps the length, so a host-typed course
// name can't smuggle extra lines into the message.
export function cleanShareField(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export interface RoundShareFields {
  id: string;
  course: string;
  /** Absolute, already-localized date ("Sat, Oct 25"), never "Today". */
  dateLabel: string;
  timeLabel: string;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

// Only the fields named here are ever read from the round (even if a caller
// passes a whole GolfCall object), so nothing private can leak in.
export function buildRoundShare(
  round: RoundShareFields,
  templates: { title: string; text: string },
  origin: string,
): SharePayload {
  const vars = {
    course: cleanShareField(round.course),
    date: cleanShareField(round.dateLabel, 40),
    time: cleanShareField(round.timeLabel, 20),
  };
  return {
    title: fill(templates.title, vars),
    text: fill(templates.text, vars),
    url: roundShareUrl(round.id, origin),
  };
}

export function buildAppShare(templates: { title: string; text: string }, origin: string): SharePayload {
  return { title: templates.title, text: templates.text, url: `${origin}/` };
}
