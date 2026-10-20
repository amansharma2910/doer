import { useMemo, useState } from "react";
import { useHeatmap } from "../lib/hooks";
import type { HeatmapCell } from "../lib/types";

type View = "count" | "verdict";
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
  const { start, end, days } = useMemo(() => buildRange(WEEKS), []);
  const { data } = useHeatmap(start, end);

  const byDate = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of data ?? []) map.set(cell.anchor_date, cell);
    return map;
  }, [data]);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">History</h2>
        <div className="flex gap-3 text-xs">
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
              {week.map((date) => (
                <Cell key={date} date={date} cell={date ? byDate.get(date) : undefined} view={view} />
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
  if (!date) return <span className="h-[11px] w-[11px]" />;

  return (
    <span
      title={describe(date, cell)}
      style={{ background: colorFor(cell, view) }}
      className="h-[11px] w-[11px] rounded-[2px] ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06]"
    />
  );
}

function colorFor(cell: HeatmapCell | undefined, view: View): string {
  if (!cell) return "transparent";

  // At-risk overrides both views. It is the one signal that is about the plan
  // rather than the outcome, and it reads the same wherever you are looking.
  if (cell.is_at_risk) return "var(--color-risk)";

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
    <p className="mt-3 text-xs text-[var(--color-muted)]">
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
          ? "font-medium text-[var(--color-ink)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      }
    >
      {children}
    </button>
  );
}

function buildRange(weeks: number) {
  const today = new Date();
  const end = new Date(today);
  // Pad to the end of the current week so the grid is rectangular.
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return { start: days[0], end: days[days.length - 1], days };
}
