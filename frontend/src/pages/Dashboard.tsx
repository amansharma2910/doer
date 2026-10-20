import { Link } from "react-router-dom";
import { AddTask } from "../components/AddTask";
import { Chat } from "../components/Chat";
import { Heatmap } from "../components/Heatmap";
import { TaskList } from "../components/TaskList";
import { ApiError } from "../lib/api";
import {
  formatMinutes,
  useDay,
  useRefreshCalendar,
  useReverseCompletion,
  useTasks,
} from "../lib/hooks";
import type { LogicalDay, Task, User } from "../lib/types";

export function Dashboard({ user }: { user: User }) {
  const { data: day, error: dayError } = useDay();
  const { data: tasks = [] } = useTasks();

  const pending = tasks.filter((t) => !t.is_complete);
  const done = tasks.filter((t) => t.is_complete);
  const primariesUsed = tasks.filter((t) => t.is_primary).length;

  return (
    <div className="mx-auto max-w-2xl px-6 pb-32 pt-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">Doer</h1>
        <nav className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
          <Link to="/settings" className="hover:text-[var(--color-ink)]">
            Settings
          </Link>
          <span title={user.email}>{user.name ?? user.email}</span>
        </nav>
      </header>

      {dayError instanceof ApiError && dayError.status === 409 ? (
        <OutsideDay />
      ) : (
        day && (
          <>
            <DayHeader day={day} />
            <main className="mt-8">
              {pending.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">
                  Nothing planned yet. Tell Doer what you want to get done, or use the
                  plus button.
                </p>
              ) : (
                <TaskList tasks={pending} />
              )}
            </main>

            {done.length > 0 && <CompletedSection tasks={done} />}

            <div className="mt-10">
              <Chat />
            </div>

            <Heatmap />
          </>
        )
      )}

      <AddTask primariesUsed={primariesUsed} />
    </div>
  );
}

function DayHeader({ day }: { day: LogicalDay }) {
  const refresh = useRefreshCalendar();

  return (
    <section className="mt-8 border-b border-[var(--color-line)] pb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">{day.anchor_date}</h2>
        {day.is_at_risk && <RiskDot />}
      </div>

      <p className="mt-1 text-xs text-[var(--color-muted)]">
        {day.is_indeterminate ? (
          <IndeterminateNote reason={day.indeterminate_reason} />
        ) : (
          <>
            {formatMinutes(day.committed_minutes)} committed of{" "}
            {formatMinutes(day.threshold_minutes)} that fits comfortably
          </>
        )}
      </p>

      {(day.calendar_state === "revoked" || day.calendar_state === "stale") && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          {day.calendar_state === "revoked"
            ? "Calendar disconnected, so this ignores meetings."
            : "Calendar data is out of date."}{" "}
          <button
            onClick={() => refresh.mutate()}
            className="underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            {day.calendar_state === "revoked" ? "Reconnect" : "Refresh"}
          </button>
        </p>
      )}
    </section>
  );
}

function IndeterminateNote({ reason }: { reason: string | null }) {
  if (reason === "no_focus_blocks") {
    return (
      <>
        Set up at least one work block in{" "}
        <Link to="/settings" className="underline underline-offset-2">
          settings
        </Link>{" "}
        and Doer can tell you what fits.
      </>
    );
  }
  return <>Still working out how long everything takes.</>;
}

/** The entire over-commitment signal. No modal, no alert, no nagging. */
function RiskDot() {
  return (
    <span
      title="More committed than this day realistically holds"
      className="inline-block h-[7px] w-[7px] rounded-full bg-[var(--color-risk)]"
    />
  );
}

/** Present, but recessed. Finishing is the point; admiring the list is not. */
function CompletedSection({ tasks }: { tasks: Task[] }) {
  const reverse = useReverseCompletion();

  return (
    <section className="mt-12 opacity-60 transition-opacity hover:opacity-100">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Done today
      </h3>
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 px-2 py-1">
            <button
              aria-label={`Mark ${task.title} as not done`}
              onClick={() => reverse.mutate(task.id)}
              title="Undo"
              className="h-4 w-4 shrink-0 rounded-sm bg-[var(--color-success)]"
            />
            <span className="min-w-0 flex-1 truncate text-sm line-through decoration-1">
              {task.title}
            </span>
            {!task.is_primary && (
              <span className="shrink-0 text-xs text-[var(--color-muted)]">extra</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OutsideDay() {
  return (
    <p className="mt-10 text-sm leading-relaxed text-[var(--color-muted)]">
      You are between days right now. Doer picks up again when your next day starts.
      You can change when that is in{" "}
      <Link to="/settings" className="underline underline-offset-2">
        settings
      </Link>
      .
    </p>
  );
}
