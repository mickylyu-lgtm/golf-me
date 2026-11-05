// "Invite to play" on a golfer's profile opens the DM thread with a
// suggested first message already in the composer. It is never sent for
// the golfer: they read it, edit it if they like, and tap Send themselves.
// Pure so tests/inviteToPlay.test.ts can run it under node --test.
//
// Never overwrite something the golfer already typed to this person: an
// unsent draft wins, and the suggestion is only seeded into an empty one.
export function inviteDraftToSeed(existingDraft: string | null | undefined, suggestion: string): string | null {
  if (existingDraft && existingDraft.trim()) return null;
  const text = suggestion.trim();
  return text ? text : null;
}
