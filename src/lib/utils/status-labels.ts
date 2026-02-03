/**
 * Centralized display labels for discharge readiness status.
 *
 * Internal enum values (ready, caution, not_ready) remain unchanged
 * throughout the codebase. This module maps them to user-facing text
 * for clinical display, printed plans, and tooltips.
 *
 * Rationale: "NOT READY" / "READY FOR DISCHARGE" language was flagged
 * as problematic for clinical use — if a clinician prints the assessment
 * and it says "NOT READY" but they've decided to discharge, it can
 * undermine patient confidence and make the clinician look wrong.
 * This tool is decision SUPPORT, not a decision MAKER.
 */

export type DischargeStatus = "ready" | "caution" | "not_ready";

/** Primary label shown in the gauge and headers */
export function getStatusDisplayLabel(status: DischargeStatus): string {
  switch (status) {
    case "ready":
      return "TRANSITION READY";
    case "caution":
      return "REVIEW RECOMMENDED";
    case "not_ready":
      return "NEEDS FURTHER REVIEW";
    default:
      return "ANALYZING...";
  }
}

/** Short legend labels for the score interpretation bar */
export function getStatusLegendLabel(status: DischargeStatus): string {
  switch (status) {
    case "ready":
      return "On Track";
    case "caution":
      return "Review Items";
    case "not_ready":
      return "Needs Review";
    default:
      return "";
  }
}

/** Tooltip explanations for the legend */
export function getStatusTooltip(status: DischargeStatus): string {
  switch (status) {
    case "ready":
      return "Patient appears on track for transition. Standard discharge process can proceed.";
    case "caution":
      return "Some concerns identified. Review flagged items and consider additional interventions before transition.";
    case "not_ready":
      return "Significant concerns identified. Review all flagged risk factors with care team before transition.";
    default:
      return "";
  }
}

/** Narrative status text for orchestrator/API messages */
export function getStatusNarrative(status: DischargeStatus): string {
  switch (status) {
    case "ready":
      return "Assessment indicates patient is on track for transition";
    case "caution":
      return "Assessment identified items for review before transition";
    case "not_ready":
      return "Assessment identified significant concerns requiring further review";
    default:
      return "Assessment in progress";
  }
}
