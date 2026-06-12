import * as React from "react";
import { cn } from "@/lib/utils";

/** Native checkbox (no JS required) styled to sit in compact tables. */
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-3.5 w-3.5 cursor-pointer rounded-sm border-input align-middle accent-primary disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
