import type { HTMLAttributes } from "react";

export function GlassBar({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <div className={`glass-bar ${className}`} {...props} />;
}