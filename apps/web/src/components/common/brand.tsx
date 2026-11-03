import { cn } from "@meqyas/ui";

/** MEQYAS mark: a gauge-like arc + rising bars ("from idea to evidence"). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9", className)}>
      <defs>
        <linearGradient id="meqyas-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--hero-from)" />
          <stop offset="1" stopColor="var(--hero-to)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#meqyas-g)" />
      <path
        d="M9 27a11 11 0 0 1 22 0"
        fill="none"
        stroke="white"
        strokeOpacity=".45"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect x="13" y="20" width="3.2" height="9" rx="1.6" fill="white" fillOpacity=".75" />
      <rect x="18.4" y="16" width="3.2" height="13" rx="1.6" fill="white" fillOpacity=".9" />
      <rect x="23.8" y="12" width="3.2" height="17" rx="1.6" fill="white" />
    </svg>
  );
}

export function BrandName({ className, tagline }: { className?: string; tagline?: string }) {
  return (
    <span className={cn("flex flex-col leading-tight", className)}>
      <span className="text-base font-bold tracking-tight">
        مِقياس <span className="text-primary">AI</span>
      </span>
      {tagline ? <span className="text-xs text-muted-foreground">{tagline}</span> : null}
    </span>
  );
}
