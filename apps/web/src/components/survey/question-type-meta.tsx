import type { QuestionType, SurveyStatus } from "@meqyas/shared";
import { Badge } from "@meqyas/ui";
import {
  AlignLeftIcon,
  ArrowDownUpIcon,
  CalendarIcon,
  CheckSquareIcon,
  ChevronDownSquareIcon,
  CircleDotIcon,
  FileUpIcon,
  GaugeIcon,
  Grid3x3Icon,
  HashIcon,
  HeadingIcon,
  InfoIcon,
  type LucideIcon,
  ScaleIcon,
  SlidersHorizontalIcon,
  SmileIcon,
  StarIcon,
  TextCursorInputIcon,
  ThumbsUpIcon,
  TimerIcon,
  TrendingUpIcon,
} from "lucide-react";

export const QUESTION_ICONS: Record<QuestionType, LucideIcon> = {
  SHORT_TEXT: TextCursorInputIcon,
  LONG_TEXT: AlignLeftIcon,
  SINGLE_CHOICE: CircleDotIcon,
  MULTIPLE_CHOICE: CheckSquareIcon,
  DROPDOWN: ChevronDownSquareIcon,
  RATING: GaugeIcon,
  STAR: StarIcon,
  LIKERT: ScaleIcon,
  MATRIX: Grid3x3Icon,
  RANKING: ArrowDownUpIcon,
  SLIDER: SlidersHorizontalIcon,
  NPS: TrendingUpIcon,
  CSAT: SmileIcon,
  CES: ThumbsUpIcon,
  NUMBER: HashIcon,
  DATE: CalendarIcon,
  FILE: FileUpIcon,
  INFORMATION: InfoIcon,
  SECTION: HeadingIcon,
};

export const STATUS_VARIANT: Record<SurveyStatus, "soft" | "success" | "warning" | "secondary" | "outline"> =
  {
    DRAFT: "secondary",
    PUBLISHED: "success",
    PAUSED: "warning",
    CLOSED: "outline",
    ARCHIVED: "outline",
  };

export function SurveyStatusBadge({ status, label }: { status: SurveyStatus; label: string }) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}

export { TimerIcon };
