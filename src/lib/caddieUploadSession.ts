// Only pre-row requests in this JS session, never durable server job state.
const KEY = "golfme:caddieUploadInProgress";
type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function createCaddieUploadSession(storage: () => MarkerStorage) {
  const active = new Set<symbol>();
  const safely = (operation: (value: MarkerStorage) => void) => {
    try { operation(storage()); } catch { /* Storage may be unavailable. */ }
  };
  return {
    consumeInterrupted(): boolean {
      if (active.size) return false;
      let interrupted = false;
      safely((value) => {
        interrupted = !!value.getItem(KEY);
        if (interrupted) value.removeItem(KEY);
      });
      return interrupted;
    },
    begin(): () => void {
      const token = Symbol();
      active.add(token);
      safely((value) => value.setItem(KEY, "1"));
      return () => {
        if (!active.delete(token)) return;
        if (!active.size) safely((value) => value.removeItem(KEY));
      };
    },
  };
}
export const caddieUploadSession = createCaddieUploadSession(() => localStorage);
