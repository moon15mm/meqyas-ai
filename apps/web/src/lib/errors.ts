"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { ApiError } from "@/lib/api/client";

const KNOWN_AI_CODES = new Set([
  "ai_not_configured",
  "ai_unavailable",
  "ai_auth_error",
  "ai_rate_limited",
  "ai_timeout",
  "ai_invalid_output",
  "ai_budget_exceeded",
  "ai_bad_request",
]);

/** Map an API error to a localized, human message (never leak raw stack/provider details). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  const ta = useTranslations("auth");
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        if (KNOWN_AI_CODES.has(error.code)) return t(error.code as "ai_not_configured");
        switch (error.code) {
          case "invalid_credentials":
            return ta("invalidCredentials");
          case "email_taken":
            return ta("emailTaken");
          case "weak_password":
            return ta("weakPassword");
          case "invalid_reset_token":
            return ta("invalidResetToken");
          case "network_error":
            return t("network");
          case "rate_limited":
            return t("rateLimited");
          case "forbidden":
            return t("forbidden");
          default:
            // Codes with their own localized text (never the server's English message).
            if (t.has(`codes.${error.code}`)) return t(`codes.${error.code}` as "codes.no_data");
            if (error.status === 403) return t("forbidden");
            if (error.status >= 500 || error.status === 0) return t("generic");
            return error.message || t("generic");
        }
      }
      return t("generic");
    },
    [t, ta],
  );
}
