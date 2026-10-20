import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { LogicalDay, User } from "../lib/types";

export function Dashboard({ user }: { user: User }) {
  const { data: day, error } = useQuery<LogicalDay>({
    queryKey: ["day", "current"],
    queryFn: () => api<LogicalDay>("/days/current"),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">Doer</h1>
        <span className="text-xs text-[var(--color-muted)]">{user.email}</span>
      </header>

      {error instanceof ApiError && error.status === 409 ? (
        <OutsideDay message={error.message} />
      ) : day ? (
        <DaySummary day={day} />
      ) : null}
    </div>
  );
}

function DaySummary({ day }: { day: LogicalDay }) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">{day.anchor_date}</h2>
        {day.is_at_risk && <RiskDot />}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <Row label="Day length" value={`${formatMinutes(day.duration_minutes)}`} />
        <Row
          label="Capacity"
          value={
            day.is_indeterminate
              ? "Not yet known"
              : formatMinutes(day.capacity_base_minutes ?? 0)
          }
        />
        <Row
          label="Threshold"
          value={
            day.is_indeterminate ? "-" : formatMinutes(day.threshold_minutes ?? 0)
          }
        />
        <Row label="Committed" value={formatMinutes(day.committed_minutes)} />
      </dl>

      {day.indeterminate_reason === "no_focus_blocks" && (
        <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted)]">
          Define at least one work or personal project block in settings, and Doer
          can work out how much you can realistically take on.
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}

/** The entire over-commitment signal: a colour, never an interruption. */
function RiskDot() {
  return (
    <span
      title="More committed than this day realistically holds"
      className="inline-block h-2 w-2 rounded-full bg-[var(--color-risk)]"
    />
  );
}

function OutsideDay({ message }: { message: string }) {
  return (
    <p className="mt-10 text-sm leading-relaxed text-[var(--color-muted)]">{message}</p>
  );
}

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
