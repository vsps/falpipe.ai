import type { MouseEventHandler } from "react";
import { Icon } from "../lib/icon";

type Props = {
  name: string;
  size?: number;
  title?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  fill?: boolean;
};

export function IconBtn({ name, size = 20, title, onClick, disabled, className = "", fill }: Props) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 inline-flex items-center justify-center hover:opacity-100 ${
        disabled ? "opacity-30 cursor-not-allowed" : "opacity-80 hover:opacity-100 cursor-pointer"
      } ${className}`}
    >
      <Icon name={name} size={size} fill={fill} />
    </button>
  );
}
