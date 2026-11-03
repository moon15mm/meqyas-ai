/** API response contracts (mirrors apps/api/app/schemas). */
import type {
  EvidenceLevel,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorStatus,
  IndicatorType,
  MeasurementDesign,
  MeasurementType,
  OutcomeLevel,
  PlanFeatureCode,
  ProjectStatus,
  QuestionType,
  Role,
  Sector,
  SubscriptionStateCode,
  WaveType,
} from "./enums";
import type { MeasurementPlanDraft } from "./schemas/plan";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  locale: "ar" | "en";
  created_at: string;
  /** Platform administrators manage subscribers, plans and gifts (SUBSCRIPTIONS.md). */
  is_platform_admin?: boolean;
}

// ------------------------------------------------------- subscriptions (SUBSCRIPTIONS.md)
export type SubscriptionState = SubscriptionStateCode;
export type PlanFeature = PlanFeatureCode;

/** Effective limits (the plan's, or the workspace's own); null = unlimited. */
export interface PlanLimits {
  surveys: number | null;
  responses_per_month: number | null;
  members: number | null;
  ai_daily_tokens: number | null;
}

export interface PlanUsage {
  /** Surveys published for the first time in the current period. */
  surveys: number;
  responses_this_month: number;
  members: number;
}

export interface SubscriptionSummary {
  plan_code: string;
  plan_name_ar: string;
  plan_name_en: string;
  is_trial: boolean;
  state: SubscriptionState;
  period_started_at: string | null;
  period_ends_at: string | null;
  pending_days: number | null;
  /** Published surveys keep collecting until then (period end + grace days). */
  collection_ends_at: string | null;
  /** When the monthly response counter starts again. */
  month_resets_at: string;
  limits: PlanLimits;
  usage: PlanUsage;
  features: PlanFeature[];
}

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: Role;
  is_demo: boolean;
  /** The workspace's plan, period, limits and usage. */
  subscription?: SubscriptionSummary | null;
}

/** A message for one person, shown once (an activation, recovery or sign-in link). */
export interface AccountMessage {
  recipient_name: string;
  recipient_email: string;
  locale: "ar" | "en";
  kind: "activation" | "reset" | "sign_in";
  subject: string;
  body: string;
  link: string;
  expires_at: string | null;
  emailed: boolean;
  email_available: boolean;
}

export interface ActivationPreview {
  state: "valid" | "expired" | "used" | "invalid";
  full_name?: string | null;
  email?: string | null;
  organization_name?: string | null;
  locale?: "ar" | "en" | null;
  expires_at?: string | null;
}

export interface SubscriptionPlan {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  is_trial: boolean;
  default_days: number | null;
  max_surveys: number | null;
  max_responses_per_month: number | null;
  max_members: number | null;
  ai_daily_tokens: number | null;
  features: PlanFeature[];
  is_archived: boolean;
  sort_order: number;
  subscribers: number;
}

export type SubscriptionPlanInput = Omit<SubscriptionPlan, "id" | "subscribers" | "is_archived" | "code">;

export interface LimitOverrides {
  surveys?: number | null;
  responses_per_month?: number | null;
  members?: number | null;
  ai_daily_tokens?: number | null;
}

export interface SubscriberOwner {
  user_id: string;
  full_name: string;
  email: string;
  last_login_at: string | null;
  pending: boolean;
}

export interface SubscriberItem {
  organization_id: string;
  organization_name: string;
  sector: Sector;
  locale: "ar" | "en";
  is_demo: boolean;
  created_at: string;
  owner: SubscriberOwner | null;
  subscription: SubscriptionSummary;
  last_activity_at: string | null;
}

export type SubscriberFilter = SubscriptionState | "ENDING_SOON";

export interface SubscriberPage {
  items: SubscriberItem[];
  total: number;
  limit: number;
  offset: number;
  stats: { total: number; by_state: Partial<Record<SubscriptionState, number>>; ending_soon: number };
}

export interface SubscriberMember {
  member_id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  pending: boolean;
  is_active: boolean;
  is_platform_admin: boolean;
  other_workspaces: number;
}

export interface SubscriberEvent {
  action: string;
  created_at: string;
  actor_name: string | null;
  meta: Record<string, unknown>;
}

export interface SubscriberDetail extends SubscriberItem {
  timezone: string;
  suspended_at: string | null;
  suspension_reason: string;
  admin_note: string;
  overrides: LimitOverrides;
  updated_at: string;
  members: SubscriberMember[];
  events: SubscriberEvent[];
}

export interface SubscriberCreateInput {
  owner_name: string;
  owner_email: string;
  organization_name: string;
  sector: Sector;
  locale: "ar" | "en";
  plan_code: string;
  days: number | null;
  overrides?: LimitOverrides | null;
  admin_note: string;
  send_email: boolean;
}

export interface RowResult {
  row: number;
  name: string;
  email: string;
  status: "created" | "added" | "error";
  error_code: string | null;
  organization_id: string | null;
  message: AccountMessage | null;
}

