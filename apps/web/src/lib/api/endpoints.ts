import type {
  AccountMessage,
  ActivationPreview,
  BulkResult,
  LimitOverrides,
  MemberAdded,
  SubscriberCreateInput,
  SubscriberDetail,
  SubscriberFilter,
  SubscriberItem,
  SubscriberPage,
  SubscriptionPlan,
  SubscriptionPlanInput,
  AnalyticsSummary,
  CrosstabResult,
  CxCase,
  CxCaseFilter,
  CxCasePatch,
  CxDashboard,
  Gift,
  GiftInput,
  GiftMessage,
  GiftPreview,
  StoreLocation,
  StoreLocationInput,
  StoreLocationPatch,
  QuestionStats,
  QuestionStatsPage,
  ProjectResultsStatus,
  IntegrationsCapabilities,
  InvitationStatus,
  StoreConnection,
  TemplateDetail,
  TemplateSummary,
  TheoryOfChange,
  TheoryOfChangeView,
  StoreConnectionCreated,
  StoreConnectionInput,
  StoreConnectionPatch,
  StoreEvent,
  StoreInvitation,
  StoreOrderResult,
  AnalystAnswer,
  Insight,
  InsightStatus,
  PackFact,
  Recommendation,
  RecommendationInput,
  BankItem,
  IndicatorWaveValue,
  Report,
  ReportCreateInput,
  ReportEditInput,
  ReportSummary,
  ReportTone,
  ReportVersionMeta,
  TextQuestionAnalysis,
  WaveComparison,
  PublicSurvey,
  QualityStatus,
  ResponseDetail,
  ResponsePage,
  ReviewStatus,
  AIStatus,
  AIUsage,
  ArchitectOutput,
  ArchitectRequest,
  Dimension,
  Indicator,
  Me,
  MeasurementPlan,
  Member,
  Objective,
  Organization,
  Page,
  Project,
  ProjectOverview,
  ProjectPlan,
  ProjectType,
  Role,
  Sector,
  SurveyAction,
  SurveyDetail,
  SurveyDoc,
  SurveyMeta,
  TokenResponse,
  User,
  Wave,
} from "@meqyas/shared";

import { api, apiBlob, authRequest } from "./client";

export const authApi = {
  login: (email: string, password: string) => authRequest<TokenResponse>("/auth/login", { email, password }),
  logout: () => authRequest<{ ok: boolean }>("/auth/logout"),
  forgotPassword: (email: string) => authRequest<{ ok: boolean }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    authRequest<{ ok: boolean }>("/auth/reset-password", { token, password }),
  /** A new account's activation link (SUBSCRIPTIONS.md §4): what it opens, then choose a password. */
  activationPreview: (token: string) =>
    api<ActivationPreview>(`/auth/activation/${encodeURIComponent(token)}`, { auth: false, scoped: false }),
  activate: (token: string, password: string, fullName?: string) =>
    authRequest<TokenResponse>("/auth/activate", {
      token,
      password,
      ...(fullName ? { full_name: fullName } : {}),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: { current_password: currentPassword, new_password: newPassword },
      scoped: false,
    }),
  me: () => api<Me>("/auth/me", { scoped: false }),
  updateMe: (data: Partial<Pick<User, "full_name" | "locale">>) =>
    api<User>("/auth/me", { method: "PATCH", body: data, scoped: false }),
};

