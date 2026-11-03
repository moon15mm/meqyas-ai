"use client";

import { Spinner } from "@meqyas/ui";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { useAuth } from "@/lib/auth/auth-provider";

/** Auth pages are for anonymous visitors; signed-in users go to the app. */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  React.useEffect(() => {
    if (status === "authenticated") {
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    }
  }, [status, router, params]);

  if (status !== "anonymous") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  return <>{children}</>;
}