export interface BulkResult {
  results: RowResult[];
  created: number;
  added: number;
  failed: number;
}

// ------------------------------------------------------------------- gifts (GIFTS.md)
export type GiftState = "pending" | "expired" | "active" | "revoked";

export interface Gift {
  id: string;
  recipient_name: string;
  recipient_email: string;
  organization_id: string | null;
  organization_name: string | null;
  locale: "ar" | "en";
  note: string;
  survey_limit: number;
  surveys_published: number;
  trial_days: number | null;
  trial_ends_at: string | null;
  new_account: boolean;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  state: GiftState;
  token_expires_at: string | null;
  emailed_at: string | null;
  activated_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface GiftInput {
  recipient_name: string;
  recipient_email: string;
  organization_name?: string;
  sector?: Sector;
  survey_limit: number;
  trial_days: number | null;
  locale: "ar" | "en";
  note?: string;
  send_email: boolean;
}

/** Returned once, when a gift is prepared or its link renewed: the link is never shown again. */
export interface GiftMessage {
  gift: Gift;
  subject: string;
  body: string;
  link: string;
  emailed: boolean;
  email_available: boolean;
}

export interface GiftPreview {
  state: "valid" | "expired" | "used" | "revoked" | "invalid";
  recipient_name?: string | null;
  email?: string | null;
  organization_name?: string | null;
  survey_limit?: number | null;
  trial_days?: number | null;
  note?: string | null;
  locale?: "ar" | "en" | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
  memberships: Membership[];
}

export interface Me {
  user: User;
  memberships: Membership[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  sector: Sector;
  locale: string;
  timezone: string;
  settings: { ai?: { allow_cloud_ai?: boolean; followup_limit?: number } } & Record<string, unknown>;
  is_demo: boolean;
  created_at: string;
  role: Role | null;
}

export interface Member {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
  last_login_at?: string | null;
  /** Invited, has not activated the account yet. */
  pending?: boolean;
  /** This workspace's admins may prepare activation / recovery links for this person. */
  links_allowed?: boolean;
}

export interface MemberAdded {
  member: Member;
  message: AccountMessage;
}

export interface ProjectType {
  code: MeasurementType;
  level: OutcomeLevel;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  default_design: MeasurementDesign;
  change_oriented: boolean;
  sort_order: number;
}

export interface Project {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  measurement_type: MeasurementType;
  sector: Sector;
  target_population: string;
  status: ProjectStatus;
  is_demo: boolean;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  statement: string;
  description: string;
}

export interface Objective {
  id: string;
  key: string;
  title: string;
  description: string;
  goal_id: string | null;
  sort_order: number;
}

export interface Dimension {
  id: string;
  key: string;
  name: string;
  description: string;
  objective_id: string | null;
  sort_order: number;
}

export interface Indicator {
  id: string;
  dimension_id: string | null;
  code: string;
  name: string;
  description: string;
  measurement_type: MeasurementType | null;
  indicator_type: IndicatorType;
  formula: string;
  computation: Record<string, unknown>;
  unit: string;
  direction: IndicatorDirection;
  target_label: string;
  target_value: number | null;
  baseline_value: number | null;
  current_value: number | null;
  source: string;
  frequency: IndicatorFrequency;
  owner: string;
  status: IndicatorStatus;
  last_computed_at: string | null;
  sort_order: number;
}

export interface Wave {
  id: string;
  wave_type: WaveType;
  name: string;
  timing: string;
  sort_order: number;
  planned_date: string | null;
  offset_days: number | null;
  status: "PLANNED" | "OPEN" | "CLOSED";
}

export interface ProjectPlan {
  plan_id: string | null;
  status: "DRAFT" | "ACCEPTED" | null;
  measurement_type: MeasurementType;
  recommended_design: MeasurementDesign | null;
  design_rationale: string;
  evidence_level: EvidenceLevel | null;
  purpose: string;
  target_population: string;
  baseline_required: boolean;
  post_measurement_required: boolean;
  follow_up_recommended: boolean;
  follow_up_days: number | null;
  recommended_questions_count: number | null;
  estimated_completion_minutes: number | null;
  methodology_notes: string[];
  understanding_summary: string;
  measurement_type_rationale: string;
  source_prompt: string;
  goal: Goal | null;
  objectives: Objective[];
  dimensions: Dimension[];
  indicators: Indicator[];
  waves: Wave[];
}

export interface ProjectOverview {
  project: Project;
  plan: ProjectPlan;
  counts: Record<string, number>;
}

export interface MeasurementPlan {
  id: string;
  status: "DRAFT" | "ACCEPTED";
  project_id: string | null;
  source_prompt: string;
  language: "ar" | "en";
  generation_count: number;
  draft: MeasurementPlanDraft;
  ai_run_id: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
}

export interface AIStatus {
  configured: boolean;
  provider: string | null;
  /** Human-friendly provider name, e.g. "OpenAI", "Groq", "Ollama (local)". */
  provider_label: string | null;
  model_fast: string | null;
  model_smart: string | null;
  local_enabled: boolean;
  local_provider_models: { fast: string; smart: string } | null;
  reason: string | null;
  healthy: boolean | null;
  health_detail: string | null;
  /** Second provider used automatically when the primary cannot serve. */
  fallback_configured: boolean;
  fallback_provider_label: string | null;
  fallback_model_fast: string | null;
  fallback_model_smart: string | null;
  /** Set when a fallback is configured but unusable (e.g. a missing key). */
  fallback_reason: string | null;
  fallback_healthy: boolean | null;
  fallback_health_detail: string | null;
}

export interface AIUsage {
  today_tokens: number;
  daily_limit: number;
  runs_today: number;
}

// ------------------------------------------------------------------ surveys
export type SurveyStatus = "DRAFT" | "PUBLISHED" | "PAUSED" | "CLOSED" | "ARCHIVED";
export type VersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface SurveyVersionMeta {
  id: string;
  version_number: number;
  status: VersionStatus;
  published_at: string | null;
  updated_at: string;
}

export interface SurveyMeta {
  id: string;
  project_id: string;
  project_title: string;
  wave_id: string | null;
  wave_type: WaveType | null;
  wave_name: string | null;
  title: string;
  description: string;
  status: SurveyStatus;
  public_id: string;
  language: string;
  ai_generated: boolean;
  is_demo: boolean;
  question_count: number;
  current_version: SurveyVersionMeta | null;
  published_version_number: number | null;
  has_unpublished_changes: boolean;
  response_count: number;
  last_response_at: string | null;
  opens_at: string | null;
  closes_at: string | null;
  response_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface LogicIssue {
  rule_index: number;
  rule_id: string | null;
  code: string;
  message: string;
}

export interface QualityNote {
  code: string;
  params: Record<string, unknown>;
}

export interface QualityAxis {
  key:
    | "question_quality"
    | "goal_alignment"
    | "bias_risk"
    | "length"
    | "coverage"
    | "analysis_readiness"
    | "logic_quality";
  score: number;
  max: number;
  notes: QualityNote[];
}

export interface QualityReport {
  total: number;
  estimated_minutes: number;
  answerable_count: number;
  axes: QualityAxis[];
}

export type ReviewIssueType =
  | "DOUBLE_BARRELED"
  | "LEADING"
  | "AMBIGUOUS"
  | "TOO_LONG"
  | "BIASED"
  | "DUPLICATE"
  | "IRRELEVANT"
  | "MISSING_OPTIONS"
  | "WRONG_SCALE"
  | "OTHER";

export interface ReviewIssue {
  id: string;
  question_key: string;
  type: ReviewIssueType;
  severity: "LOW" | "MEDIUM" | "HIGH";
  problem: string;
  reason: string;
  /** REWRITE replaces the text, OPTIONS the options, REMOVE deletes the item, NONE = manual edit only. */
  fix: "REWRITE" | "OPTIONS" | "REMOVE" | "NONE";
  suggestion: string;
  suggested_options: string[];
  status: "open" | "accepted" | "rejected" | "stale";
  question_text: string;
}

export interface CompletenessIssue {
  code: "missing_title" | "missing_text" | "missing_option_label" | "missing_row_text";
  question_key: string;
}

export interface SurveyDetail {
  survey: SurveyMeta;
  doc: import("./survey/document").SurveyDoc;
  logic_issues: LogicIssue[];
  /** Unfinished items that block publishing. */
  completeness: CompletenessIssue[];
  quality: QualityReport;
  review: { ran_at: string | null; overall_comment: string; issues: ReviewIssue[] };
}

export type SurveyAction =
  "publish" | "pause" | "resume" | "close" | "reopen" | "archive" | "discard_changes";

// ---------------------------------------------------------- responses (Phase 4)
export type Availability = "OPEN" | "PAUSED" | "CLOSED" | "NOT_STARTED" | "FULL";

/** Respondent-facing survey (no scoring keys, no internal ids). */
export interface PublicSurvey {
  public_id: string;
  title: string;
  language: "ar" | "en";
  availability: Availability;
  version: number | null;
  doc: unknown | null;
  session: string | null;
  ai_followup: boolean;
  is_demo: boolean;
  /** Present when the link carried a store invitation (`?inv=`). */
  invitation?: PublicInvitation | null;
  /** The branch / kiosk named by the link (`?loc=`), when known and active. */
  location?: { code: string; name: string } | null;
}

export type InvitationState = "valid" | "used" | "expired" | "closed" | "invalid";

export interface PublicInvitation {
  state: InvitationState;
  store?: string | null;
  product?: string | null;
}

export type QualityStatus = "VALID" | "SUSPICIOUS" | "LOW_QUALITY";
export type ReviewStatus = "NONE" | "KEEP" | "EXCLUDE";
export type ResponseChannel = "LINK" | "QR" | "EMBED" | "IMPORT" | "DEMO" | "STORE";

export interface QualityFlag {
  code:
    | "way_too_fast"
    | "too_fast"
    | "straightlining"
    | "inconsistent_reverse_items"
    | "low_effort_text"
    | "skipped_optional"
    | "repeat_device";
  [detail: string]: unknown;
}

export interface ResponseSummary {
  id: string;
  survey_id: string;
  survey_title: string;
  version_number: number;
  wave_type: WaveType | null;
  respondent_label: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  channel: ResponseChannel;
  device: "mobile" | "tablet" | "desktop" | "unknown" | string;
  locale: string;
  answered_count: number;
  quality_score: number;
  quality_status: QualityStatus;
  quality_flags: QualityFlag[];
  review_status: ReviewStatus;
  is_demo: boolean;
  created_at: string;
}

export interface ResponseCounts {
  total: number;
  valid: number;
  suspicious: number;
  low_quality: number;
  excluded: number;
  kept: number;
}

export interface ResponsePage {
  items: ResponseSummary[];
  total: number;
  limit: number;
  offset: number;
  counts: ResponseCounts;
}

export interface AnswerView {
  question_key: string;
  question_text: string;
  question_type: QuestionType | "";
  section_title: string;
  row_key: string | null;
  row_text: string | null;
  value: unknown;
  display: string;
  other_text: string | null;
  is_followup: boolean;
  followup_prompt: string | null;
}

export interface ResponseDetail extends ResponseSummary {
  answers: AnswerView[];
  respondent_name: string | null;
  respondent_email: string | null;
}

// ---------------------------------------------------------- analytics (Phase 5)
/** Every statistic says whether it is meaningful; `reason` explains why not. */
export interface StatResult {
  suitable: boolean;
  reason: string | null;
}

export interface StatsDescribe extends StatResult {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  modes: number[];
}

/** A mean with its CI, or a proportion (0–1) with its Wilson interval (top-box, option shares, CSAT). */
export interface StatsInterval extends StatResult {
  estimate: number | null;
  low: number | null;
  high: number | null;
  level: number;
}

export interface StatsChange extends StatResult {
  from_value: number | null;
  to_value: number | null;
  absolute: number | null;
  percent: number | null;
}

export interface StatsTest extends StatResult {
  test: "welch_t" | "paired_t" | "";
  n_a: number;
  n_b: number;
  mean_a: number | null;
  mean_b: number | null;
  difference: number | null;
  statistic: number | null;
  df: number | null;
  p_value: number | null;
  ci_low: number | null;
  ci_high: number | null;
  effect_size: number | null;
  effect_label: "negligible" | "small" | "medium" | "large" | null;
}

export interface NpsResult extends StatResult {
  n: number;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  score: number | null;
  ci_low: number | null;
  ci_high: number | null;
}

export interface DistributionCategory {
  value: string;
  label: string;
  count: number;
  pct: number;
}

export interface DistributionResult {
  n: number;
  suitable: boolean;
  categories: DistributionCategory[];
}

export interface DimensionWave {
  wave: string;
  n: number;
  masked: boolean;
  mean: number | null;
  scale_min: number | null;
  scale_max: number | null;
  score: number | null;
  ci_low: number | null;
  ci_high: number | null;
  top_box: StatsInterval | null;
  alpha: number | null;
  alpha_label: "excellent" | "good" | "acceptable" | "questionable" | "poor" | null;
}

export interface DimensionResult {
  id: string;
  key: string;
  name: string;
  items: number;
  waves: DimensionWave[];
}

export interface ComparisonResult {
  from_wave: string;
  to_wave: string;
  scale: "native" | "score_100";
  /** Bounds of the compared scale (0–100 when items use different scales). */
  scale_min: number;
  scale_max: number;
  n_from: number;
  n_to: number;
  n_pairs: number;
  paired: boolean;
  /** Fewer than K responses in a wave: no means or tests are reported. */
  masked: boolean;
  from_mean: number | null;
  to_mean: number | null;
  change: StatsChange;
  test: StatsTest;
}

export interface IndicatorResult {
  id: string;
  code: string;
  name: string;
  indicator_type: IndicatorType;
  unit: string;
  direction: IndicatorDirection;
  target_value: number | null;
  method: string | null;
  items: number;
  /** Where the questions come from: linked to this indicator, or (when none are) its dimension's. */
  items_from?: "indicator" | "dimension" | null;
  waves: Array<{
    wave: string;
    value: number | null;
    n: number;
    reason: "no_linked_questions" | "no_data" | "below_k_anonymity" | "population_size_unknown" | null;
  }>;
  current_value: number | null;
  baseline_value: number | null;
  status: IndicatorStatus;
  change?: StatsChange;
  comparison?: ComparisonResult | null;
}

export type CausalityNote =
  | "descriptive_only"
  | "perceived_change"
  | "trend_only"
  | "change_not_cause"
  | "contribution"
  | "attribution";

export interface AnalyticsSummary {
  project_id: string;
  generated_at: string;
  counts: {
    total: number;
    included: number;
    valid: number;
    suspicious: number;
    low_quality: number;
    excluded: number;
  };
  median_duration_seconds: number | null;
  last_response_at: string | null;
  responses_by_day: Array<{ date: string; count: number }>;
  waves: Array<{ wave: string; name: string | null; n: number; survey_ids: string[] }>;
  overall_score: number | null;
  top_strength: { dimension_id: string; name: string; score: number } | null;
  top_problem: { dimension_id: string; name: string; score: number } | null;
  nps: NpsResult | null;
  csat: StatsInterval | null;
  dimensions: DimensionResult[];
  indicators: IndicatorResult[];
  evidence_level: EvidenceLevel;
  design: MeasurementDesign | null;
  causality: { allows_causal_language: boolean; note: CausalityNote | null };
  k_anonymity: number;
  /** Included responses per channel (STORE = answers to store invitations). */
  channels: Partial<Record<ResponseChannel, number>>;
  /** Distinct products rated through store invitations. */
  products: number;
}

export type QuestionStatsCore = Pick<
  QuestionStats,
  "describe" | "top_box" | "distribution" | "nps" | "options" | "rows"
>;

export interface QuestionStats {
  key: string;
  text: string;
  type: QuestionType;
  section: string;
  dimension_id: string | null;
  indicator_id: string | null;
  is_profile: boolean;
  n: number;
  /** Fewer than K answers: only `n` is reported (k-anonymity). */
  masked: boolean;
  describe?: StatsDescribe;
  ci?: StatsInterval;
  distribution?: DistributionResult;
  top_box?: StatsInterval & { threshold?: number };
  nps?: NpsResult;
  rows?: Array<{
    key: string;
    text: string;
    describe: StatsDescribe;
    distribution: DistributionResult;
    top_box?: StatsInterval;
  }>;
  options?: Array<{ value: string; label: string; count: number; pct: number; ci: StatsInterval }>;
  ranking?: Array<{ value: string; label: string; mean_rank: number | null; first_pct: number }>;
  text_count?: number;
  text_samples?: string[];
  segment?: string;
  segments?: Array<{
    value: string;
    label: string;
    n: number;
    masked: boolean;
    stats: QuestionStatsCore | null;
  }>;
}

export interface WaveComparison {
  from_wave: string;
  to_wave: string;
  dimensions: Array<ComparisonResult & { dimension_id: string; key: string; name: string }>;
  questions: Array<ComparisonResult & { key: string; text: string }>;
  evidence_level: EvidenceLevel | null;
  causality: CausalityNote | null;
}

export interface CrosstabResult extends StatResult {
  rows: string[];
  columns: string[];
  row_labels: string[];
  column_labels: string[];
  counts: Array<number[] | null>;
  row_percentages: Array<number[] | null>;
  n: number;
  chi2: number | null;
  df: number | null;
  p_value: number | null;
  cramers_v: number | null;
  min_expected: number | null;
  masked_rows: number[];
}

export interface QuestionStatsPage {
  n: number;
  segment: string | null;
  questions: QuestionStats[];
}

/** One row of the results hub: collection status only (no answers). */
export interface ProjectResultsStatus {
  id: string;
  title: string;
  measurement_type: MeasurementType | null;
  status: ProjectStatus;
  is_demo: boolean;
  evidence_level: EvidenceLevel | null;
  published_surveys: number;
  responses_total: number;
  responses_included: number;
  last_response_at: string | null;
  waves: WaveType[];
}

// ------------------------------------------------------- store connections
export type StorePlatform = "SALLA" | "ZID" | "SHOPIFY" | "WOOCOMMERCE" | "CUSTOM";
export type StoreTrigger = "FULFILLED" | "DELIVERED";
export type InvitationDelivery = "LINK" | "EMAIL";
export type InvitationStatus =
  "READY" | "SCHEDULED" | "SENT" | "OPENED" | "RESPONDED" | "EXPIRED" | "CANCELLED" | "OPTED_OUT";
export type StoreEventStatus = "ACCEPTED" | "DUPLICATE" | "IGNORED" | "REJECTED";

export interface StoreConnectionStats {
  invitations: number;
  sent: number;
  opened: number;
  responded: number;
  pending_email: number;
  response_rate: number | null;
}

export interface StoreConnection {
  id: string;
  project_id: string;
  platform: StorePlatform;
  name: string;
  store_url: string | null;
  status: "ACTIVE" | "PAUSED";
  store_survey_id: string | null;
  product_survey_id: string | null;
  trigger: StoreTrigger;
  delivery: InvitationDelivery;
  delay_days: number;
  max_products: number;
  min_days_between: number;
  webhook_url: string;
  auth_username: string | null;
  secret_hint: string;
  last_event_at: string | null;
  events_received: number;
  events_rejected: number;
  created_at: string;
  stats: StoreConnectionStats;
}

/** Returned by create / rotate only: the secret is shown once. */
export interface StoreConnectionCreated extends StoreConnection {
  secret: string | null;
}

export interface StoreConnectionInput {
  platform: StorePlatform;
  name: string;
  store_url?: string | null;
  store_survey_id?: string | null;
  product_survey_id?: string | null;
  trigger?: StoreTrigger;
  delivery?: InvitationDelivery;
  delay_days?: number;
  max_products?: number;
  min_days_between?: number;
  secret?: string | null;
}

export type StoreConnectionPatch = Partial<Omit<StoreConnectionInput, "platform" | "secret">> & {
  status?: "ACTIVE" | "PAUSED";
};

export interface StoreEvent {
  id: string;
  created_at: string;
  event: string;
  status: StoreEventStatus;
  reason: string;
  items: number;
  invitations_created: number;
  is_test: boolean;
}

export interface StoreInvitation {
  id: string;
  survey_id: string;
  status: InvitationStatus;
  product: string | null;
  url: string;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  responded_at: string | null;
  expires_at: string;
  is_test: boolean;
}

export interface StoreOrderResult {
  status: string;
  reason: string;
  invitations: Array<{ url: string; product: string | null }>;
}

export interface IntegrationsCapabilities {
  email_delivery: boolean;
  webhook_base_url: string;
}

// ------------------------------------------------------- customer experience (CX.md)
export type LocationKind = "BRANCH" | "KIOSK" | "COUNTER" | "EVENT" | "OTHER";

/** A branch, kiosk or service point: its code tags every answer collected there (`?loc=`). */
export interface StoreLocation {
  id: string;
  code: string;
  name: string;
  city: string;
  kind: LocationKind;
  is_active: boolean;
  created_at: string;
}

export interface StoreLocationInput {
  name: string;
  city?: string;
  kind?: LocationKind;
  /** Optional; generated (B01, B02…) when empty. */
  code?: string;
}

export type StoreLocationPatch = Partial<Omit<StoreLocationInput, "code">> & { is_active?: boolean };

/** A score hidden below the k-anonymity threshold carries only its count. */
export interface CxMasked {
  masked: true;
  n: number;
}

export interface CxNps {
  masked?: false;
  /** −100…100. */
  score: number;
  /** Shares of respondents, 0–100. */
  promoters: number;
  passives: number;
  detractors: number;
  n: number;
  ci_low: number;
  ci_high: number;
  /** n ≥ 10: below that the score is shown but flagged as unstable. */
  suitable: boolean;
}

/** CSAT (share answering 4–5 of 5) or CES (share answering 5–7 of 7, "easy"). */
export interface CxShare {
  masked?: false;
  pct: number;
  mean: number;
  n: number;
}

export interface CxTrio {
  n: number;
  nps?: CxNps | CxMasked;
  csat?: CxShare | CxMasked;
  ces?: CxShare | CxMasked;
}

export interface CxLocationRow extends CxTrio {
  id: string;
  name: string;
}

export interface CxWeek extends CxTrio {
  /** Monday of the ISO week (YYYY-MM-DD). */
  week: string;
}

export type CxQuadrant = "fix" | "keep" | "maintain" | "monitor";

export interface CxDriver {
  key: string;
  text: string;
  n: number;
  masked: boolean;
  pairs?: number;
  /** Mean on a 0–100 scale. */
  performance?: number;
  mean?: number;
  /** Spearman correlation with the outcome; null below `min_pairs` answers. */
  importance?: number | null;
  p_value?: number | null;
  quadrant?: CxQuadrant;
}

export interface CxDashboard {
  has_cx: boolean;
  overall: CxTrio;
  locations: CxLocationRow[];
  channels: Partial<Record<"branch" | "online" | "other", CxTrio>>;
  weekly: CxWeek[];
  drivers: {
    outcome: { key: string; text: string; type: QuestionType; min: number; max: number } | null;
    items: CxDriver[];
    min_pairs?: number;
  };
  cases: {
    open: number;
    overdue: number;
    resolved: number;
    within_sla_pct: number | null;
    median_hours: number | null;
  };
  k_anonymity: number;
}

export type CxCaseReason = "DETRACTOR" | "LOW_SATISFACTION" | "HIGH_EFFORT";
export type CxCaseStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type CxCaseFilter = "open" | "resolved" | "all";

/** A follow-up opened by a low score (closed loop). */
export interface CxCase {
  id: string;
  reason: CxCaseReason;
  score: number;
  score_type: "NPS" | "CSAT" | "CES";
  status: CxCaseStatus;
  contact_requested: boolean;
  /** The customer left a way to reach them (erased once the case is resolved). */
  has_contact: boolean;
  location: string | null;
  assigned_to: string | null;
  assigned_to_id: string | null;
  due_at: string;
  overdue: boolean;
  resolved_at: string | null;
  resolution_note: string;
  /** What the customer wrote; only for roles that may read individual answers. */
  comment: string | null;
  created_at: string;
  response_id: string;
}

export interface CxCasePatch {
  status?: CxCaseStatus;
  assign_to_me?: boolean;
  resolution_note?: string | null;
}

// ------------------------------------------------------------ intelligence (Phase 6)
export type SentimentLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";
export type ThemeCategory = "TOPIC" | "PAIN_POINT" | "STRENGTH" | "SUGGESTION";

export interface TextTheme {
  id: string;
  key: string;
  name: string;
  description: string;
  category: ThemeCategory;
  sentiment: SentimentLabel;
  keywords: string[];
  count: number;
  share: number;
  /** Only for roles allowed to read raw answers. */
  samples?: string[];
}

export interface TextQuestionAnalysis {
  question_key: string;
  question_text: string;
  answers: number;
  masked: boolean;
  analyzed_at: string | null;
  answers_analyzed: number;
  parts: Record<string, { ok: boolean; error?: string; rated?: number; themes?: number }>;
  keywords: Array<{ term: string; answers: number }>;
  sentiment: {
    rated: number;
    counts: Record<SentimentLabel, number>;
    pct: Record<SentimentLabel, number>;
  } | null;
  themes: TextTheme[];
}

export type InsightKind =
  | "STRENGTH"
  | "WEAKNESS"
  | "IMPROVEMENT"
  | "DECLINE"
  | "PERSISTENCE"
  | "RISK"
  | "SUCCESS"
  | "GAP"
  | "ATTENTION"
  | "PAIN_POINT"
  | "DATA_QUALITY"
  | "SAMPLE";
export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH";
export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";
export type InsightStatus = "NEW" | "PINNED" | "DISMISSED";

export interface InsightEvidence {
  metric: string;
  value?: number | null;
  unit?: string;
  n?: number | null;
  wave?: string | null;
  from_wave?: string;
  to_wave?: string;
  from_value?: number | null;
  to_value?: number | null;
  change?: number | null;
  p_value?: number | null;
  effect_size?: number | null;
  effect_label?: string | null;
  test?: string;
  paired?: boolean;
  dimension_id?: string;
  dimension?: string;
  indicator_code?: string;
  indicator?: string;
  target?: number | null;
  status?: string;
  question_key?: string;
  question?: string;
  segment?: string;
  segment_question?: string;
  theme?: string;
  count?: number;
  data_range?: { from: string; to: string };
  filters?: { include_flagged: boolean };
  [key: string]: unknown;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  severity: Severity;
  confidence: ConfidenceLevel;
  evidence: InsightEvidence;
  status: InsightStatus;
  current: boolean;
  created_at: string;
  updated_at: string;
}

export type RecommendationStatus = "PROPOSED" | "ACCEPTED" | "IN_PROGRESS" | "DONE" | "DISMISSED";
export type PriorityLevel = "HIGH" | "MEDIUM" | "LOW";

export interface Recommendation {
  id: string;
  insight_ids: string[];
  problem: string;
  recommendation: string;
  possible_cause: string;
  expected_outcome: string;
  priority: PriorityLevel;
  confidence: ConfidenceLevel;
  owner: string;
  timeframe: string;
  due_on: string | null;
  status: RecommendationStatus;
  source: "AI" | "MANUAL";
  created_at: string;
}

export interface RecommendationInput {
  recommendation: string;
  problem?: string;
  possible_cause?: string;
  expected_outcome?: string;
  priority?: PriorityLevel;
  owner?: string;
  timeframe?: string;
  due_on?: string | null;
  insight_ids?: string[];
}

export interface PackFact {
  id: string;
  label: string;
  value: string;
  n: number | null;
  ref: Record<string, unknown>;
}

export interface AnalystAnswer {
  answer: string;
  evidence: PackFact[];
  follow_ups: string[];
}

// ----------------------------------------------------------------- reports (Phase 7)
export type ReportType = "EXECUTIVE" | "DETAILED" | "IMPACT" | "MANAGEMENT" | "ACADEMIC";
export type ReportTone = "FORMAL" | "PLAIN" | "ANALYTICAL";
export type ReportSectionSource = "AI" | "RULE" | "USER";

interface ReportSectionBase {
  key: string;
  title: string;
  hidden: boolean;
}

export interface ReportNarrativeSection extends ReportSectionBase {
  kind: "narrative";
  paragraphs: string[];
  bullets: string[];
  evidence_ids: string[];
  source: ReportSectionSource;
}

export interface ReportKpisSection extends ReportSectionBase {
  kind: "kpis";
  items: Array<{ label: string; value: string; note: string }>;
}

export interface ReportDefinitionsSection extends ReportSectionBase {
  kind: "definitions";
  items: Array<{ label: string; value: string }>;
  paragraphs: string[];
}

export interface ReportTableSection extends ReportSectionBase {
  kind: "table";
  columns: string[];
  rows: string[][];
  note?: string;
  /** Index of a column holding indicator statuses (rendered with icon + label). */
  status_column?: number;
  statuses?: IndicatorStatus[];
}

export interface ReportBarsSection extends ReportSectionBase {
  kind: "bars";
  series: Array<{ key: string; label: string }>;
  rows: Array<{ label: string; values: Array<number | null> }>;
  max: number;
  note?: string;
}

export interface ReportInsightsSection extends ReportSectionBase {
  kind: "insights";
  items: Array<{
    kind: InsightKind;
    label: string;
    severity: Severity;
    severity_label: string;
    title: string;
    body: string;
  }>;
}

export interface ReportRecommendationsSection extends ReportSectionBase {
  kind: "recommendations";
  items: Array<{
    recommendation: string;
    problem: string;
    possible_cause: string;
    expected_outcome: string;
    priority: PriorityLevel;
    priority_label: string;
    status: RecommendationStatus;
    status_label: string;
    owner: string;
    timeframe: string;
  }>;
}

export interface ReportFactsSection extends ReportSectionBase {
  kind: "facts";
  items: Array<{ id: string; label: string; value: string; n: number | null }>;
}

export type ReportSection =
  | ReportNarrativeSection
  | ReportKpisSection
  | ReportDefinitionsSection
  | ReportTableSection
  | ReportBarsSection
  | ReportInsightsSection
  | ReportRecommendationsSection
  | ReportFactsSection;

export interface ReportContent {
  schema: number;
  title: string;
  type_label: string;
  project_title: string;
  organization: string;
  language: "ar" | "en";
  tone: ReportTone;
  audience: string;
  generated_at: string;
  data_range: { from: string; to: string } | null;
  evidence_level: string;
  evidence_label: string;
  caveat: string;
  ai: { requested: boolean; used: boolean; error: string | null; rejected: string[] };
  sections: ReportSection[];
}

export interface ReportSummary {
  id: string;
  project_id: string;
  project_title: string;
  report_type: ReportType;
  tone: ReportTone;
  language: string;
  title: string;
  audience: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface Report extends ReportSummary {
  version: {
    version_number: number;
    reason: "generated" | "refreshed" | "edited";
    created_at: string;
    content: ReportContent;
  };
}

export interface ReportVersionMeta {
  version_number: number;
  reason: "generated" | "refreshed" | "edited";
  created_at: string;
  created_by: string | null;
  ai_used: boolean;
  data_generated_at: string | null;
  responses: number | null;
}

export interface ReportCreateInput {
  report_type: ReportType;
  tone?: ReportTone;
  language?: "ar" | "en" | null;
  title?: string;
  audience?: string;
  use_ai?: boolean;
}

export interface ReportEditInput {
  title?: string;
  sections?: Array<{ key: string; hidden?: boolean; paragraphs?: string[]; bullets?: string[] }>;
}

// ------------------------------------------------- impact & library (Phase 8)
export interface IndicatorWaveValue {
  indicator_id: string;
  wave: string;
  value: number | null;
  n: number;
  reason: string | null;
  computed_at: string;
}

export interface TocOutcome {
  text: string;
  indicator_ids: string[];
}

export interface TheoryOfChange {
  inputs: string[];
  activities: string[];
  outputs: string[];
  short_term_outcomes: TocOutcome[];
  medium_term_outcomes: TocOutcome[];
  long_term_impact: TocOutcome[];
  assumptions: string[];
  risks: string[];
  ai_generated?: boolean;
  updated_at?: string;
}

export interface TocIndicator {
  id: string;
  code: string;
  name: string;
  dimension: string | null;
  indicator_type: IndicatorType;
  unit: string;
  direction: IndicatorDirection;
  baseline_value: number | null;
  current_value: number | null;
  target_value: number | null;
  target_label: string;
  status: IndicatorStatus;
  last_computed_at: string | null;
}

export interface TheoryOfChangeView {
  theory: TheoryOfChange | null;
  indicators: TocIndicator[];
  evidence_level: EvidenceLevel;
  caveat: string;
}

export interface TemplateSummary {
  code: string;
  category: string;
  sector: string;
  icon: string;
  name: string;
  description: string;
  language: "ar" | "en";
  measurement_type: MeasurementType;
  design: MeasurementDesign;
  waves: string[];
  dimensions: string[];
  indicators: number;
  questions: number;
  minutes: number;
}

export interface TemplateDetail extends TemplateSummary {
  purpose: string;
  target_population: string;
  objectives: string[];
  dimension_details: Array<{ name: string; description: string }>;
  indicator_details: Array<{ code: string; name: string; target: string }>;
  surveys: Array<{
    wave_type: WaveType;
    wave_name: string;
    title: string;
    sections: Array<{ title: string; questions: Array<{ text: string; type: QuestionType }> }>;
  }>;
}

export interface BankItem {
  id: string;
  source: "system" | "organization";
  question_type: QuestionType;
  text: string;
  topic: string;
  language: string;
  tags: string[];
  question: Record<string, unknown>;
  template: string | null;
  created_at?: string | null;
}
