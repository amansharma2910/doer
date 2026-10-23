import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { colorFor, type View } from "../lib/heatmap";
import { useHeatmap } from "../lib/hooks";
import type { HeatmapCell } from "../lib/types";
const WEEKS = 26;

/**
 * Hand-built rather than a library. Two views, an orange at-risk state that
 * overrides both, and cells keyed by anchor date rather than calendar date are
 * between them more than any off-the-shelf calendar-heatmap component does.
 *
 * Cells are anchor dates. A task finished at 03:00 lands on the day that began
 * the previous afternoon, which is the whole point of the logical day.
 */
export function Heatmap() {
  const [view, setView] = useState<View>("count");
  const { data } = useHeatmap(WEEKS);

  const byDate = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of data?.cells ?? []) map.set(cell.anchor_date, cell);
    return map;
  }, [data]);

  // Placeholders of the right shape while the query is in flight. The dates come
  // from the server now, so without these the grid would collapse and reflow on
  // every mount.
  const days = data?.days ?? Array.from({ length: WEEKS * 7 }, () => null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    // The heading moved to the History screen when this stopped being the fifth
    // section of a page and became the whole of one.
    <section aria-label="Activity heatmap">
      <div className="flex items-baseline justify-end">
        <div className="flex gap-3 text-note">
          <ViewButton active={view === "count"} onClick={() => setView("count")}>
            Tasks done
          </ViewButton>
          <ViewButton active={view === "verdict"} onClick={() => setView("verdict")}>
            Days kept
          </ViewButton>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.map((date, j) => (
                <Cell
                  key={date ?? `${i}-${j}`}
                  date={date}
                  cell={date ? byDate.get(date) : undefined}
                  view={view}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Legend view={view} />
    </section>
  );
}

function Cell({
  date,
  cell,
  view,
}: {
  date: string | null;
  cell: HeatmapCell | undefined;
  view: View;
}) {
  const shape =
    "h-[11px] w-[11px] rounded-mark ring-1 ring-inset ring-hairline";

  // A placeholder while the server's dates are in flight: same footprint and the
  // same empty ring, so the grid does not reflow or flash when they land.
  if (!date) return <span className={shape} />;

  // Every dated cell is a link, including a day with no row. The detail screen
  // answers "nothing was scheduled" far better than a `title` attribute, which
  // on touch could not be read at all.
  return (
    <Link
      to={`/history/${date}`}
      aria-label={describe(date, cell)}
      title={describe(date, cell)}
      style={{ background: colorFor(cell, view) }}
      className={`${shape} block transition-transform hover:scale-150
                  focus-visible:outline focus-visible:outline-2
                  focus-visible:outline-offset-1 focus-visible:outline-focus`}
    />
  );
}

function describe(date: string, cell: HeatmapCell | undefined): string {
  if (!cell) return `${date}: nothing scheduled`;
  const parts = [`${date}`, `${cell.completed_total} done`];
  if (cell.scheduled_primary > 0) {
    parts.push(`${cell.completed_primary}/${cell.scheduled_primary} of the four`);
  }
  if (cell.verdict && cell.verdict !== "unscheduled") parts.push(cell.verdict);
  if (cell.is_at_risk) parts.push("over-committed");
  return parts.join(" · ");
}

function Legend({ view }: { view: View }) {
  return (
    <p className="mt-3 text-note text-muted">
      {view === "count"
        ? "Brighter means more finished that day, counting everything, not just the four."
        : "Green kept the day (three of four). Red did not. Uncoloured days had too little scheduled to score."}
    </p>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "font-medium text-ink"
          : "text-muted hover:text-ink"
      }
    >
      {children}
    </button>
  );
}
