"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Subscribe to a CSS media query. Server render and first paint assume `fallback`. */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      // Some embedded/emulated browsers resize without firing MediaQueryList "change".
      window.addEventListener("resize", onChange);
      return () => {
        list.removeEventListener("change", onChange);
        window.removeEventListener("resize", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
