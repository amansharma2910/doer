import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { asRuleError } from "../lib/api";
import {
  formatMinutes,
  useCompleteTask,
  useDeleteTask,
  useReorderTask,
  useSetPrimary,
  useUpdateTask,
} from "../lib/hooks";
import {
  ESTIMATE_BUCKETS,
  PREFERENCE_LABELS,
  type PreferenceKind,
  type Task,
} from "../lib/types";

export function TaskList({ tasks }: { tasks: Task[] }) {
  const demoted = tasks.filter((t) => t.carry_forward_demoted);
  const reorder = useReorderTask();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byBlock = groupByBlock(tasks);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const moved = tasks.find((t) => t.id === active.id);
    if (!moved) return;

    // Ordering is scoped to a block: a drop outside it is ignored rather than
    // silently moving the task to a block it does not belong to.
    const siblings = byBlock.get(moved.preference_kind) ?? [];
    const toIndex = siblings.findIndex((t) => t.id === over.id);
    if (toIndex === -1) return;

    reorder.mutate({ id: moved.id, toIndex });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {demoted.length > 0 && <DemotionNotice tasks={demoted} />}
      <div className="space-y-8">
        {[...byBlock.entries()].map(([kind, group]) => (
          <section key={kind}>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
              {PREFERENCE_LABELS[kind]}
            </h3>
            <SortableContext items={group.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {group.map((task) => (
                  <SortableRow key={task.id} task={task} />
                ))}
              </ul>
            </SortableContext>
          </section>
        ))}
      </div>
    </DndContext>
  );
}

/**
 * Carry-forward precedence gives unfinished commitments the primary slots, which
 * means something you planned in advance quietly lost one. Saying so is part of
 * the contract: the plan requires the user be told which tasks were demoted.
 */
function DemotionNotice({ tasks }: { tasks: Task[] }) {
  return (
    <p className="mb-6 text-xs leading-relaxed text-[var(--color-muted)]">
      {tasks.length === 1 ? (
        <>
          <span className="text-[var(--color-ink)]">{tasks[0].title}</span> moved out
          of your four
        </>
      ) : (
        <>{tasks.length} tasks moved out of your four</>
      )}{" "}
      to make room for what carried over. Promote {tasks.length === 1 ? "it" : "them"}{" "}
      back if you would rather drop something else.
    </p>
  );
}

function SortableRow({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-50" : undefined}
    >
      <TaskRow task={task} dragHandle={{ ...attributes, ...listeners }} />
    </li>
  );
}

export function TaskRow({
  task,
  dragHandle,
}: {
  task: Task;
  dragHandle?: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const complete = useCompleteTask();
  const remove = useDeleteTask();
  const setPrimary = useSetPrimary();

  if (editing) return <TaskEditor task={task} onDone={() => setEditing(false)} />;

  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]">
      <button
        aria-label={`Complete ${task.title}`}
        onClick={() => complete.mutate(task.id)}
        className="h-4 w-4 shrink-0 rounded-sm border border-[var(--color-line)]
                   transition-colors hover:border-[var(--color-success)]"
      />

      <span
        {...dragHandle}
        className="min-w-0 flex-1 cursor-grab truncate text-sm active:cursor-grabbing"
        title={task.title}
      >
        {task.title}
        {task.carry_forward_count > 0 && (
          <span
            className="ml-2 text-xs text-[var(--color-muted)]"
            title={`Carried forward ${task.carry_forward_count} time(s)`}
          >
            ↻{task.carry_forward_count}
          </span>
        )}
      </span>

      <Estimate task={task} />

      <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          Edit
        </button>
        <button
          onClick={() => setPrimary.mutate({ id: task.id, isPrimary: !task.is_primary })}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          {task.is_primary ? "Demote" : "Promote"}
        </button>
        <button
          onClick={() => remove.mutate(task.id)}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-failure)]"
        >
          Delete
        </button>
      </div>

      {setPrimary.error && <RuleMessage error={setPrimary.error} />}
    </div>
  );
}

/**
 * Inline editing, in place rather than in a modal.
 *
 * The estimate is a fixed set of buckets because that is what the API stores: an
 * arbitrary number would be snapped on arrival, and showing a free field invites
 * someone to type 37 and watch it silently become 45.
 */
function TaskEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [kind, setKind] = useState<PreferenceKind>(task.preference_kind);
  const [minutes, setMinutes] = useState<number | null>(task.estimate_minutes);
  const update = useUpdateTask();

  function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    update.mutate(
      {
        id: task.id,
        title: trimmed,
        preference_kind: kind,
        ...(minutes !== null ? { estimate_minutes: minutes } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form
      onSubmit={save}
      className="rounded-md border border-[var(--color-line)] px-3 py-3"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        className="w-full border-b border-[var(--color-line)] bg-transparent pb-1 text-sm outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PreferenceKind)}
          className="border-b border-[var(--color-line)] bg-transparent pb-1 outline-none"
        >
          {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2">
          <span className="text-[var(--color-muted)]">Takes</span>
          <select
            value={minutes ?? ""}
            onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : null)}
            className="border-b border-[var(--color-line)] bg-transparent pb-1 outline-none"
          >
            <option value="">not estimated yet</option>
            {ESTIMATE_BUCKETS.map((value) => (
              <option key={value} value={value}>
                {formatMinutes(value)}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex gap-3">
          <button type="button" onClick={onDone} className="text-[var(--color-muted)]">
            Cancel
          </button>
          <button type="submit" className="font-medium">
            {update.isPending ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Estimate({ task }: { task: Task }) {
  if (task.estimate_minutes !== null) {
    return (
      <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
        {formatMinutes(task.estimate_minutes)}
      </span>
    );
  }
  // An unestimated task is shown as unknown, never as zero. Unknown capacity is
  // what makes a day read indeterminate rather than safe.
  return (
    <span
      className="shrink-0 text-xs text-[var(--color-muted)]"
      title={
        task.estimation_status === "failed"
          ? "Could not estimate this one. Set a time yourself if you like."
          : "Working out how long this takes"
      }
    >
      {task.estimation_status === "failed" ? "no estimate" : "..."}
    </span>
  );
}

function RuleMessage({ error }: { error: unknown }) {
  const rule = asRuleError(error);
  if (!rule) return null;
  // Contract refusals carry a remedy, so the interface offers a way forward
  // rather than just saying no.
  return <p className="text-xs text-[var(--color-risk)]">{rule.remedy ?? rule.message}</p>;
}

function groupByBlock(tasks: Task[]) {
  const map = new Map<Task["preference_kind"], Task[]>();
  for (const task of tasks) {
    const existing = map.get(task.preference_kind) ?? [];
    existing.push(task);
    map.set(task.preference_kind, existing);
  }
  for (const group of map.values()) group.sort((a, b) => a.sort_index - b.sort_index);
  return map;
}
