interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  // True while the switch's own save is in flight.
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
        checked ? "bg-fairway-600" : "bg-slate-200"
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform duration-200 ease-out ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
