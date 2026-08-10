// Canonical conversation id for a pair of golfers — sorted so the same two
// people always land on the same id regardless of who initiated.
export function dmConversationId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export function otherParticipant(conversationId: string, selfId: string): string {
  const [a, b] = conversationId.split("__");
  return a === selfId ? b : a;
}
