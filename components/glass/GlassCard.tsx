import type { HTMLAttributes } from "react";

type GlassCardProps = HTMLAttributes<HTMLElement> & { as?: "article" | "div" | "section"; surface?: "flat" | "material" | "glass" };

export function GlassCard({ as = "div", surface = "flat", className = "", ...props }: GlassCardProps) {
  const Component = as;
  return <Component className={`surface-${surface} ${className}`} {...props} />;
}