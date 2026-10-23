import { Link } from "react-router-dom";
import { DayHeader } from "../components/DayHeader";
import { TaskEntry } from "../components/TaskEntry";
import { TaskList } from "../components/TaskList";
import { Empty, Problem, Waiting } from "../components/states";
import { ApiError } from "../lib/api";
import { useDay, useReverseCompletion, useTasks } from "../lib/hooks";
import type { Task } from "../lib/types";

/**
 * The screen the day is run from.
 *
 * P1 moved this out of the old dashboard and took three things off it: the
 * heatmap, which has the History screen to itself, and the brand and account
 * controls, which belong to the frame rather than to one room. P2 replaced the
 * day header with the four-slot commitment contract, gave the task rows
 * always-visible controls and an in-progress state, and put the two ways of
 * adding work onto one surface.
 */
export function Today() {
  const { data: day, error: dayError } = useDay();
  const { data: tasks = [] } = useTasks();

  const pending = tasks.filter((t) => !t.is_complete);
  const done = tasks.filter((t) => t.is_complete);
  const primariesUsed = tasks.filter((t) => t.is_primary).length;

  if (dayError instanceof ApiError && dayError.status === 409) return <OutsideDay />;
  // Anything other than a 409 is a failure, not a wait. Without this branch a
  // 500 rendered "Working out where you are in your day." permanently, which
  // is a loading state telling a lie.
  if (dayError) {
    return (
      <Problem title="Today could not be loaded.">
        The API answered with an error. History and Settings still work.
      </Problem>
    );
  }
  if (!day) return <Waiting>Working out where you are in your day.</Waiting>;

  // Room for the entry dock, which floats over the foot of this screen only.
  return (
    <div className="pb-dock">
      <DayHeader day={day} primariesUsed={primariesUsed} />

      <section className="mt-section">
        {pending.length === 0 ? (
          <Empty title="Nothing planned yet.">
            Add a task below, or describe the day and let Doer propose some. At most
            four of them count toward keeping the day.
          </Empty>
        ) : (
          <TaskList tasks={pending} />
        )}
      </section>

      {done.length > 0 && <CompletedSection tasks={done} />}

      <TaskEntry primariesUsed={primariesUsed} />
    </div>
  );
}

/** Present, but recessed. Finishing is the point; admiring the list is not. */
function CompletedSection({ tasks }: { tasks: Task[] }) {
  const reverse = useReverseCompletion();

  return (
    <section className="mt-section opacity-60 transition-opacity hover:opacity-100">
      <h2 className="mb-2 text-note uppercase tracking-wide text-muted">Done today</h2>
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 px-2 py-1">
            <button
              aria-label={`Mark ${task.title} as not done`}
              onClick={() => reverse.mutate(task.id)}
              title="Undo"
              className="h-4 w-4 shrink-0 rounded-mark bg-success"
            />
            <span className="min-w-0 flex-1 truncate text-body line-through decoration-1">
              {task.title}
            </span>
            {!task.is_primary && (
              <span className="shrink-0 text-note text-muted">extra</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OutsideDay() {
  return (
    <p className="text-body leading-relaxed text-muted">
      You are between days right now. Doer picks up again when your next day starts.
      You can change when that is in{" "}
      <Link to="/settings" className="underline underline-offset-2">
        settings
      </Link>
      .
    </p>
  );
}
