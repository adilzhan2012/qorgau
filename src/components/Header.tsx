import Link from "next/link";

export type ConnectionState = "live" | "connecting" | "offline";

const CONNECTION: Record<ConnectionState, { label: string; dot: string; pill: string }> = {
  live: { label: "В эфире", dot: "bg-accent", pill: "bg-accent-soft text-accent" },
  connecting: { label: "Подключение", dot: "bg-warn", pill: "bg-warn-soft text-warn" },
  offline: { label: "Нет связи", dot: "bg-alarm", pill: "bg-alarm-soft text-alarm" },
};

interface HeaderProps {
  /** Omitted on pages that aren't showing live devices. */
  connection?: ConnectionState;
}

export function Header({ connection }: HeaderProps) {
  const state = connection ? CONNECTION[connection] : null;

  return (
    <header className="glass sticky top-0 z-40 shadow-card">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity duration-300 ease-apple hover:opacity-70"
        >
          <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true" className="shrink-0">
            <path
              d="M9 1 1.5 4v6.2c0 4.3 3 8 7.5 8.8 4.5-.8 7.5-4.5 7.5-8.8V4L9 1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
              className="text-ink"
            />
            <circle cx="9" cy="9.6" r="1.7" className="fill-accent" />
          </svg>
          {/* Two-tone wordmark */}
          <span className="text-[17px] font-semibold tracking-tight">
            Qor<span className="text-accent">gau</span>
          </span>
        </Link>

        <div className="flex items-center gap-4 text-[13px] text-muted sm:gap-6">
          {state ? (
            <>
              <Link
                href="/about"
                className="hidden transition-colors duration-300 ease-apple hover:text-ink sm:block"
              >
                О проекте
              </Link>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-300 ease-apple ${state.pill}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                {state.label}
              </span>
            </>
          ) : (
            <Link
              href="/"
              className="transition-colors duration-300 ease-apple hover:text-ink"
            >
              Карта
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
