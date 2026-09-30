import type { HTMLAttributes } from "react";

type GlassCardProps = HTMLAttributes<HTMLElement> & { as?: "article" | "div" | "section" };

export function GlassCard({ as = "div", className = "", ...props }: GlassCardProps) {
  const Component = as;
  return <Component className={`glass-card ${className}`} {...props} />;
}