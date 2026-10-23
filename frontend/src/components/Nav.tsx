import { NavLink } from "react-router-dom";
import { useLogout } from "../lib/hooks";
import type { User } from "../lib/types";

/** The three rooms. Today is the index; the order is run the day, review the
    record, change the shape. */
export const SECTIONS = [
  { to: "/today", label: "Today" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
] as const;

/** Shown at desktop widths. Carries the brand, the three sections, and the
    account controls on one line. */
export function TopBar({ user, withSections }: { user: User; withSections: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-tabbar max-w-2xl items-center gap-6 px-gutter">
        <span className="text-body font-medium tracking-tight">Doer</span>

        {withSections && (
          <nav aria-label="Sections" className="flex items-center gap-5">
            {SECTIONS.map((section) => (
              <SectionLink key={section.to} to={section.to} label={section.label} />
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-4 text-note text-muted">
          <span title={user.email} className="max-w-[12ch] truncate sm:max-w-none">
            {user.name ?? user.email}
          </span>
          <SignOut />
        </div>
      </div>
    </header>
  );
}

/** Shown below the breakpoint, where the top of the screen is the furthest
    point from a thumb. */
export function TabBar() {
  return (
    <nav
      aria-label="Sections"
      // `h-tabbar`, the same token the page padding and the entry dock use.
      className="fixed inset-x-0 bottom-0 z-20 h-tabbar border-t border-line
                 bg-paper/95 backdrop-blur"
    >
      <ul className="flex h-full items-stretch">
        {SECTIONS.map((section) => (
          <li key={section.to} className="flex-1">
            <SectionLink to={section.to} label={section.label} stacked />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One section link, in either navigation.
 *
 * `NavLink` sets `aria-current="page"` on the active route by itself, which is
 * what AC-IO-03 asks for; the class callback only adds the visible half of the
 * same statement. Both halves are needed: colour alone is not an accessible
 * indicator, so the active link is also weighted.
 */
function SectionLink({
  to,
  label,
  stacked = false,
}: {
  to: string;
  label: string;
  stacked?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          stacked
            ? "flex h-full items-center justify-center text-note"
            : "text-note transition-colors",
          isActive ? "font-medium text-ink" : "text-muted hover:text-ink",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

/** No confirmation: signing out destroys the session row, not any data, and
    signing back in is one click. */
function SignOut() {
  const logout = useLogout();
  return (
    <button
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className="transition-colors hover:text-ink disabled:opacity-40"
    >
      Sign out
    </button>
  );
}
