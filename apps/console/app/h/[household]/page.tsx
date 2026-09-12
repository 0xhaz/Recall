import { Activity, Database, Moon, Radio, Shield, Zap } from 'lucide-react';
import Link from 'next/link';
import { Empty, Metric, Panel } from '@/components/panel';
import { getNotices, getOverview } from '@/lib/recall';

export default async function Overview({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const [overview, notices] = await Promise.all([getOverview(household), getNotices(household)]);
  const { counts } = overview;
  const active = overview.contexts.filter((c) => c.active);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Facts held" value={counts.facts} detail={`${counts.forgotten} forgotten for good`} />
        <Metric
          label="Rules in force"
          value={counts.rules}
          detail={`${counts.blocked_today} blocked today`}
          tone="amber"
        />
        <Metric
          label="Routines"
          value={counts.routines}
          detail={`${counts.candidates} waiting, ${counts.broken} needing attention`}
          tone="violet"
        />
        <Metric
          label="Actions today"
          value={counts.actions_today}
          detail={`${counts.pending} statements pending`}
          tone="slate"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="What's going on" icon={Radio} subtitle="Live context, recomputed from what devices report">
          {active.length === 0 ? (
            <Empty>Nothing in particular right now.</Empty>
          ) : (
            <ul className="space-y-3">
              {active.map((c) => (
                <li key={`${c.context}-${c.for}`} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-100">
                      {c.context.replace('_', '-')} <span className="text-slate-500">· {c.for}</span>
                    </div>
                    <div className="text-xs text-slate-400">{c.reasons.join(', ')}</div>
                  </div>
                  <span className="font-mono text-xs text-cyan-300">{Math.round(c.score * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
          {overview.quiet_hours.active ? (
            <p className="mt-4 flex items-center gap-2 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
              <Moon className="h-4 w-4 text-violet-300" />
              Quiet hours: {overview.quiet_hours.because.join(', ')}. Nothing is offered unprompted.
            </p>
          ) : null}
        </Panel>

        <Panel title="Lately" icon={Activity} subtitle="Check-ins, prompts and alerts sent to the household">
          {notices.notices.length === 0 ? (
            <Empty>No messages yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {notices.notices.slice(0, 6).map((n) => (
                <li key={n.id} className="text-sm">
                  <span className="text-slate-200">{n.text}</span>
                  <span className="ml-2 font-mono text-xs uppercase tracking-wider text-slate-500">{n.audience}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Start here" icon={Database}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href={`/h/${household}/memory`}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 hover:border-cyan-500/40"
          >
            <div className="flex items-center gap-2 text-sm text-slate-100">
              <Database className="h-4 w-4 text-cyan-400" /> Check what is remembered
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Every fact with where it came from. Fix or delete any of them.
            </p>
          </Link>
          <Link
            href={`/h/${household}/rules`}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 hover:border-cyan-500/40"
          >
            <div className="flex items-center gap-2 text-sm text-slate-100">
              <Shield className="h-4 w-4 text-amber-400" /> See what your rules stopped
            </div>
            <p className="mt-1 text-xs text-slate-400">Rules are law here: what they blocked, and why.</p>
          </Link>
          <Link
            href={`/h/${household}/actions`}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4 hover:border-cyan-500/40"
          >
            <div className="flex items-center gap-2 text-sm text-slate-100">
              <Zap className="h-4 w-4 text-violet-400" /> Review what was done for you
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Everything done on your behalf, and undo while the window is open.
            </p>
          </Link>
        </div>
      </Panel>
    </>
  );
}
