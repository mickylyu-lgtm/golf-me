// Which open sheet is on top. Every Modal used to close on Escape by itself,
// so with a LocationPicker open over FindRoundModal one Escape closed both.
// Each mounted sheet registers here; only the topmost answers Escape.
// No React imports, so tests/modalStack.test.ts runs under plain node.

const stack: symbol[] = [];

export function pushModal(): { isTop: () => boolean; release: () => void } {
  const token = Symbol("modal");
  stack.push(token);
  return {
    isTop: () => stack[stack.length - 1] === token,
    release: () => {
      const i = stack.indexOf(token);
      if (i !== -1) stack.splice(i, 1);
    },
  };
}

export function openModalCount(): number {
  return stack.length;
}
