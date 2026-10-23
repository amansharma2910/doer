import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Problem, Waiting } from "./components/states";
import { useMe } from "./lib/hooks";
import { ApiError, loginUrl } from "./lib/api";
import type { User } from "./lib/types";
import { DayDetail } from "./pages/DayDetail";
import { History } from "./pages/History";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { Today } from "./pages/Today";

export function App() {
  const { data: user, isPending, isPaused, error } = useMe();

  // The order of these four gates is load-bearing and is tested, not assumed.
  //
  // `isPending`, not `isLoading`. The latter is `isPending && isFetching`, so a
  // query that is pending with no fetch in flight falls past the 401 branch into
  // the API-outage message below, blaming the server for the browser's
  // connection.
  //
  // None of the four renders the shell. A navigation bar above "Could not reach
  // the API" would offer three rooms that cannot be entered.
  if (isPaused) {
    return (
      <Centered>
        <Waiting>Offline. Waiting for a connection.</Waiting>
      </Centered>
    );
  }
  if (isPending) {
    return (
      <Centered>
        <Waiting>Loading your day.</Waiting>
      </Centered>
    );
  }

  if (error instanceof ApiError && error.status === 401) {
    return <SignIn href={loginUrl} />;
  }

  if (error || !user) {
    return (
      <Centered>
        <Problem title="Could not reach the API.">
          Doer expects it on port 8787. If you are running it with Docker, check
          that the api container is up.
        </Problem>
      </Centered>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes user={user} />
    </BrowserRouter>
  );
}

/**
 * The route tree, without a router around it.
 *
 * Separated so a test can mount it inside a `MemoryRouter` and drive the
 * address directly. Keeping `BrowserRouter` in `App` means the real entry point
 * is unchanged.
 */
export function AppRoutes({ user }: { user: User }) {
  return (
    <Routes>
      <Route element={<AppShell user={user} />}>
        {/* Today is the index. `/` and anything unrecognised land there, and
            both rewrite the address rather than serving Today under a path
            that is not its own. */}
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<Today />} />
        <Route path="/history" element={<History />} />
        {/* A real route, so one day is linkable and survives a reload. A
            drawer would have been neither. ADR 0003. */}
        <Route path="/history/:anchor" element={<DayDetail />} />
        <Route path="/settings" element={<Settings user={user} />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-gutter text-body text-muted">
      {children}
    </div>
  );
}
