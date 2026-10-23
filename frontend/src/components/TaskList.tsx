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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
} from "./icons";
import { asRuleError } from "../lib/api";
import { useElapsedMinutes } from "../lib/elapsed";
import {
  formatMinutes,
  useCompleteTask,
  useDeleteTask,
  useReorderTask,
  useSetPrimary,
  useStartTask,
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
            <h3 className="mb-2 text-note uppercase tracking-wide text-muted">
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
    <p className="mb-6 text-note leading-relaxed text-muted">
      {tasks.length === 1 ? (
        <>
          <span className="text-ink">{tasks[0].title}</span> moved out
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
      className={isDragging ? "enter opacity-50" : "enter"}
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
  const start = useStartTask();
  const remove = useDeleteTask();
  const setPrimary = useSetPrimary();
  const elapsed = useElapsedMinutes(task.started_at);
  const running = task.started_at !== null;

  if (editing) return <TaskEditor task={task} onDone={() => setEditing(false)} />;

  return (
    <div
      data-running={running || undefined}
      className={[
        "flex items-center gap-3 rounded-control py-2 pr-2 transition-colors",
        // A running row carries a left edge as well as a tint. The tint alone
        // was too quiet to answer "which one am I on" at a glance, and an
        // animated indicator is the kind of attention-seeking this product
        // refuses.
        running ? "border-l-2 border-ink bg-wash pl-1.5" : "border-l-2 border-transparent pl-1.5 hover:bg-wash",
      ].join(" ")}
    >
      <button
        aria-label={`Complete ${task.title}`}
        onClick={() => complete.mutate(task.id)}
        className="group/done grid h-5 w-5 shrink-0 place-items-center rounded-mark
                   border border-line text-transparent transition-colors
                   hover:border-success hover:text-success
                   focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <CheckIcon className="h-3 w-3" />
      </button>

      <span
        {...dragHandle}
        className="min-w-0 flex-1 cursor-grab truncate text-body active:cursor-grabbing"
        title={task.title}
      >
        {task.title}
        {task.carry_forward_count > 0 && (
          <span
            className="ml-2 text-note text-muted"
            title={`Carried forward ${task.carry_forward_count} time(s)`}
          >
            ↻{task.carry_forward_count}
          </span>
        )}
      </span>

      {/* An in-progress task shows what it has cost so far in place of what it
          was estimated to cost. Both at once is two numbers competing for the
          same glance, and the live one is the one being decided on. */}
      {running ? (
        <span
          className="shrink-0 text-note tabular-nums text-ink"
          title={`Started, ${elapsed ?? 0} minutes ago`}
        >
          {/* "0m in" is not something anyone says about work begun moments
              ago, and it reads as a broken counter rather than a fresh one. */}
          {elapsed && elapsed > 0 ? `${formatMinutes(elapsed)} in` : "running"}
        </span>
      ) : (
        <Estimate task={task} />
      )}

      {/* Always present, never hover-gated. The previous row revealed three
          text links on hover, which on touch meant they did not exist. */}
      <div className="flex shrink-0 items-center gap-0.5">
        {!running && (
          <RowAction
            label={`Start ${task.title}`}
            onClick={() => start.mutate(task.id)}
            icon={<PlayIcon className="h-3.5 w-3.5" />}
          />
        )}
        <RowAction
          label={`Edit ${task.title}`}
          onClick={() => setEditing(true)}
          icon={<PencilIcon className="h-3.5 w-3.5" />}
        />
        <RowAction
          label={
            task.is_primary
              ? `Demote ${task.title} out of today's four`
              : `Promote ${task.title} into today's four`
          }
          onClick={() => setPrimary.mutate({ id: task.id, isPrimary: !task.is_primary })}
          icon={
            task.is_primary ? (
              <ArrowDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpIcon className="h-3.5 w-3.5" />
            )
          }
        />
        <RowAction
          label={`Delete ${task.title}`}
          onClick={() => remove.mutate(task.id)}
          icon={<TrashIcon className="h-3.5 w-3.5" />}
          destructive
        />
      </div>

      {setPrimary.error && <RuleMessage error={setPrimary.error} />}
    </div>
  );
}

/**
 * One icon control on a task row.
 *
 * 28px square, which is below the 44px touch target a dense list cannot afford
 * but above the point where a thumb misses; the row itself is 36px tall and the
 * controls are spaced rather than abutting. The label is on the button, not on
 * the glyph, so a screen reader announces the action and the task once.
 */
function RowAction({
  label,
  onClick,
  icon,
  destructive = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        "grid h-7 w-7 place-items-center rounded-control text-muted transition-colors",
        destructive ? "hover:text-failure" : "hover:text-ink",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
        "focus-visible:outline-focus",
      ].join(" ")}
    >
      {icon}
    </button>
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
      className="rounded-control border border-line px-3 py-3"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        className="w-full border-b border-line bg-transparent pb-1 text-body outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-4 text-note">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PreferenceKind)}
          className="border-b border-line bg-transparent pb-1 outline-none"
        >
          {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2">
          <span className="text-muted">Takes</span>
          <select
            value={minutes ?? ""}
            onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : null)}
            className="border-b border-line bg-transparent pb-1 outline-none"
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
          <button type="button" onClick={onDone} className="text-muted">
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
      <span className="shrink-0 text-note tabular-nums text-muted">
        {formatMinutes(task.estimate_minutes)}
      </span>
    );
  }
  // An unestimated task is shown as unknown, never as zero. Unknown capacity is
  // what makes a day read indeterminate rather than safe.
  return (
    <span
      className="shrink-0 text-note text-muted"
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
  return <p className="text-note text-risk">{rule.remedy ?? rule.message}</p>;
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
