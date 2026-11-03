import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main id="content" className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-md gap-4 text-center">
        <p className="text-6xl font-bold text-primary tabular-nums">404</p>
        <h1 className="text-2xl font-bold">{t("notFound")}</h1>
        <p className="text-muted-foreground">{t("notFoundBody")}</p>
        <Link
          href="/"
          className="justify-self-center rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
