"use client";

import { Input } from "@meqyas/ui";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import * as React from "react";

export function PasswordInput({
  showLabel,
  ...props
}: React.ComponentProps<typeof Input> & { showLabel: string }) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pe-11" />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={showLabel}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted-foreground hover:text-foreground"
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