export const orgApi = {
  list: () => api<Organization[]>("/organizations", { scoped: false }),
  get: (id: string) => api<Organization>(`/organizations/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api<Organization>(`/organizations/${id}`, { method: "PATCH", body: data }),
  members: (id: string) => api<Member[]>(`/organizations/${id}/members`),
  addMember: (id: string, data: { email: string; role: Role; full_name?: string; send_email?: boolean }) =>
    api<MemberAdded>(`/organizations/${id}/members`, { method: "POST", body: data }),
  /** A new activation link or a recovery link (accounts of this workspace only). */
  memberAccessLink: (id: string, memberId: string, sendEmail: boolean) =>
    api<AccountMessage>(`/organizations/${id}/members/${memberId}/access-link`, {
      method: "POST",
      body: { send_email: sendEmail },
    }),
  updateMember: (id: string, memberId: string, role: Role) =>
    api<Member>(`/organizations/${id}/members/${memberId}`, { method: "PATCH", body: { role } }),
  removeMember: (id: string, memberId: string) =>
    api<{ ok: boolean }>(`/organizations/${id}/members/${memberId}`, { method: "DELETE" }),
};

export interface ProjectCreateInput {
  title: string;
  description?: string;
  measurement_type: Project["measurement_type"];
  target_population?: string;
}

export const projectApi = {
  types: () => api<ProjectType[]>("/project-types", { scoped: false }),
  list: (params: { q?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    qs.set("limit", String(params.limit ?? 50));
    return api<Page<Project>>(`/projects?${qs.toString()}`);
  },
  create: (data: ProjectCreateInput) => api<Project>("/projects", { method: "POST", body: data }),
  get: (id: string) => api<Project>(`/projects/${id}`),
  update: (id: string, data: Partial<Project>) =>
    api<Project>(`/projects/${id}`, { method: "PATCH", body: data }),
  remove: (id: string) => api<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  overview: (id: string) => api<ProjectOverview>(`/projects/${id}/overview`),
  plan: (id: string) => api<ProjectPlan>(`/projects/${id}/measurement-plan`),
  createObjective: (projectId: string, data: Pick<Objective, "title"> & { description?: string }) =>
    api<Objective>(`/projects/${projectId}/objectives`, { method: "POST", body: data }),
  updateObjective: (id: string, data: Partial<Objective>) =>
    api<Objective>(`/objectives/${id}`, { method: "PATCH", body: data }),
  deleteObjective: (id: string) => api<{ ok: boolean }>(`/objectives/${id}`, { method: "DELETE" }),
  createDimension: (
    projectId: string,
    data: { name: string; description?: string; objective_id?: string | null },
  ) => api<Dimension>(`/projects/${projectId}/dimensions`, { method: "POST", body: data }),
  updateDimension: (id: string, data: Partial<Dimension>) =>
    api<Dimension>(`/dimensions/${id}`, { method: "PATCH", body: data }),
  deleteDimension: (id: string) => api<{ ok: boolean }>(`/dimensions/${id}`, { method: "DELETE" }),
  createIndicator: (projectId: string, data: Partial<Indicator> & { name: string }) =>
    api<Indicator>(`/projects/${projectId}/indicators`, { method: "POST", body: data }),
  updateIndicator: (id: string, data: Partial<Indicator>) =>
    api<Indicator>(`/indicators/${id}`, { method: "PATCH", body: data }),
  deleteIndicator: (id: string) => api<{ ok: boolean }>(`/indicators/${id}`, { method: "DELETE" }),
  updateWave: (id: string, data: Partial<Wave>) => api<Wave>(`/waves/${id}`, { method: "PATCH", body: data }),
};

export const planApi = {
  architect: (data: ArchitectRequest, signal?: AbortSignal) =>
    api<MeasurementPlan>("/ai/measurement-architect", { method: "POST", body: data, signal }),
  get: (id: string) => api<MeasurementPlan>(`/measurement-plans/${id}`),
  update: (id: string, draft: ArchitectOutput) =>
    api<MeasurementPlan>(`/measurement-plans/${id}`, { method: "PATCH", body: draft }),
  regenerate: (id: string, feedback: string) =>
    api<MeasurementPlan>(`/measurement-plans/${id}/regenerate`, { method: "POST", body: { feedback } }),
  accept: (id: string) => api<Project>(`/measurement-plans/${id}/accept`, { method: "POST" }),
};

export const aiApi = {
  status: (check = false) => api<AIStatus>(`/ai/status${check ? "?check=true" : ""}`, { scoped: false }),
  usage: () => api<AIUsage>("/ai/usage"),
};

export interface SurveyGenerateInput {
  wave_id?: string | null;
  question_count?: number | null;
  include_open_questions?: boolean;
  include_profile_questions?: boolean;
  extra_instructions?: string | null;
}

export const surveyApi = {
  list: (params: { project_id?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set("project_id", params.project_id);
    if (params.status) qs.set("status", params.status);
    const query = qs.toString();
    return api<SurveyMeta[]>(`/surveys${query ? `?${query}` : ""}`);
  },
  forProject: (projectId: string) => api<SurveyMeta[]>(`/projects/${projectId}/surveys`),
  create: (projectId: string, data: { title: string; wave_id?: string | null }) =>
    api<SurveyDetail>(`/projects/${projectId}/surveys`, { method: "POST", body: data }),
  generate: (projectId: string, data: SurveyGenerateInput, signal?: AbortSignal) =>
    api<SurveyDetail>(`/projects/${projectId}/surveys/generate`, { method: "POST", body: data, signal }),
  get: (id: string) => api<SurveyDetail>(`/surveys/${id}`),
  update: (id: string, data: { title?: string; description?: string; wave_id?: string | null }) =>
    api<SurveyDetail>(`/surveys/${id}`, { method: "PATCH", body: data }),
  saveDraft: (id: string, doc: SurveyDoc) =>
    api<SurveyDetail>(`/surveys/${id}/draft`, { method: "PUT", body: { doc } }),
  action: (id: string, action: SurveyAction) =>
    api<SurveyDetail>(`/surveys/${id}/${action}`, { method: "POST" }),
  review: (id: string) => api<SurveyDetail>(`/surveys/${id}/review`, { method: "POST" }),
  reviewAction: (id: string, issueId: string, action: "accept" | "reject") =>
    api<SurveyDetail>(`/surveys/${id}/review/issues/${issueId}`, { method: "POST", body: { action } }),
  remove: (id: string) => api<{ ok: boolean }>(`/surveys/${id}`, { method: "DELETE" }),
  setCollection: (
    id: string,
    data: { opens_at?: string | null; closes_at?: string | null; response_limit?: number | null },
  ) => api<SurveyDetail>(`/surveys/${id}`, { method: "PATCH", body: data }),
  qr: (id: string, format: "svg" | "png", options: { loc?: string; kiosk?: boolean; scale?: number } = {}) =>
    apiBlob(
      `/surveys/${id}/qr.${format}${query({ loc: options.loc, kiosk: options.kiosk || undefined, scale: options.scale })}`,
    ),
};

export interface ResponseFilters {
  survey_id?: string;
  quality?: QualityStatus;
  review?: ReviewStatus;
  limit?: number;
  offset?: number;
}

function query(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

export const responseApi = {
  forProject: (projectId: string, filters: ResponseFilters = {}) =>
    api<ResponsePage>(`/projects/${projectId}/responses${query(filters)}`),
  get: (id: string) => api<ResponseDetail>(`/responses/${id}`),
  review: (id: string, review_status: ReviewStatus) =>
    api<ResponseDetail>(`/responses/${id}`, { method: "PATCH", body: { review_status } }),
  remove: (id: string) => api<{ ok: boolean }>(`/responses/${id}`, { method: "DELETE" }),
};

export interface SubmissionInput {
  session: string;
  answers: Record<string, unknown>;
  other_texts: Record<string, string>;
  followups: Record<string, string>;
  respondent_code?: string | null;
  respondent_name?: string | null;
  respondent_email?: string | null;
  client_id?: string | null;
  channel?: "LINK" | "QR" | "EMBED" | "KIOSK";
  locale?: string;
  /** Store invitation token from the link (`?inv=`). */
  invitation?: string | null;
  /** Branch / kiosk code from the link (`?loc=`). */
  location?: string | null;
}

/** Respondent endpoints: no auth, no organization header. */
export const publicApi = {
  get: (publicId: string, invitation?: string | null, location?: string | null) =>
    api<PublicSurvey>(
      `/public/surveys/${publicId}${query({ inv: invitation ?? undefined, loc: location ?? undefined })}`,
      {
        auth: false,
        scoped: false,
      },
    ),
  optOut: (publicId: string, invitation: string) =>
    api<{ ok: boolean }>(
      `/public/surveys/${publicId}/invitations/${encodeURIComponent(invitation)}/opt-out`,
      {
        method: "POST",
        auth: false,
        scoped: false,
      },
    ),
  submit: (publicId: string, data: SubmissionInput) =>
    api<{ response_id: string; status: "COMPLETED" }>(`/public/surveys/${publicId}/responses`, {
      method: "POST",
      body: data,
      auth: false,
      scoped: false,
    }),
  followup: (
    publicId: string,
    data: { session: string; question_key: string; answer: unknown; other_text?: string },
    signal?: AbortSignal,
  ) =>
    api<{ ask: boolean; question: string }>(`/public/surveys/${publicId}/followup`, {
      method: "POST",
      body: data,
      auth: false,
      scoped: false,
      signal,
    }),
};

export interface AnalyticsFilters {
  survey_id?: string;
  wave?: string;
  include_flagged?: boolean;
}

export const analyticsApi = {
  portfolio: () => api<{ items: ProjectResultsStatus[] }>("/analytics/projects"),
  summary: (projectId: string, filters: AnalyticsFilters = {}) =>
    api<AnalyticsSummary>(`/projects/${projectId}/analytics/summary${query(filters)}`),
  questions: (projectId: string, filters: AnalyticsFilters & { segment?: string } = {}) =>
    api<QuestionStatsPage>(`/projects/${projectId}/analytics/questions${query(filters)}`),
  question: (projectId: string, key: string, filters: AnalyticsFilters & { segment?: string } = {}) =>
    api<QuestionStats>(
      `/projects/${projectId}/analytics/questions/${encodeURIComponent(key)}${query(filters)}`,
    ),
  compare: (projectId: string, fromWave: string, toWave: string, includeFlagged = false) =>
    api<WaveComparison>(
      `/projects/${projectId}/analytics/compare${query({ from_wave: fromWave, to_wave: toWave, include_flagged: includeFlagged })}`,
    ),
  crosstab: (projectId: string, row: string, col: string, filters: AnalyticsFilters = {}) =>
    api<CrosstabResult>(`/projects/${projectId}/analytics/crosstab${query({ row, col, ...filters })}`),
  exportResponses: (surveyId: string, format: "csv" | "xlsx", includeFlagged = false) =>
    apiBlob(`/surveys/${surveyId}/responses/export.${format}${query({ include_flagged: includeFlagged })}`),
};

/** E-commerce store connections (admins/owners manage; everyone in the project sees status). */
export const storeApi = {
  capabilities: () => api<IntegrationsCapabilities>("/integrations/capabilities"),
  list: (projectId: string) => api<StoreConnection[]>(`/projects/${projectId}/store-connections`),
  create: (projectId: string, data: StoreConnectionInput) =>
    api<StoreConnectionCreated>(`/projects/${projectId}/store-connections`, { method: "POST", body: data }),
  get: (id: string) => api<StoreConnection>(`/store-connections/${id}`),
  update: (id: string, data: StoreConnectionPatch) =>
    api<StoreConnection>(`/store-connections/${id}`, { method: "PATCH", body: data }),
  remove: (id: string) => api<{ ok: boolean }>(`/store-connections/${id}`, { method: "DELETE" }),
  rotateSecret: (id: string, secret?: string | null) =>
    api<StoreConnectionCreated>(`/store-connections/${id}/secret`, {
      method: "POST",
      body: { secret: secret || null },
    }),
  test: (id: string) => api<StoreOrderResult>(`/store-connections/${id}/test`, { method: "POST" }),
  events: (id: string) => api<StoreEvent[]>(`/store-connections/${id}/events`),
  invitations: (id: string, status?: InvitationStatus) =>
    api<StoreInvitation[]>(`/store-connections/${id}/invitations${query({ status })}`),
  surveyFromTemplate: (
    projectId: string,
    template: "store_experience" | "product_feedback" | "store_visit",
    language?: "ar" | "en",
  ) =>
    api<SurveyDetail>(`/projects/${projectId}/surveys/from-template`, {
      method: "POST",
      body: { template, ...(language ? { language } : {}) },
    }),
};

/** Gifts (GIFTS.md): trial accounts sent by platform administrators. */
export const giftApi = {
  list: () => api<Gift[]>("/admin/gifts", { scoped: false }),
  create: (data: GiftInput) =>
    api<GiftMessage>("/admin/gifts", { method: "POST", body: data, scoped: false }),
  resend: (id: string, sendEmail: boolean) =>
    api<GiftMessage>(`/admin/gifts/${id}/resend`, {
      method: "POST",
      body: { send_email: sendEmail },
      scoped: false,
    }),
  revoke: (id: string) => api<Gift>(`/admin/gifts/${id}/revoke`, { method: "POST", scoped: false }),
  preview: (token: string) => api<GiftPreview>(`/gifts/${token}`, { auth: false, scoped: false }),
  claim: (token: string, password: string, fullName?: string) =>
    authRequest<TokenResponse>("/gifts/claim", {
      token,
      password,
      ...(fullName ? { full_name: fullName } : {}),
    }),
};

/** Platform administration (SUBSCRIPTIONS.md §5): subscribers, accounts and plans. */
export const adminApi = {
  subscribers: (params: {
    q?: string;
    state?: SubscriberFilter;
    plan?: string;
    sort?: "created" | "ending" | "name";
    include_demo?: boolean;
    limit?: number;
    offset?: number;
  }) => api<SubscriberPage>(`/admin/subscribers${query(params)}`, { scoped: false }),
  subscriber: (orgId: string) => api<SubscriberDetail>(`/admin/subscribers/${orgId}`, { scoped: false }),
  createSubscriber: (data: SubscriberCreateInput) =>
    api<{ subscriber: SubscriberItem; message: AccountMessage }>("/admin/subscribers", {
      method: "POST",
      body: data,
      scoped: false,
    }),
  bulkCreate: (data: {
    rows: Array<{ name: string; email: string; organization_name?: string }>;
    plan_code: string;
    days: number | null;
    sector: Sector;
    locale: "ar" | "en";
    send_email: boolean;
  }) => api<BulkResult>("/admin/subscribers/bulk", { method: "POST", body: data, scoped: false }),
  updateSubscription: (
    orgId: string,
    data: {
      plan_code?: string;
      overrides?: LimitOverrides;
      period_ends_at?: string | null;
      admin_note?: string;
      organization_name?: string;
    },
  ) => api<SubscriberDetail>(`/admin/subscribers/${orgId}`, { method: "PATCH", body: data, scoped: false }),
  renew: (orgId: string, days: number | null, planCode?: string) =>
    api<SubscriberDetail>(`/admin/subscribers/${orgId}/renew`, {
      method: "POST",
      body: { days, ...(planCode ? { plan_code: planCode } : {}) },
      scoped: false,
    }),
  suspend: (orgId: string, reason: string) =>
    api<SubscriberDetail>(`/admin/subscribers/${orgId}/suspend`, {
      method: "POST",
      body: { reason },
      scoped: false,
    }),
  reactivate: (orgId: string) =>
    api<SubscriberDetail>(`/admin/subscribers/${orgId}/reactivate`, { method: "POST", scoped: false }),
  addMembers: (
    orgId: string,
    members: Array<{ name: string; email: string; role: Role }>,
    sendEmail: boolean,
  ) =>
    api<BulkResult>(`/admin/subscribers/${orgId}/members`, {
      method: "POST",
      body: { members, send_email: sendEmail },
      scoped: false,
    }),
  removeMember: (orgId: string, memberId: string) =>
    api<SubscriberDetail>(`/admin/subscribers/${orgId}/members/${memberId}`, {
      method: "DELETE",
      scoped: false,
    }),
  accessLink: (userId: string, sendEmail: boolean) =>
    api<AccountMessage>(`/admin/users/${userId}/access-link`, {
      method: "POST",
      body: { send_email: sendEmail },
      scoped: false,
    }),
  setUserActive: (userId: string, active: boolean) =>
    api<{ ok: boolean }>(`/admin/users/${userId}/${active ? "enable" : "disable"}`, {
      method: "POST",
      scoped: false,
    }),
  plans: () => api<SubscriptionPlan[]>("/admin/plans", { scoped: false }),
  createPlan: (data: SubscriptionPlanInput & { code: string }) =>
    api<SubscriptionPlan>("/admin/plans", { method: "POST", body: data, scoped: false }),
  updatePlan: (id: string, data: Partial<SubscriptionPlanInput> & { is_archived?: boolean }) =>
    api<SubscriptionPlan>(`/admin/plans/${id}`, { method: "PATCH", body: data, scoped: false }),
};

/** Customer experience: branches & service points, the CX dashboard and follow-up cases. */
export const cxApi = {
  locations: (projectId: string) => api<StoreLocation[]>(`/projects/${projectId}/locations`),
  createLocation: (projectId: string, data: StoreLocationInput) =>
    api<StoreLocation>(`/projects/${projectId}/locations`, { method: "POST", body: data }),
  updateLocation: (id: string, data: StoreLocationPatch) =>
    api<StoreLocation>(`/locations/${id}`, { method: "PATCH", body: data }),
  removeLocation: (id: string) => api<{ ok: boolean }>(`/locations/${id}`, { method: "DELETE" }),
  dashboard: (projectId: string) => api<CxDashboard>(`/projects/${projectId}/cx`),
  cases: (projectId: string, status: CxCaseFilter = "open") =>
    api<CxCase[]>(`/projects/${projectId}/cx/cases${query({ status })}`),
  updateCase: (id: string, data: CxCasePatch) =>
    api<CxCase>(`/cx/cases/${id}`, { method: "PATCH", body: data }),
  revealContact: (id: string) =>
    api<{ phone?: string; email?: string }>(`/cx/cases/${id}/contact`, { method: "POST" }),
};

/** Phase 6: open-answer analysis, insights, recommendations and the AI analyst. */
export const intelligenceApi = {
  textAnalysis: (projectId: string) => api<TextQuestionAnalysis[]>(`/projects/${projectId}/text-analysis`),
  analyzeText: (projectId: string, questionKey: string, useAi = true) =>
    api<TextQuestionAnalysis>(`/projects/${projectId}/text-analysis/${encodeURIComponent(questionKey)}`, {
      method: "POST",
      body: { use_ai: useAi },
    }),
  insights: (projectId: string, includeDismissed = false) =>
    api<Insight[]>(
      `/projects/${projectId}/insights${query({ include_dismissed: includeDismissed || undefined })}`,
    ),
  generateInsights: (projectId: string) =>
    api<Insight[]>(`/projects/${projectId}/insights/generate`, { method: "POST" }),
  setInsightStatus: (id: string, status: InsightStatus) =>
    api<Insight>(`/insights/${id}`, { method: "PATCH", body: { status } }),
  recommendations: (projectId: string) => api<Recommendation[]>(`/projects/${projectId}/recommendations`),
  generateRecommendations: (projectId: string) =>
    api<Recommendation[]>(`/projects/${projectId}/recommendations/generate`, { method: "POST" }),
  createRecommendation: (projectId: string, data: RecommendationInput) =>
    api<Recommendation>(`/projects/${projectId}/recommendations`, { method: "POST", body: data }),
  updateRecommendation: (
    id: string,
    data: Partial<RecommendationInput> & { status?: Recommendation["status"] },
  ) => api<Recommendation>(`/recommendations/${id}`, { method: "PATCH", body: data }),
  deleteRecommendation: (id: string) => api<{ ok: boolean }>(`/recommendations/${id}`, { method: "DELETE" }),
  ask: (
    projectId: string,
    message: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ) =>
    api<AnalystAnswer>(`/projects/${projectId}/analyst/chat`, { method: "POST", body: { message, history } }),
  pack: (projectId: string) =>
    api<{ language: string; evidence_level: string; caveat: string; facts: PackFact[] }>(
      `/projects/${projectId}/analytics/pack`,
    ),
};

export const reportsApi = {
  list: (projectId?: string) => api<ReportSummary[]>(`/reports${query({ project_id: projectId })}`),
  forProject: (projectId: string) => api<ReportSummary[]>(`/projects/${projectId}/reports`),
  create: (projectId: string, data: ReportCreateInput) =>
    api<Report>(`/projects/${projectId}/reports`, { method: "POST", body: data }),
  get: (id: string, version?: number) => api<Report>(`/reports/${id}${query({ version })}`),
  versions: (id: string) => api<ReportVersionMeta[]>(`/reports/${id}/versions`),
  regenerate: (id: string, data: { tone?: ReportTone; audience?: string; use_ai?: boolean }) =>
    api<Report>(`/reports/${id}/regenerate`, { method: "POST", body: data }),
  edit: (id: string, data: ReportEditInput) => api<Report>(`/reports/${id}`, { method: "PATCH", body: data }),
  remove: (id: string) => api<{ ok: boolean }>(`/reports/${id}`, { method: "DELETE" }),
};

export const impactApi = {
  recomputeIndicators: (projectId: string) =>
    api<Indicator[]>(`/projects/${projectId}/indicators/recompute`, { method: "POST" }),
  indicatorValues: (projectId: string) =>
    api<IndicatorWaveValue[]>(`/projects/${projectId}/indicators/values`),
  theory: (projectId: string) => api<TheoryOfChangeView>(`/projects/${projectId}/theory-of-change`),
  saveTheory: (projectId: string, data: TheoryOfChange) =>
    api<TheoryOfChangeView>(`/projects/${projectId}/theory-of-change`, { method: "PUT", body: data }),
  generateTheory: (projectId: string, notes: string) =>
    api<TheoryOfChangeView>(`/projects/${projectId}/theory-of-change/generate`, {
      method: "POST",
      body: { notes },
    }),
  copySurvey: (surveyId: string, data: { wave_id: string | null; title?: string }) =>
    api<SurveyDetail>(`/surveys/${surveyId}/copies`, { method: "POST", body: data }),
};

export const libraryApi = {
  templates: (lang: string) => api<TemplateSummary[]>(`/templates${query({ lang })}`),
  template: (code: string, lang: string) => api<TemplateDetail>(`/templates/${code}${query({ lang })}`),
  useTemplate: (code: string) => api<MeasurementPlan>(`/templates/${code}/use`, { method: "POST" }),
  bank: (params: { q?: string; type?: string; scope?: "all" | "system" | "organization" } = {}) =>
    api<BankItem[]>(`/question-bank${query(params)}`),
  saveToBank: (data: {
    question: Record<string, unknown>;
    topic?: string;
    tags?: string[];
    language?: string;
  }) => api<BankItem>("/question-bank", { method: "POST", body: data }),
  deleteFromBank: (id: string) => api<{ ok: boolean }>(`/question-bank/${id}`, { method: "DELETE" }),
};
