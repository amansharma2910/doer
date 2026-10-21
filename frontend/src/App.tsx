import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/hooks";
import { ApiError, loginUrl } from "./lib/api";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";

export function App() {
  const { data: user, isPending, isPaused, error } = useMe();

  // `isPending`, not `isLoading`. The latter is `isPending && isFetching`, so a
  // query that is pending with no fetch in flight falls past the 401 branch into
  // the API-outage message below, blaming the server for the browser's
  // connection.
  if (isPaused) return <Centered>Offline. Waiting for a connection.</Centered>;
  if (isPending) return <Centered>Loading</Centered>;

  if (error instanceof ApiError && error.status === 401) {
    return <SignIn href={loginUrl} />;
  }

  if (error || !user) {
    return (
      <Centered>
        <p className="text-[var(--color-failure)]">
          Could not reach the API. Is it running on port 8787?
        </p>
      </Centered>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/settings" element={<Settings user={user} />} />
        <Route path="*" element={<Dashboard user={user} />} />
      </Routes>
    </BrowserRouter>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
      {children}
    </div>
  );
}
