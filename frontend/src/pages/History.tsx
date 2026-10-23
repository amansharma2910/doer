import { Heatmap } from "../components/Heatmap";
import { Problem, Waiting } from "../components/states";
import { useHeatmap } from "../lib/hooks";
import { ROLLING_WINDOW_DAYS, formatRate, summarize } from "../lib/stats";

const WEEKS = 26;

/**
 * The record.
 *
 * P1 gave the heatmap a room of its own; P3 gave it figures above it and made
 * every cell a link. The figures come from the grid the heatmap already
 * fetched, so the screen still issues one request.
 */
export function History() {
  const { data, isPending, error } = useHeatmap(WEEKS);
  const summary = summarize(data);

  return (
    <>
      <header className="border-b border-line pb-5">
        <h1 className="text-heading font-medium tracking-tight">History</h1>
        <p className="mt-1 text-note text-muted">
          Every day you have recorded, by the day it belonged to rather than the date
          it happened on. Pick any square to see it.
        </p>
      </header>

      {/* Figures are withheld until there are figures. Rendering "-", "0" and
          "0 of 0 scored" during load, and keeping them after a failed fetch,
          presented absent data as a real result. */}
      {isPending ? (
        <Waiting>Gathering your days.</Waiting>
      ) : error ? (
        <Problem title="Your history could not be loaded.">
          The API answered with an error. Today and Settings still work.
        </Problem>
      ) : (
      <dl className="mt-section grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label={`Last ${ROLLING_WINDOW_DAYS} days`}
          value={formatRate(summary.rollingRate)}
          note={
            summary.rollingScored === 0
              ? "no scored days yet"
              : `across ${summary.rollingScored} scored ${
                  summary.rollingScored === 1 ? "day" : "days"
                }`
          }
        />
        <Stat
          label="Current streak"
          value={String(summary.streak)}
          note={
            summary.streak === 0
              ? "days kept in a row"
              : `${summary.streak === 1 ? "day" : "days"} kept in a row`
          }
        />
        {/* "Days kept", not "kept in this window". The figures count elapsed
            days; the grid below draws all 26 weeks including the forward
            padding to the end of this week. One screen, one word, two spans
            was exactly the kind of mismatch this overhaul is for. */}
        <Stat
          label="Days kept"
          value={`${summary.kept}`}
          note={`of ${summary.scored} scored so far`}
        />
      </dl>
      )}

      <div className="mt-section">
        <Heatmap />
      </div>

      <p className="mt-6 max-w-prose text-note leading-relaxed text-muted">
        A streak counts days you kept, one after another. A day you did not keep
        resets it. A day with too little scheduled to score is skipped rather than
        counted against you, so a deliberate day off costs nothing. Every figure
        above counts days that have happened; the grid runs to the end of this
        week, so its last few squares are still ahead of you.
      </p>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-note uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-display font-medium tabular-nums">{value}</dd>
      <dd className="text-note text-muted">{note}</dd>
    </div>
  );
}
