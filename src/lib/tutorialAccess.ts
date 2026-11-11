import { isFounder } from "./founder.ts";

// Manual replay is an owner tool. Use the authenticated subject, never a
// directory/demo profile, mutable email, user metadata, or an admin role.
export function canReplayTutorial(isDemo: boolean, authenticatedUserId?: string | null): boolean {
  return !isDemo && !!authenticatedUserId && isFounder(authenticatedUserId);
}
