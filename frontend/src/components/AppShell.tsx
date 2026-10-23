import { Outlet } from "react-router-dom";
import { COMPACT_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import type { User } from "../lib/types";
import { TabBar, TopBar } from "./Nav";

/**
 * The frame every authenticated screen sits in.
 *
 * It is deliberately not rendered for the unauthenticated states. Showing a
 * navigation bar above "Could not reach the API" would offer three rooms that
 * cannot be entered, and the sign-in screen has nowhere to navigate to at all.
 */
export function AppShell({ user }: { user: User }) {
  const compact = useMediaQuery(COMPACT_QUERY);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar user={user} withSections={!compact} />

      {/* The shell clears only the tab bar, and only where there is one. A
          screen with something floating over it reserves its own room: Today
          does, for the entry dock, and History and Settings would otherwise
          have carried 11rem of dead space for a control they do not show. */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-gutter pb-tabbar pt-8 sm:pb-10">
        <Outlet />
      </main>

      {compact && <TabBar />}
    </div>
  );
}
