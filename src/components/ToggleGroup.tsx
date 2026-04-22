type Props<T extends string | number> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
};

export function ToggleGroup<T extends string | number>({
  value,
  options,
  onChange,
  className = "",
}: Props<T>) {
  return (
    <div className={`inline-flex flex-wrap gap-[2px] ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2 py-[2px] text-xs whitespace-nowrap ${
              active
                ? "bg-accent text-text"
                : "bg-bg text-text hover:bg-panel"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
