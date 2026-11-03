"use client";

import type { LocationKind, StoreLocation, SurveyMeta } from "@meqyas/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Skeleton,
  Spinner,
} from "@meqyas/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PrinterIcon,
  QrCodeIcon,
  ReceiptIcon,
  SparklesIcon,
  StoreIcon,
  TabletIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

import { cxApi, storeApi, surveyApi } from "@/lib/api/endpoints";
import { useCan } from "@/lib/auth/auth-provider";
import { useErrorMessage } from "@/lib/errors";

export const LOCATION_KINDS: LocationKind[] = ["BRANCH", "KIOSK", "COUNTER", "EVENT", "OTHER"];
const CODE = /^[A-Za-z0-9_-]{0,24}$/;
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm";

/** Branch links on this device: the survey last picked here, else the newest published one. */
export function useBranchSurvey(projectId: string, surveys: SurveyMeta[] | undefined) {
  const storageKey = `meqyas:branch-survey:${projectId}`;
  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      setPicked(window.localStorage.getItem(storageKey));
    } catch {
      // storage unavailable (private mode): fall back to the default survey
    }
  }, [storageKey]);
  const live = React.useMemo(
    () =>
      (surveys ?? [])
        .filter((s) => s.published_version_number && s.status !== "ARCHIVED")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [surveys],
  );
  const survey = live.find((s) => s.id === picked) ?? live[0] ?? null;
  const pick = React.useCallback(
    (id: string) => {
      setPicked(id);
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        // not persisted; the choice still applies on this page
      }
    },
    [storageKey],
  );
  return { survey, live, pick };
}

