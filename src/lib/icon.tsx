import type { CSSProperties } from "react";

type Props = {
  name: string;
  size?: number;
  fill?: boolean;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void;
};

// Material Symbols Outlined ligature. Font loaded via <link> in index.html.
export function Icon({ name, size = 20, fill = false, className = "", title, onClick }: Props) {
  const style: CSSProperties = {
    fontSize: `${size}px`,
    fontVariationSettings: `"FILL" ${fill ? 1 : 0}, "wght" 400, "GRAD" 0, "opsz" ${Math.min(48, Math.max(20, size))}`,
  };
  return (
    <span
      className={`material-symbols-outlined select-none ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={style}
      title={title}
      onClick={onClick}
      aria-hidden={title ? undefined : true}
    >
      {name}
    </span>
  );
}
