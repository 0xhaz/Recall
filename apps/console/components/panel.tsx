import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** One card treatment for every section, so the console reads as one surface. */
export function Panel({
  title,
  icon: Icon,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: LucideIcon;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-slate-700/50 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-100">
              {Icon ? <Icon className="h-5 w-5 text-cyan-400" /> : null}
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {/* flex-1 so panels sitting side by side come out the same height, filling the page. */}
      <div className="flex-1 p-6">{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = 'cyan',
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'cyan' | 'amber' | 'violet' | 'slate';
}) {
  const tones = {
    cyan: 'border-cyan-500/30 text-cyan-300',
    amber: 'border-amber-500/30 text-amber-300',
    violet: 'border-violet-500/30 text-violet-300',
    slate: 'border-slate-600/40 text-slate-300',
  };
  return (
    <div className={`rounded-xl border bg-slate-800/40 p-5 ${tones[tone]}`}>
      <div className="label-xs">{label}</div>
      <div className="mt-1.5 font-mono text-4xl text-slate-100">{value}</div>
      {detail ? <div className="mt-1.5 text-sm text-slate-400">{detail}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  // Generous height: an empty panel beside a full one shouldn't look starved.
  return (
    <p className="flex h-full min-h-32 items-center justify-center py-10 text-center text-slate-500">{children}</p>
  );
}

/** Relative time, phrased the way a person would say it. */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
