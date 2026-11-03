"use client";

import { useCallback, useSyncExternalStore } from "react";

const ADVANCED_KEY = "meqyas.advancedMode";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** "Advanced Measurement" mode: specialists see formulas, evidence levels and rule traces. */
export function useAdvancedMode(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(ADVANCED_KEY) === "1",
    () => false,
  );
  const set = useCallback((next: boolean) => {
    window.localStorage.setItem(ADVANCED_KEY, next ? "1" : "0");
    for (const listener of listeners) listener();
  }, []);
  return [value, set];
}

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function setLocaleCookie(locale: "ar" | "en"): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
