import { Badge, Card } from "@meqyas/ui";
import { ConstructionIcon } from "lucide-react";

/**
 * Transparent placeholder for roadmap modules: it says what will exist and
 * when — it never renders placeholder numbers or fake data.
 */
export function ComingSoon({
  title,
  body,
  phaseLabel,
  features,
  featuresTitle,
}: {
  title: string;
  body: string;
  phaseLabel: string;
  features: string[];
  featuresTitle: string;
}) {
  return (
    <Card className="mx-auto w-full max-w-3xl items-center gap-4 px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <ConstructionIcon className="size-7" aria-hidden="true" />
      </span>
      <Badge variant="secondary">{phaseLabel}</Badge>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="max-w-xl text-muted-foreground text-pretty">{body}</p>
      {features.length ? (
        <div className="mt-2 grid w-full max-w-xl gap-2 text-start">
          <p className="text-sm font-semibold">{featuresTitle}</p>
          <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <span className="size-1.5 shrink-0 rounded-full bg-primary/50" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
