/**
 * Loading, empty and problem states, in one place.
 *
 * Before this each screen improvised: the bare string "Loading", the bare
 * string "Nothing planned yet", and a red sentence about port 8787. Three
 * screens inventing three treatments is most of what "it looks accumulated"
 * meant. AC-IO-26.
 */

/** Work in flight. Deliberately plain text rather than a spinner: a spinner is
    motion, and most of these resolve inside a frame on a local API. */
export function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="py-8 text-body text-muted">
      {children}
    </p>
  );
}

/** Nothing here yet, with the thing to do about it. An empty state that does
    not say what to do next is just a blank area. */
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-8">
      <p className="text-body">{title}</p>
      {children && (
        <p className="mt-1 max-w-prose text-note leading-relaxed text-muted">{children}</p>
      )}
    </div>
  );
}

/** Something went wrong. One treatment for every failure, so an API outage and
    a refused request do not look like they come from different applications. */
export function Problem({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div role="alert" className="py-8">
      <p className="text-body text-failure">{title}</p>
      {children && (
        <p className="mt-1 max-w-prose text-note leading-relaxed text-muted">{children}</p>
      )}
    </div>
  );
}
