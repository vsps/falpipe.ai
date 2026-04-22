import { useEffect, useRef, useState } from "react";

type Props = {
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  initial?: string;
};

// Small inline input for name creation (sequence, shot).
export function InlinePrompt({ placeholder, onConfirm, onCancel, initial = "" }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      className="bg-bg text-text px-2 py-[2px] outline-none border border-accent"
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = value.trim();
          if (v) onConfirm(v);
          else onCancel();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}
