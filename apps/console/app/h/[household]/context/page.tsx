import { HeartPulse, Moon, Radio } from 'lucide-react';
import { Empty, Panel, when } from '@/components/panel';
import { percent } from '@/lib/format';
import { getContext } from '@/lib/recall';

export default async function Context({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const reading = await getContext(household);
  const sorted = [...reading.contexts].sort((a, b) => b.score - a.score);

  return (
    <>
      <Panel
        title="What Recall thinks is going on"
        icon={Radio}
        subtitle="Scores from what devices report. A context only counts once it holds, so a flight of stairs is not a workout."
      >
        {sorted.length === 0 ? (
          <Empty>No signals yet. Devices haven&rsquo;t reported anything Recall reads as context.</Empty>
        ) : (
          <ul className="space-y-4">
            {sorted.map((c) => (
              <li key={`${c.context}-${c.for}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-100">
                    {c.context.replace('_', '-')} <span className="text-slate-500">· {c.for}</span>
                    {c.active ? (
                      <span className="ml-2 rounded-full border border-cyan-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
                        on{c.manual ? ' · set by hand' : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs text-slate-400">{percent(c.score)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${c.active ? 'bg-gradient-to-r from-cyan-500 to-blue-500' : 'bg-slate-600'}`}
                    style={{ width: percent(c.score) }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {c.reasons.length > 0 ? c.reasons.join(', ') : 'nothing pointing that way'}
                  {c.active && c.since ? ` · since ${when(c.since)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 flex items-center gap-2 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          <Moon className="h-4 w-4 text-violet-300" />
          {reading.quiet_hours.active
            ? `Quiet hours: ${reading.quiet_hours.because.join(', ')}. Nothing is offered unprompted.`
            : 'Not quiet hours. Offers are allowed, one at a time.'}
        </p>
      </Panel>

      <Panel
        title="Thresholds"
        icon={HeartPulse}
        subtitle="Relative to each person, learned from their own readings. Raw heart rate is never kept beyond the retention window."
      >
        {reading.thresholds.length === 0 ? (
          <Empty>No baselines yet. They build up from a week of readings, or from saying “workout mode”.</Empty>
        ) : (
          <ul className="space-y-2">
            {reading.thresholds.map((t) => (
              <li key={t.person} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">{t.person}</span>
                <span className="font-mono text-xs text-slate-400">
                  resting {t.resting_hr ? `${Math.round(t.resting_hr)} bpm` : 'not enough readings'}
                  {t.ratio ? ` · counts as exercise at ${Math.round(t.ratio * 100)}% of resting` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
