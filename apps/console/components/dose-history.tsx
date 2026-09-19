import { Check, CircleAlert, CircleHelp } from 'lucide-react';
import type { DoseDay } from '@/lib/recall';

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The days behind today. "No record" is shown as its own thing, never folded into "missed":
 * nothing was logged, which is not the same as nothing was taken (design.md §5).
 */
export function DoseHistory({ days }: { days: DoseDay[] }) {
  const missed = days.reduce((n, d) => n + d.missed, 0);
  const unrecorded = days.reduce((n, d) => n + d.unrecorded, 0);

  return (
    <div>
      <p className="text-sm text-slate-300">
        {missed === 0 ? (
          'Every dose was confirmed over the last week.'
        ) : (
          <>
            <span className="text-amber-300">
              {missed} {missed === 1 ? 'dose went' : 'doses went'} unconfirmed
            </span>{' '}
            in the last week.
          </>
        )}
        {unrecorded > 0 ? ` ${unrecorded} had no record either way.` : ''}
      </p>

      <ul className="mt-3 divide-y divide-slate-700/40">
        {days.map((day) => (
          <li key={day.date} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
            <span className="w-28 shrink-0 font-mono text-xs text-slate-400">
              {DAY.format(new Date(`${day.date}T00:00:00Z`))}
            </span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {day.doses.map((dose) => (
                <li key={`${dose.due}-${dose.label}`} className="flex items-center gap-1.5 text-xs">
                  {dose.status === 'confirmed' ? (
                    <Check className="h-3.5 w-3.5 text-cyan-400" />
                  ) : dose.status === 'no_record' ? (
                    <CircleHelp className="h-3.5 w-3.5 text-slate-500" />
                  ) : (
                    <CircleAlert className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  <span className="font-mono text-slate-400">{dose.due}</span>
                  <span
                    className={
                      dose.status === 'confirmed'
                        ? 'text-slate-400'
                        : dose.status === 'no_record'
                          ? 'text-slate-500'
                          : 'text-amber-300'
                    }
                  >
                    {dose.label}
                    {dose.status === 'confirmed' && dose.how ? (
                      <span className="text-slate-600"> · {dose.how === 'voice' ? 'said so' : `by ${dose.by}`}</span>
                    ) : null}
                    {dose.status === 'no_record' ? <span className="text-slate-600"> · no record</span> : null}
                    {dose.status === 'unanswered' ? <span className="text-slate-600"> · never answered</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        A dose is only ever <span className="text-slate-400">confirmed</span> because someone said so — by voice, or a
        carer here. Unconfirmed means nobody answered, <em>not</em> that it was skipped, and no record means nothing was
        logged at all. Recall will not guess the difference.
      </p>
    </div>
  );
}
