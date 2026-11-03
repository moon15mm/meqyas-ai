import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        soft: "border-transparent bg-primary/10 text-primary",
        outline: "text-foreground",
        evidence: "border-transparent bg-evidence/12 text-evidence dark:bg-evidence/20",
        success: "border-transparent bg-success/12 text-success",
        warning: "border-transparent bg-warning/20 text-warning-foreground dark:text-warning",
        destructive: "border-transparent bg-destructive/12 text-destructive",
        demo: "border-warning/50 bg-warning/15 font-semibold tracking-wide text-warning-foreground uppercase dark:text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
