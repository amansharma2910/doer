import { Link, useParams } from "react-router-dom";
import { Empty, Problem, Waiting } from "../components/states";
import { ApiError } from "../lib/api";
import { formatAnchorDate, localAnchorToday } from "../lib/daytime";
import { formatMinutes, useDayAt, useTasksAt } from "../lib/hooks";
import { MAX_PRIMARIES, type Task, type Verdict } from "../lib/types";

/**
 * One day, after the fact.
 *
 * A route rather than a drawer or a dialog: it is linkable, it survives a
 * reload, it needs no focus management, and it works on touch, where the
 * heatmap's `title` attribute could not be read at all. ADR 0003.
 */
export function DayDetail() {
  const { anchor = "" } = useParams();
  const day = useDayAt(anchor);
  const tasks = useTasksAt(anchor);

  const missing =
    (day.error instanceof ApiError && day.error.status === 404) ||
    (tasks.error instanceof ApiError && tasks.error.status === 404);

  return (
    <>
      <header className="border-b border-line pb-5">
        <Link
          to="/history"
          className="text-note text-muted transition-colors hover:text-ink"
        >
          ← History
        </Link>
        <h1 className="mt-2 text-heading font-medium tracking-tight">
          {formatAnchorDate(anchor, localAnchorToday())}
        </h1>
        {day.data && <Outcome day={day.data} />}
      </header>

      {missing ? (
        <NothingScheduled anchor={anchor} />
      ) : day.isPending || tasks.isPending ? (
        <Waiting>Looking that day up.</Waiting>
      ) : day.error || tasks.error ? (
        <Problem title="That day could not be loaded.">
          The date may be malformed, or the API may be unreachable.
        </Problem>
      ) : (
        <TasksThatDay tasks={tasks.data ?? []} />
      )}
    </>
  );
}

function Outcome({ day }: { day: { verdict: Verdict | null; committed_minutes: number; threshold_minutes: number | null; is_at_risk: boolean; closed_at: string | null } }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-note text-muted">
      <VerdictBadge verdict={day.verdict} open={day.closed_at === null} />
      <span>
        <span className="tabular-nums text-ink">
          {formatMinutes(day.committed_minutes)}
        </span>{" "}
        committed of{" "}
        <span className="tabular-nums">{formatMinutes(day.threshold_minutes)}</span> that
        fitted
      </span>
      {day.is_at_risk && <span className="text-risk">over-committed</span>}
    </div>
  );
}

function VerdictBadge({ verdict, open }: { verdict: Verdict | null; open: boolean }) {
  // A day still running has no verdict yet, and saying "neutral" about it would
  // be reporting an outcome that has not happened.
  if (open) return <span className="text-ink">Still open</span>;

  const label: Record<string, { text: string; tone: string }> = {
    success: { text: "Kept", tone: "text-success" },
    failure: { text: "Not kept", tone: "text-failure" },
    neutral: { text: "Too little scheduled to score", tone: "text-muted" },
    unscheduled: { text: "Nothing scheduled", tone: "text-muted" },
  };
  const shown = verdict ? label[verdict] : { text: "Unscored", tone: "text-muted" };
  return <span className={shown.tone}>{shown.text}</span>;
}

function TasksThatDay({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <Empty title="That day was opened, but nothing was ever added to it." />;
  }

  const primaries = tasks.filter((t) => t.is_primary);
  const extras = tasks.filter((t) => !t.is_primary);

  return (
    <div className="mt-section space-y-section">
      <Group
        heading={`The four (${primaries.filter((t) => t.is_complete).length} of ${
          primaries.length || MAX_PRIMARIES
        } finished)`}
        tasks={primaries}
      />
      {extras.length > 0 && (
        <Group
          heading={`Extras (${extras.filter((t) => t.is_complete).length} of ${extras.length} finished)`}
          tasks={extras}
        />
      )}
    </div>
  );
}

function Group({ heading, tasks }: { heading: string; tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-note uppercase tracking-wide text-muted">{heading}</h2>
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-1">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-mark ${
                task.is_complete ? "bg-success" : "border border-line"
              }`}
            />
            <span
              className={`min-w-0 flex-1 truncate text-body ${
                task.is_complete ? "line-through decoration-1" : ""
              }`}
            >
              {task.title}
            </span>
            {/* Estimated against actual, which only exists for a task that was
                explicitly started. Showing a dash rather than a zero keeps
                "never started" distinct from "took no time". */}
            <span className="shrink-0 text-note tabular-nums text-muted">
              {formatMinutes(task.estimate_minutes)}
              {task.actual_minutes !== null && (
                <span className="text-ink"> · took {formatMinutes(task.actual_minutes)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NothingScheduled({ anchor }: { anchor: string }) {
  // The grid runs to the end of the current week, so its last few squares are
  // dates that have not happened. "You never used that day" is the wrong thing
  // to say about tomorrow.
  const future = anchor > localAnchorToday();
  return future ? (
    <Empty title="That day has not started yet.">
      Doer opens a day the first time you use it, and scores it when it ends.
    </Empty>
  ) : (
    <Empty title="Nothing was scheduled that day.">
      Doer records a day only once you open it, so days before you started, and days
      you never used, have nothing to show.
    </Empty>
  );
}
