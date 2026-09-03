import { motion } from "framer-motion";
import React from "react";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ className = "", ...props }) {
  return (
    <motion.section
      layout
      className={cn(
        "rounded-lg border border-white/10 bg-slate-950/80 shadow-xl shadow-black/30 backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className = "", ...props }) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardTitle({ className = "", ...props }) {
  return <h2 className={cn("text-base font-semibold tracking-tight text-white", className)} {...props} />;
}

export function CardContent({ className = "", ...props }) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function Badge({ className = "", ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold leading-none",
        className,
      )}
      {...props}
    />
  );
}

export function Button({ className = "", ...props }) {
  return (
    <motion.button
      whileHover={props.disabled ? undefined : { y: -1 }}
      whileTap={props.disabled ? undefined : { scale: 0.98 }}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-medium text-cyan-100 transition disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
