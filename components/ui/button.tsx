import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost", destructive: "button-danger" },
    size: { default: "button-normal", sm: "button-small", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button({ className, variant, size, type = "button", ...props }:
  ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
