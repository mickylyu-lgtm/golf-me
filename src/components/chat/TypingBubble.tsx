// Same surface/radius as a real incoming message bubble (see
// DirectMessageThread's own message rendering: rounded-2xl rounded-bl-sm
// bg-slate-100) so it reads as part of the conversation, not a separate UI
// element. No text -- three dots only, per spec. Reduced-motion is handled
// globally (index.css's existing prefers-reduced-motion rule collapses
// animate-typing-dot to its resting frame), no separate branch needed here.
export function TypingBubble() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5" aria-label="Typing" role="status">
      <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
    </div>
  );
}
