import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import type {
  HeatmapGrid,
  LogicalDay,
  PreferenceBlock,
  ProposedTask,
  Task,
  User,
} from "./types";

export const keys = {
  me: ["me"] as const,
  day: ["day", "current"] as const,
  dayAt: (anchor: string) => ["day", anchor] as const,
  /** The open day's tasks. Parameterised so a past day can be cached beside it
      rather than overwriting it. `current` rather than `undefined` keeps the
      key a tuple of strings, which is what `tasksCurrent` below relies on. */
  tasks: ["tasks", "current"] as const,
  tasksAt: (anchor: string) => ["tasks", anchor] as const,
  blocks: ["blocks"] as const,
  heatmap: (weeks: number) => ["heatmap", weeks] as const,
};

export function useMe() {
  return useQuery<User>({ queryKey: keys.me, queryFn: () => api<User>("/auth/me"), retry: false });
}

/**
 * Estimation resolves after the task is created, in a background job the browser
 * knows nothing about. Without this the estimate sits on "..." until something
 * else happens to refetch, which in practice meant a manual page refresh.
 */
export function isAwaitingEstimate(task: Task): boolean {
  return task.estimate_minutes === null && task.estimation_status === "pending";
}

const ESTIMATE_POLL_MS = 2000;

export function useDay() {
  const queryClient = useQueryClient();
  return useQuery<LogicalDay>({
    queryKey: keys.day,
    queryFn: () => api<LogicalDay>("/days/current"),
    retry: false,
    // An arriving estimate moves committed minutes and can flip the at-risk flag,
    // so the day follows the same cadence as the tasks it summarizes.
    //
    // This reaches into the tasks cache by key, which couples the two. When
    // `keys.tasks` gained its "current" segment for the History screen, a
    // lookup left on the old flat key would have returned undefined and the
    // day would have silently stopped following the estimate cadence, with
    // nothing failing. T-IO-37 exists for exactly that.
    refetchInterval: () =>
      queryClient.getQueryData<Task[]>(keys.tasks)?.some(isAwaitingEstimate)
        ? ESTIMATE_POLL_MS
        : false,
  });
}

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: keys.tasks,
    queryFn: () => api<Task[]>("/tasks"),
    // Polls only while something is actually waiting, and stops the moment the
    // last estimate lands or gives up.
    refetchInterval: (query) =>
      query.state.data?.some(isAwaitingEstimate) ? ESTIMATE_POLL_MS : false,
  });
}

/** A past day's summary. 404 means there was never a day on that anchor,
    which the interface shows as nothing-scheduled rather than as an error. */
export function useDayAt(anchor: string) {
  return useQuery<LogicalDay>({
    queryKey: keys.dayAt(anchor),
    queryFn: () => api<LogicalDay>(`/days/${anchor}`),
    retry: false,
  });
}

/** A past day's tasks. Never polls: a closed day's estimates are settled. */
export function useTasksAt(anchor: string) {
  return useQuery<Task[]>({
    queryKey: keys.tasksAt(anchor),
    queryFn: () => api<Task[]>(`/tasks?anchor=${anchor}`),
    retry: false,
  });
}

export function useBlocks() {
  return useQuery<PreferenceBlock[]>({
    queryKey: keys.blocks,
    queryFn: () => api<PreferenceBlock[]>("/settings/blocks"),
  });
}

export function useHeatmap(weeks: number) {
  return useQuery<HeatmapGrid>({
    queryKey: keys.heatmap(weeks),
    queryFn: () => api<HeatmapGrid>(`/days/heatmap?weeks=${weeks}`),
  });
}

/** Any task mutation can move capacity, so the day refetches alongside. */
function useTaskMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      // By prefix, so both the open day and any past day on screen refresh.
      // A completion can move a verdict, which the History grid shows.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["day"] });
      queryClient.invalidateQueries({ queryKey: ["heatmap"] });
    },
  });
}

/** Empties every cached query on the way out, so the next account to sign in on
    this browser cannot see a flash of the previous one's day.

    `resetQueries`, not `clear()`. `clear()` destroys the Query objects but leaves
    mounted observers attached to the dead ones, still reporting the old success,
    so React is never told anything changed and the page sits frozen on a
    signed-out dashboard. Nothing sequenced after a `clear()` can reach those
    observers either. Exported as a plain function so the behaviour is testable
    without a DOM. See docs/fixes/fix_plan_signout-leaves-page-frozen.md. */
export function signOutTeardown(queryClient: QueryClient) {
  return queryClient.resetQueries();
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    // Fires on failure too, which is deliberate: a sign-out that fails must not
    // leave a frozen dashboard behind either.
    onSettled: () => signOutTeardown(queryClient),
  });
}

export function useCreateTask() {
  return useTaskMutation((body: {
    title: string;
    is_primary: boolean;
    preference_kind: string;
    notes?: string;
  }) => api<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }));
}

export function useCompleteTask() {
  return useTaskMutation((id: string) => api<Task>(`/tasks/${id}/complete`, { method: "POST" }));
}

/**
 * Begin a task.
 *
 * Idempotent at the API: `start_task` returns the task unchanged if it is
 * already started or already complete, so the interface may call it without
 * guarding first. There is deliberately no counterpart: nothing clears
 * `started_at`, which is why more than one task may be in progress at once.
 * Blocking the second start would trap a mis-start with no way out. See
 * AC-IO-14.
 */
export function useStartTask() {
  return useTaskMutation((id: string) => api<Task>(`/tasks/${id}/start`, { method: "POST" }));
}

export function useReverseCompletion() {
  return useTaskMutation((id: string) => api<Task>(`/tasks/${id}/complete`, { method: "DELETE" }));
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => api<void>(`/tasks/${id}`, { method: "DELETE" }));
}

export function useSetPrimary() {
  return useTaskMutation(({ id, isPrimary }: { id: string; isPrimary: boolean }) =>
    api<Task>(`/tasks/${id}/primary`, {
      method: "POST",
      body: JSON.stringify({ is_primary: isPrimary }),
    }),
  );
}

export function useReorderTask() {
  return useTaskMutation(({ id, toIndex }: { id: string; toIndex: number }) =>
    api<Task>(`/tasks/${id}/reorder`, {
      method: "POST",
      body: JSON.stringify({ to_index: toIndex }),
    }),
  );
}

export function useUpdateTask() {
  return useTaskMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      title?: string;
      notes?: string;
      preference_kind?: string;
      estimate_minutes?: number;
    }) => api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  );
}

export function useChat() {
  return useMutation({
    mutationFn: (message: string) =>
      api<{ turn_id: string; tasks: ProposedTask[] }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
  });
}

export function useConfirmProposal() {
  return useTaskMutation((body: {
    turn_id: string;
    tasks: ProposedTask[];
    edited_count: number;
    discarded_count: number;
  }) => api<Task[]>("/assistant/confirm", { method: "POST", body: JSON.stringify(body) }));
}

export function useRefreshCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<LogicalDay>("/days/current/refresh-calendar", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.day }),
  });
}

export function formatMinutes(total: number | null): string {
  if (total === null) return "-";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
