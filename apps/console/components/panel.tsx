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
    <section className={`panel ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-slate-700/50 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              {Icon ? <Icon className="h-4 w-4 text-cyan-400" /> : null}
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
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
    <div className={`rounded-lg border bg-slate-800/40 p-4 ${tones[tone]}`}>
      <div className="label-xs">{label}</div>
      <div className="mt-1 font-mono text-2xl text-slate-100">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-400">{detail}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
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
