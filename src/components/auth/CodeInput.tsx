import { useState } from "react";
import type { Ref } from "react";
import { sanitizeCode } from "../../lib/emailCodeFlow";

interface CodeInputProps {
  id: string;
  value: string;
  length: number;
  onChange: (code: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

// Six boxes, ONE real input. The input lies over the boxes (transparent
// text and caret, still fully visible to the browser), so:
// - iOS offers the code from Mail above the keyboard (autocomplete
//   one-time-code), and paste puts the whole code in at once;
// - backspace, selection and screen readers behave like a normal field;
// - there is no focus hopping between six inputs.
// 16px font so iOS Safari doesn't zoom on focus.
export function CodeInput({ id, value, length, onChange, label, disabled, invalid, describedBy, autoFocus, inputRef }: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  // Keep the caret at the end: the boxes show digits in order, so editing
  // in the middle of an invisible field would be confusing.
  const toEnd = (el: HTMLInputElement) => {
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  return (
    <div className="relative">
      <div className="flex justify-between gap-2" aria-hidden>
        {Array.from({ length }, (_, i) => {
          const digit = value[i] ?? "";
          const isActive = focused && !disabled && i === active;
          return (
            <span
              key={i}
              className={`flex h-14 min-w-0 flex-1 items-center justify-center rounded-2xl border bg-white text-2xl font-semibold text-slate-900 transition-colors duration-150 motion-reduce:transition-none sm:h-16 ${
                invalid ? "border-red-300" : isActive ? "border-brand-forest ring-2 ring-fairway-200" : digit ? "border-slate-300" : "border-slate-200"
              } ${disabled ? "opacity-60" : ""}`}
            >
              {digit || (isActive ? <span className="h-6 w-0.5 animate-pulse rounded-full bg-brand-forest motion-reduce:animate-none" /> : null)}
            </span>
          );
        })}
      </div>
      <input
        id={id}
        ref={inputRef}
        name="one-time-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        // No maxLength: it would cut a pasted "123 456" before the spaces
        // are stripped.
        value={value}
        onChange={(e) => onChange(sanitizeCode(e.target.value, length))}
        onFocus={(e) => {
          setFocused(true);
          toEnd(e.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        onSelect={(e) => toEnd(e.currentTarget)}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // The active box's ring is the focus indicator; the app-wide
        // :focus-visible outline would draw a second ring around all six.
        style={{ outline: "none" }}
        className="absolute inset-0 h-full w-full cursor-text rounded-2xl bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  );
}
