import type { InputHTMLAttributes } from "react";

export function GlassInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`glass-input ${className}`} {...props} />;
}