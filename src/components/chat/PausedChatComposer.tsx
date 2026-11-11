import type { ReactNode } from "react";

// Editing borrows the keyboard, not the send draft. Keep the complete
// composer mounted and the same height so draft/reply/media state and the
// existing keyboard/scroll measurements stay intact. The shield also keeps
// taps on the dimmed bar from blurring the active editor.
export function PausedChatComposer({ paused, children }: { paused: boolean; children: ReactNode }) {
  return (
    <div className="relative" data-chat-composer-paused={paused || undefined}>
      <div
        inert={paused}
        aria-hidden={paused || undefined}
        className="transition-opacity duration-150 motion-reduce:transition-none"
        style={{ opacity: paused ? 0.25 : 1 }}
      >
        {children}
      </div>
      {paused && (
        <div
          data-chat-composer-shield
          aria-hidden="true"
          className="absolute inset-0"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        />
      )}
    </div>
  );
}
