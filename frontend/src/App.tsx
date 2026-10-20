import { useQuery } from "@tanstack/react-query";
import { api, ApiError, loginUrl } from "./lib/api";
import type { User } from "./lib/types";
import { SignIn } from "./pages/SignIn";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const { data, isLoading, error } = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    retry: false,
  });

  if (isLoading) {
    return <Centered>Loading</Centered>;
  }

  if (error instanceof ApiError && error.status === 401) {
    return <SignIn href={loginUrl} />;
  }

  if (error) {
    return (
      <Centered>
        <p className="text-[var(--color-failure)]">
          Could not reach the API. Is it running on port 8000?
        </p>
      </Centered>
    );
  }

  return <Dashboard user={data!} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
      {children}
    </div>
  );
}
