import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  HeatmapCell,
  LogicalDay,
  PreferenceBlock,
  ProposedTask,
  Task,
  User,
} from "./types";

export const keys = {
  me: ["me"] as const,
  day: ["day", "current"] as const,
  tasks: ["tasks"] as const,
  blocks: ["blocks"] as const,
  heatmap: (start: string, end: string) => ["heatmap", start, end] as const,
};

export function useMe() {
  return useQuery<User>({ queryKey: keys.me, queryFn: () => api<User>("/auth/me"), retry: false });
}

export function useDay() {
  return useQuery<LogicalDay>({
    queryKey: keys.day,
    queryFn: () => api<LogicalDay>("/days/current"),
    retry: false,
  });
}

export function useTasks() {
  return useQuery<Task[]>({ queryKey: keys.tasks, queryFn: () => api<Task[]>("/tasks") });
}

export function useBlocks() {
  return useQuery<PreferenceBlock[]>({
    queryKey: keys.blocks,
    queryFn: () => api<PreferenceBlock[]>("/settings/blocks"),
  });
}

export function useHeatmap(start: string, end: string) {
  return useQuery<HeatmapCell[]>({
    queryKey: keys.heatmap(start, end),
    queryFn: () => api<HeatmapCell[]>(`/days/heatmap/range?start=${start}&end=${end}`),
  });
}

/** Any task mutation can move capacity, so the day refetches alongside. */
function useTaskMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
      queryClient.invalidateQueries({ queryKey: keys.day });
      queryClient.invalidateQueries({ queryKey: ["heatmap"] });
    },
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
  return useTaskMutation(({ id, ...body }: { id: string; estimate_minutes?: number; title?: string }) =>
    api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
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
