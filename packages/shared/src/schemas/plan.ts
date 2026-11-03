/**
 * Zod mirror of meqyas_ai.schemas.plan (ArchitectOutput / MeasurementPlanDraft).
 * The server re-validates and re-applies deterministic rules on every edit.
 */
import { z } from "zod";

import {
  EVIDENCE_LEVELS,
  INDICATOR_DIRECTIONS,
  INDICATOR_FREQUENCIES,
  INDICATOR_TYPES,
  MEASUREMENT_DESIGNS,
  MEASUREMENT_TYPES,
  OUTCOME_LEVELS,
  WAVE_TYPES,
} from "../enums";

export const planObjectiveSchema = z.object({
  key: z.string().max(40),
  title: z.string().trim().min(2).max(300),
  description: z.string().max(1000).default(""),
});

export const planDimensionSchema = z.object({
  key: z.string().max(40),
  name: z.string().trim().min(2).max(120),
  description: z.string().max(600).default(""),
  objective_key: z.string().max(40).nullable().default(null),
});

export const planIndicatorSchema = z.object({
  code: z.string().max(40),
  name: z.string().trim().min(2).max(200),
  description: z.string().max(600).default(""),
  dimension_key: z.string().max(40),
  indicator_type: z.enum(INDICATOR_TYPES),
  unit: z.string().max(40).default(""),
  target: z.string().max(120).default(""),
  target_value: z.number().nullable().default(null),
  formula: z.string().max(300).default(""),
  frequency: z.enum(INDICATOR_FREQUENCIES).default("PER_WAVE"),
  direction: z.enum(INDICATOR_DIRECTIONS).default("HIGHER_IS_BETTER"),
});

export const planWaveSchema = z.object({
  wave_type: z.enum(WAVE_TYPES),
  name: z.string().max(120),
  timing: z.string().max(200).default(""),
  offset_days: z.number().int().nullable().default(null),
});

export const architectOutputSchema = z.object({
  project_title: z.string().trim().min(2).max(120),
  measurement_type: z.enum(MEASUREMENT_TYPES),
  secondary_types: z.array(z.enum(MEASUREMENT_TYPES)).max(3).default([]),
  target_population: z.string().trim().min(2).max(200),
  purpose: z.string().trim().min(2).max(600),
  understanding_summary: z.string().max(600),
  measurement_type_rationale: z.string().max(1000),
  objectives: z.array(planObjectiveSchema).min(1).max(6),
  dimensions: z.array(planDimensionSchema).min(2).max(8),
  indicators: z.array(planIndicatorSchema).min(1).max(16),
  recommended_design: z.enum(MEASUREMENT_DESIGNS),
  design_rationale: z.string().max(1000),
  waves: z.array(planWaveSchema).min(1).max(5),
  baseline_required: z.boolean(),
  post_measurement_required: z.boolean(),
  follow_up_recommended: z.boolean(),
  follow_up_days: z.number().int().nullable().default(null),
  recommended_questions_count: z.number().int(),
  estimated_completion_minutes: z.number().int(),
  methodology_notes: z.array(z.string().max(500)).max(8).default([]),
  clarifying_questions: z.array(z.string().max(300)).max(3).default([]),
});

export const measurementPlanDraftSchema = architectOutputSchema.extend({
  language: z.enum(["ar", "en"]).default("ar"),
  evidence_level: z.enum(EVIDENCE_LEVELS),
  outcome_level: z.enum(OUTCOME_LEVELS),
  rules_applied: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type PlanObjective = z.infer<typeof planObjectiveSchema>;
export type PlanDimension = z.infer<typeof planDimensionSchema>;
export type PlanIndicator = z.infer<typeof planIndicatorSchema>;
export type PlanWave = z.infer<typeof planWaveSchema>;
export type ArchitectOutput = z.infer<typeof architectOutputSchema>;
export type MeasurementPlanDraft = z.infer<typeof measurementPlanDraftSchema>;

/** Validation for the "ماذا تريد أن تقيس؟" composer (same bounds as the API). */
export const architectRequestSchema = z.object({
  request: z.string().trim().min(8).max(2000),
  language: z.enum(["ar", "en"]).optional(),
  audience_hint: z.string().max(200).optional(),
});
export type ArchitectRequest = z.infer<typeof architectRequestSchema>;
