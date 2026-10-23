import { localAnchorToday } from "./daytime";
import type { HeatmapCell, HeatmapGrid } from "./types";

export type HistorySummary = {
  /** Fraction of the scored days in the trailing window that were kept, or
      null when the window holds no scored day at all. */
  rollingRate: number | null;
  /** Scored days in the trailing window. The denominator behind `rollingRate`,
      shown so a rate of 1.0 over a single day cannot read as a perfect week. */
  rollingScored: number;
  /** Consecutive kept days, counting back from the most recent. */
  streak: number;
  /** Days kept across the whole grid. */
  kept: number;
  /** Days scored across the whole grid: the denominator for `kept`. */
  scored: number;
};

export const ROLLING_WINDOW_DAYS = 7;

/** A day counts toward a rate only if it was actually scored. Neutral and
    unscheduled days had too little committed to produce an outcome, and
    counting them as failures would punish a rest day. */
function isScored(cell: HeatmapCell | undefined): boolean {
  return cell?.verdict === "success" || cell?.verdict === "failure";
}

/**
 * The History screen's figures, from the heatmap payload already fetched.
 *
 * No extra request: the grid carries every cell these need. Pure, so the three
 * definitions below are testable without a DOM or a server.
 *
 * **Streak.** Consecutive days with a `success` verdict, counting back from the
 * most recent day in the grid. A `failure` resets it to zero. Neutral and
 * unscheduled days are *skipped*: they neither extend it nor break it. Chosen
 * by the user on 2026-10-23 over two stricter readings, so that a deliberate
 * rest day does not cost a streak.
 *
 * That choice leaves one gaming route open and it is recorded rather than
 * hidden: scheduling a single primary indefinitely keeps a streak alive while
 * committing to nothing, because a day under the two-primary floor scores
 * neutral. The scoring-floor marker on Today is the mitigation, making such a
 * day visibly unscoreable. See plan §12.2.
 */
export function summarize(
  grid: HeatmapGrid | undefined,
  today: string = localAnchorToday(),
): HistorySummary {
  const empty: HistorySummary = {
    rollingRate: null,
    rollingScored: 0,
    streak: 0,
    kept: 0,
    scored: 0,
  };
  if (!grid || grid.days.length === 0) return empty;

  const byDate = new Map(grid.cells.map((cell) => [cell.anchor_date, cell]));

  // Elapsed days only. The server pads the grid forward to the end of the
  // current week, so its last entries are dates that have not happened. Taking
  // the last seven rows of the raw grid meant the rolling window held one real
  // day on a Sunday and seven only on a Saturday, and the figure read "-" after
  // a full week of recorded history. Anchor dates are zero-padded ISO, so a
  // string comparison is a date comparison.
  const elapsed = grid.days.filter((d) => d <= today);
  // Ascending, so the most recent day is last.
  const descending = [...elapsed].reverse();

  let streak = 0;
  for (const date of descending) {
    const verdict = byDate.get(date)?.verdict;
    if (verdict === "success") streak += 1;
    else if (verdict === "failure") break;
    // neutral, unscheduled and days with no row at all are skipped.
  }

  const window = descending.slice(0, ROLLING_WINDOW_DAYS);
  const rollingScored = window.filter((d) => isScored(byDate.get(d))).length;
  const rollingKept = window.filter((d) => byDate.get(d)?.verdict === "success").length;

  const scored = elapsed.filter((d) => isScored(byDate.get(d))).length;
  const kept = elapsed.filter((d) => byDate.get(d)?.verdict === "success").length;

  return {
    rollingRate: rollingScored === 0 ? null : rollingKept / rollingScored,
    rollingScored,
    streak,
    kept,
    scored,
  };
}

/** A rate as a percentage, or a dash when there is nothing to divide by. An
    unscored window is not a zero: it is an absence of evidence.

    A plain hyphen, matching `formatMinutes`, which has used one for a null
    value since the first milestone. Two glyphs for one meaning in one
    interface is the sort of small inconsistency this overhaul exists to
    remove. */
export function formatRate(rate: number | null): string {
  return rate === null ? "-" : `${Math.round(rate * 100)}%`;
}
