import type { HeatmapCell } from "./types";

/** Which of the two heatmap views a cell is being coloured for. */
export type View = "count" | "verdict";

/**
 * The colour of one heatmap cell.
 *
 * Lives in `lib/` rather than beside the component because it is a pure
 * function returning a CSS string, and because the component moved to the
 * History screen. Its test imported it from the component file, which made 12
 * cases that assert nothing about React break on a file move. See ADR 0003.
 */
export function colorFor(cell: HeatmapCell | undefined, view: View): string {
  if (!cell) return "transparent";

  // At-risk overrides both views. It is the one signal that is about the plan
  // rather than the outcome, and it reads the same wherever you are looking.
  //
  // `risk-mark`, not `risk`. The two are one signal in two roles: `risk` is the
  // warning text and clears 4.5:1, which on light paper makes it brown;
  // `risk-mark` is the graphic and clears 3:1 while staying orange. A cell here
  // and the dot on Today are the same statement, so they use the same token.
  if (cell.is_at_risk) return "var(--color-risk-mark)";

  if (view === "count") {
    const total = cell.completed_total;
    if (total === 0) return "transparent";
    // Opacity rises with the count and saturates at five.
    const strength = Math.min(total, 5) / 5;
    return `color-mix(in srgb, var(--color-success) ${20 + strength * 80}%, transparent)`;
  }

  switch (cell.verdict) {
    case "success":
      return "var(--color-success)";
    case "failure":
      return "var(--color-failure)";
    default:
      // Neutral and unscheduled days are deliberately uncoloured. A day with one
      // primary is not a failure, and a day with none is not an outcome at all.
      return "transparent";
  }
}
