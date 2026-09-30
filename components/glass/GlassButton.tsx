"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

type GlassButtonProps = Omit<HTMLMotionProps<"button">, "className"> & { className?: string; variant?: "default" | "primary" };

export function GlassButton({ className = "", variant = "default", ...props }: GlassButtonProps) {
  return <motion.button className={`glass-button ${className}`} data-variant={variant} whileTap={{ scale: 0.96 }} transition={{ type: "spring", stiffness: 520, damping: 24 }} {...props} />;
}