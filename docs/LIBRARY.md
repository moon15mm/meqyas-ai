# Library: templates and question bank (Phase 8)

## 1. Measurement templates

Six curated templates ship with the platform (`apps/api/app/domain/library/templates.py`):

| Code | Template | Design | Waves |
|---|---|---|---|
| `training_impact` | تقييم أثر برنامج تدريبي | PRE_POST_FOLLOW_UP | Baseline · Post · Follow-up (60 days) |
| `customer_satisfaction` | رضا العملاء عن الخدمة | REPEATED | Rounds (quarterly) |
| `event_evaluation` | تقييم فعالية أو مؤتمر | POST_ONLY | After the event |
| `employee_pulse` | نبض الموظفين | REPEATED | Rounds (quarterly) |
| `course_feedback` | رضا الطلاب عن مقرر دراسي | POST_ONLY | End of term |
| `needs_assessment` | تحليل الاحتياجات التدريبية | POST_ONLY | Before program design |

Each template is a plan blueprint (the Measurement Architect's output schema: objectives, dimensions,
indicators, design, waves, methodology notes) plus the questionnaire of each wave type. All wording is
original — no published or licensed instrument is copied.

**Using a template** (`POST /templates/{code}/use`) creates a plan **draft** without any model call: the
blueprint goes through the same deterministic methodology rules as an AI plan (`plan_rules.apply_rules`:
evidence level, outcome level, design flags, an indicator for every dimension, causality notes). The user
reviews, edits or improves it with AI on the usual plan page, then accepts it.

**On accept**, one draft survey per wave type is created from the template (later rounds of a repeated
design are made with "copy survey to another wave"). Questions are linked to the project's dimensions by
key and to indicators by code; indicators the methodology rules added (not measured explicitly by the
template) are linked to the questions of their dimension. Questions repeated across waves keep the same
key, so pre/post/follow-up comparisons match items and respondents.

The plan keeps `source_prompt = "template:<code>"` internally; the API shows "قالب: <name>", and "improve
with AI" sends the template's description and purpose as the request.

## 2. Question bank

- **System items**: every question of the templates, de-duplicated by text, with its topic (the dimension
  name) and the template it comes from — 64 items, defined in code.
- **Organization items** (`question_bank` table): questions an organization saved from the survey builder
  ("حفظ في المكتبة"). Stored without key, lineage or project links; only answerable types with text.

Search folds Arabic spelling variants (alef forms, ta marbuta, ya) over the text, topic and tags; filters by
type and source (`system | organization | all`). In the builder, "من مكتبة الأسئلة" inserts a copy into the
selected section with a fresh key and lineage id and no dimension/indicator link (the user links it).

Permissions: reading needs `project.read`; saving and deleting need `survey.edit`; an organization can only
delete its own items.
