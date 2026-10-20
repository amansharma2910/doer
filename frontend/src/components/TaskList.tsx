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
import { asRuleError } from "./AddTask";
import {
  formatMinutes,
  useCompleteTask,
  useDeleteTask,
  useReorderTask,
  useSetPrimary,
} from "../lib/hooks";
import { PREFERENCE_LABELS, type Task } from "../lib/types";

export function TaskList({ tasks }: { tasks: Task[] }) {
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
  const complete = useCompleteTask();
  const remove = useDeleteTask();
  const setPrimary = useSetPrimary();

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
