// Synthetic UI fixture only; aliased by check-scan-user-flows-ui.mjs.
export function useAuth() { return { isDemo: true }; }
export function useRealRounds() {
  return { editTeeTime: async (_id: string, input: unknown) => {
    const state = (window as any).__scan;
    state.saves.push(input);
    return { proofInvalidated: false };
  } };
}
