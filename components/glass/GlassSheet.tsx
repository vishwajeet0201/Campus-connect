import type { HTMLAttributes } from "react";

export function GlassSheet({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`glass-sheet ${className}`} {...props} />;
}