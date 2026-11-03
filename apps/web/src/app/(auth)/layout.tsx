import { CheckCircle2Icon } from "lucide-react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { BrandMark, BrandName } from "@/components/common/brand";
import { GuestOnly } from "@/components/layout/guest-only";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");
  const tm = await getTranslations("meta");
  const points = [t("brandPoints.one"), t("brandPoints.two"), t("brandPoints.three")];
  return (
    <Suspense>
      <GuestOnly>
        <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
          <main id="content" className="flex flex-col px-5 py-8 sm:px-10">
            <div className="flex items-center gap-3">
              <BrandMark />
              <BrandName tagline={tm("tagline")} />
            </div>
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
              {children}
            </div>
          </main>
          <aside className="relative hidden overflow-hidden lg:block" aria-hidden="true">
            <div className="brand-gradient absolute inset-0" />
            <div
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, white 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 0 1px, transparent 1.5px)",
                backgroundSize: "36px 36px, 52px 52px",
              }}
            />
            <div className="relative flex h-full flex-col justify-end gap-8 p-12 text-white">
              <p className="text-sm font-medium tracking-wide text-white/80">{tm("tagline")}</p>
              <h2 className="max-w-md text-4xl leading-tight font-bold text-balance">{t("brandHeadline")}</h2>
              <ul className="grid max-w-md gap-3">
                {points.map((point) => (
                  <li
                    key={point}
                    className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm"
                  >
                    <CheckCircle2Icon className="size-5 shrink-0" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </GuestOnly>
    </Suspense>
  );
}
