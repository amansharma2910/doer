export function SignIn({ href }: { href: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight">Doer</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          Four tasks a day. Finish three and the day counts.
        </p>

        <a
          href={href}
          className="mt-8 flex w-full items-center justify-center rounded-md border
                     border-[var(--color-line)] px-4 py-2.5 text-sm font-medium
                     transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        >
          Continue with Google
        </a>

        <p className="mt-4 text-xs leading-relaxed text-[var(--color-muted)]">
          Doer reads your calendar availability to work out how much time you
          actually have. It never reads event titles and never writes to your
          calendar.
        </p>
      </div>
    </div>
  );
}
