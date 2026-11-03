"use client";

import { DirectionProvider, Toaster, TooltipProvider } from "@meqyas/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import * as React from "react";

import { ApiError, setApiLocale } from "@/lib/api/client";
import { AuthProvider } from "@/lib/auth/auth-provider";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children, locale }: { children: React.ReactNode; locale: "ar" | "en" }) {
  const [queryClient] = React.useState(makeQueryClient);
  const dir = locale === "ar" ? "rtl" : "ltr";
  setApiLocale(locale);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <DirectionProvider dir={dir}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AuthProvider>{children}</AuthProvider>
          </TooltipProvider>
          <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} />
        </QueryClientProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}