/** Links of one branch (the QR code adds `c=qr` itself, server-side). */
export function branchLinks(origin: string, survey: SurveyMeta, code: string) {
  const base = `${origin}/s/${survey.public_id}?loc=${encodeURIComponent(code)}`;
  return { link: base, kiosk: `${base}&kiosk=1` };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The survey's QR code for one branch, as an object URL (revoked on change/unmount). */
export function useBranchQr(survey: SurveyMeta | null, code: string | null, kiosk = false, enabled = true) {
  const qr = useQuery({
    queryKey: ["survey-qr", survey?.id, survey?.public_id, code, kiosk],
    queryFn: () => surveyApi.qr(survey!.id, "svg", { loc: code ?? undefined, kiosk }),
    enabled: enabled && !!survey && !!code,
    staleTime: Infinity,
  });
  const url = React.useMemo(() => (qr.data ? URL.createObjectURL(qr.data) : null), [qr.data]);
  React.useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

// ------------------------------------------------------------ add / edit
function LocationFormDialog({
  projectId,
  location,
  open,
  onOpenChange,
}: {
  projectId: string;
  location: StoreLocation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("integrations.branches.form");
  const tb = useTranslations("integrations.branches");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [kind, setKind] = React.useState<LocationKind>("BRANCH");
  const [code, setCode] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(location?.name ?? "");
    setCity(location?.city ?? "");
    setKind(location?.kind ?? "BRANCH");
    setCode(location?.code ?? "");
    setTouched(false);
  }, [open, location]);

  const save = useMutation({
    mutationFn: () =>
      location
        ? cxApi.updateLocation(location.id, { name: name.trim(), city: city.trim(), kind })
        : cxApi.createLocation(projectId, {
            name: name.trim(),
            city: city.trim(),
            kind,
            code: code.trim() || undefined,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["locations", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["cx", projectId] });
      toast.success(location ? tb("saved") : tb("created", { code: saved.code }));
      onOpenChange(false);
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const nameError = touched && !name.trim() ? t("nameRequired") : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{location ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (name.trim()) save.mutate();
          }}
          noValidate
        >
          <Field id="loc-name" label={t("name")} error={nameError} required>
            <Input
              value={name}
              maxLength={200}
              autoComplete="off"
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="loc-city" label={t("city")}>
              <Input
                value={city}
                maxLength={120}
                autoComplete="address-level2"
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
            <div className="grid gap-2">
              <Label htmlFor="loc-kind">{t("kind")}</Label>
              <select
                id="loc-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as LocationKind)}
              >
                {LOCATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {tb(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Field id="loc-code" label={t("code")} hint={location ? t("codeLocked") : t("codeHint")}>
            <Input
              value={code}
              dir="ltr"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              disabled={!!location}
              placeholder="B01"
              className="font-mono uppercase"
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                if (CODE.test(next)) setCode(next);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner className="size-4" /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- QR & links
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const t = useTranslations("integrations.branches.qr");
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById(id)?.focus();
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          dir="ltr"
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void copy()}
          aria-label={`${t("copy")} — ${label}`}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <span className="max-sm:hidden">{t("copy")}</span>
        </Button>
        <Button asChild variant="ghost" size="icon" aria-label={`${t("open")} — ${label}`}>
          <a href={value} target="_blank" rel="noopener">
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function BranchQrDialog({
  survey,
  location,
  onOpenChange,
}: {
  survey: SurveyMeta;
  location: StoreLocation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("integrations.branches.qr");
  const tc = useTranslations("common");
  const toMessage = useErrorMessage();
  const [mode, setMode] = React.useState<"qr" | "kiosk">("qr");
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  React.useEffect(() => {
    if (location) setMode("qr");
  }, [location]);
  const code = location?.code ?? null;
  const qrUrl = useBranchQr(survey, code, mode === "kiosk", location !== null);
  const links = code ? branchLinks(origin, survey, code) : null;

  const save = async (format: "svg" | "png") => {
    if (!code) return;
    try {
      const blob = await surveyApi.qr(survey.id, format, { loc: code, kiosk: mode === "kiosk", scale: 16 });
      download(blob, `${survey.public_id}-${code}${mode === "kiosk" ? "-kiosk" : ""}.${format}`);
    } catch (e) {
      toast.error(toMessage(e));
    }
  };

  return (
    <Dialog open={location !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{location ? t("title", { name: location.name }) : null}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div
          role="group"
          aria-label={t("mode")}
          className="inline-flex justify-self-start rounded-lg border bg-muted/40 p-0.5"
        >
          {(["qr", "kiosk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition hover:text-foreground",
                mode === m && "bg-card text-foreground shadow-sm",
              )}
            >
              {m === "qr" ? (
                <QrCodeIcon className="size-4" aria-hidden="true" />
              ) : (
                <TabletIcon className="size-4" aria-hidden="true" />
              )}
              {t(`modes.${m}`)}
            </button>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="grid content-start gap-4">
            {links ? (
              mode === "qr" ? (
                <>
                  <p className="text-sm text-muted-foreground text-pretty">{t("qrHint")}</p>
                  <CopyField id="branch-link" label={t("link")} value={links.link} />
                </>
              ) : (
                <>
                  <ol className="grid list-decimal gap-1.5 ps-5 text-sm text-muted-foreground">
                    {(["one", "two", "three"] as const).map((step) => (
                      <li key={step} className="text-pretty">
                        {t(`kioskSteps.${step}`)}
                      </li>
                    ))}
                  </ol>
                  <CopyField id="kiosk-link" label={t("kioskLink")} value={links.kiosk} />
                </>
              )
            ) : null}
          </div>
          <div className="grid justify-items-center gap-2">
            <div className="grid size-44 place-items-center rounded-xl border bg-white p-2">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={qrUrl} alt={t("qrAlt", { name: location?.name ?? "" })} className="size-full" />
              ) : (
                <Skeleton className="size-full" />
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {code}
            </span>
            <div className="flex flex-wrap justify-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => void save("png")}>
                <DownloadIcon aria-hidden="true" />
                PNG
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void save("svg")}>
                <DownloadIcon aria-hidden="true" />
                SVG
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------- the panel
function SurveyChooser({
  projectId,
  live,
  survey,
  onPick,
  hasDrafts,
}: {
  projectId: string;
  live: SurveyMeta[];
  survey: SurveyMeta | null;
  onPick: (id: string) => void;
  hasDrafts: boolean;
}) {
  const t = useTranslations("integrations.branches");
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [created, setCreated] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => storeApi.surveyFromTemplate(projectId, "store_visit"),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["surveys", { projectId }] });
      setCreated(detail.survey.id);
      toast.success(t("templateCreated"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });
  const templateButton = can.write ? (
    <Button type="button" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
      {create.isPending ? <Spinner className="size-4" /> : <SparklesIcon aria-hidden="true" />}
      {t("useTemplate")}
    </Button>
  ) : null;

  return (
    <div className="grid gap-2 rounded-2xl border bg-card p-4">
      <Label htmlFor="branch-survey">{t("survey")}</Label>
      {live.length ? (
        <div className="flex flex-wrap gap-2">
          <select
            id="branch-survey"
            className={cn(selectClass, "flex-1 sm:max-w-md")}
            value={survey?.id ?? ""}
            onChange={(e) => onPick(e.target.value)}
            aria-describedby="branch-survey-hint"
          >
            {live.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {templateButton}
        </div>
      ) : (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="grid gap-2">
            <p>{created || hasDrafts ? t("publishFirst") : t("noPublished")}</p>
            <div className="flex flex-wrap gap-2">
              {created ? (
                <Button asChild size="sm">
                  <Link href={`/surveys/${created}`}>{t("openBuilder")}</Link>
                </Button>
              ) : (
                templateButton
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      <p id="branch-survey-hint" className="text-xs text-muted-foreground text-pretty">
        {t("surveyHint")}
      </p>
    </div>
  );
}

function PosNote() {
  const t = useTranslations("integrations.branches.pos");
  const example = `{
  "event": "order.completed",
  "order": {
    "id": "R-1001",
    "branch": "B01",
    "customer": { "phone": "+9665…" }
  }
}`;
  return (
    <details className="group rounded-2xl border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <ReceiptIcon className="size-4 text-primary" aria-hidden="true" />
        {t("title")}
      </summary>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
        <p className="text-pretty">{t("body")}</p>
        <p className="text-xs">{t("example")}</p>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs text-foreground"
        >
          {example}
        </pre>
      </div>
    </details>
  );
}

export function BranchesPanel({ projectId }: { projectId: string }) {
  const t = useTranslations("integrations.branches");
  const can = useCan();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StoreLocation | null>(null);
  const [qrFor, setQrFor] = React.useState<StoreLocation | null>(null);

  const locations = useQuery({
    queryKey: ["locations", projectId],
    queryFn: () => cxApi.locations(projectId),
  });
  const surveys = useQuery({
    queryKey: ["surveys", { projectId }],
    queryFn: () => surveyApi.forProject(projectId),
  });
  const { survey, live, pick } = useBranchSurvey(projectId, surveys.data);
  const hasDrafts = (surveys.data ?? []).some((s) => !s.published_version_number && s.status !== "ARCHIVED");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["locations", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["cx", projectId] });
  };
  const toggle = useMutation({
    mutationFn: (loc: StoreLocation) => cxApi.updateLocation(loc.id, { is_active: !loc.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.error(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => cxApi.removeLocation(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("deleted"));
    },
    onError: (e) => toast.error(toMessage(e)),
  });

  const items = locations.data ?? [];
  const addButton = can.write ? (
    <Button
      onClick={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <PlusIcon aria-hidden="true" />
      {t("add")}
    </Button>
  ) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="font-semibold">{t("title")}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length && survey ? (
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/integrations/cards?survey=${survey.id}`} target="_blank">
                <PrinterIcon aria-hidden="true" />
                {t("print")}
              </Link>
            </Button>
          ) : null}
          {items.length ? addButton : null}
        </div>
      </div>

      <SurveyChooser projectId={projectId} live={live} survey={survey} onPick={pick} hasDrafts={hasDrafts} />

      {locations.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !items.length ? (
        <Card className="grid gap-5 p-6 text-center sm:p-8">
          <StoreIcon className="mx-auto size-10 text-primary" aria-hidden="true" />
          <div className="grid gap-2">
            <p className="text-lg font-semibold">{t("empty.title")}</p>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground text-pretty">{t("empty.body")}</p>
          </div>
          <ul className="grid gap-3 text-start sm:grid-cols-3">
            {(["qr", "kiosk", "pos"] as const).map((way) => (
              <li key={way} className="grid gap-1 rounded-xl border p-4">
                <span className="font-medium">{t(`empty.ways.${way}.title`)}</span>
                <span className="text-sm text-muted-foreground text-pretty">
                  {t(`empty.ways.${way}.body`)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-center">
            {addButton ?? <p className="text-sm text-muted-foreground">{t("editorsOnly")}</p>}
          </div>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((loc) => (
            <li key={loc.id} className="grid content-start gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="grid min-w-0 gap-1">
                  <span className="font-semibold text-pretty">{loc.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="font-mono" dir="ltr">
                      {loc.code}
                    </Badge>
                    <Badge variant="soft">{t(`kinds.${loc.kind}`)}</Badge>
                    {loc.is_active ? null : (
                      <Badge variant="outline">
                        <PauseIcon aria-hidden="true" />
                        {t("paused")}
                      </Badge>
                    )}
                    {loc.city ? (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-3.5" aria-hidden="true" />
                        {loc.city}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!survey || !loc.is_active}
                  onClick={() => setQrFor(loc)}
                >
                  <QrCodeIcon aria-hidden="true" />
                  {t("qrButton")}
                </Button>
                {can.write ? (
                  <span className="ms-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${loc.is_active ? t("pause") : t("resume")} ${loc.name}`}
                      title={loc.is_active ? t("pause") : t("resume")}
                      onClick={() => toggle.mutate(loc)}
                    >
                      {loc.is_active ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("edit")} ${loc.name}`}
                      title={t("edit")}
                      onClick={() => {
                        setEditing(loc);
                        setFormOpen(true);
                      }}
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("delete")} ${loc.name}`}
                      title={t("delete")}
                      onClick={() => {
                        if (window.confirm(t("deleteConfirm"))) remove.mutate(loc.id);
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PosNote />

      <LocationFormDialog
        projectId={projectId}
        location={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
      {survey ? (
        <BranchQrDialog survey={survey} location={qrFor} onOpenChange={(open) => !open && setQrFor(null)} />
      ) : null}
    </div>
  );
}
