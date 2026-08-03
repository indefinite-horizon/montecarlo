/** Provides the shared input UI primitive. */

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "default" | "sm";
};

const sizeClasses = {
  default: "h-9 px-3 py-1 text-base md:text-sm",
  sm: "h-8 px-2.5 py-1 text-xs",
} satisfies Record<NonNullable<InputProps["size"]>, string>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, size = "default", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex w-full rounded-md border border-input bg-transparent text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
