'use client';

import { Check } from 'lucide-react';
import { useActionState } from 'react';
import { confirmDoseAction, removeReminderAction, setReminderAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DueDose, Reminder } from '@/lib/recall';

// A dose is confirmed, never assumed. Marking one here records who said so and that it came from
// the console rather than from the person's own voice — the difference is kept, and shown.

const STATUS: Record<DueDose['status'], { label: string; tone: string }> = {
  confirmed: { label: 'taken', tone: 'text-emerald-300' },
  pending: { label: 'waiting', tone: 'text-amber-300' },
  missed: { label: 'not confirmed', tone: 'text-red-300' },
  skipped: { label: 'skipped', tone: 'text-slate-400' },
  not_due: { label: 'later today', tone: 'text-slate-500' },
};

function ConfirmButton({ household, dose }: { household: string; dose: DueDose }) {
  const [state, submit, pending] = useActionState(confirmDoseAction, {});
  if (!dose.log_id) return null;

  return (
    <form action={submit} className="flex items-center gap-2">
      <input type="hidden" name="household" value={household} />
      <input type="hidden" name="dose" value={dose.log_id} />
      <Button
        type="submit"
        disabled={pending}
        variant="ghost"
        className="h-7 px-2 text-xs text-emerald-300 hover:bg-emerald-500/10"
      >
        <Check className="mr-1 h-3 w-3" />
        {pending ? 'Recording…' : 'Mark taken'}
      </Button>
      {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
    </form>
  );
}

export function TodaysDoses({ household, doses }: { household: string; doses: DueDose[] }) {
  return (
    <ul className="space-y-2">
      {doses.map((dose) => {
        const status = STATUS[dose.status];
        return (
          <li
            key={`${dose.reminder_id}-${dose.due}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-3"
          >
            <div>
              <p className="text-base text-slate-100">
                <span className="font-mono text-sm text-slate-400">{dose.due}</span> · {dose.label}
                {dose.dose ? <span className="text-slate-400"> ({dose.dose})</span> : null}
              </p>
              <p className={`text-xs ${status.tone}`}>
                {status.label}
                {dose.confirmed_at
                  ? ` · ${dose.how === 'voice' ? 'said so herself' : `recorded by ${dose.by ?? 'a carer'}`}`
                  : ''}
              </p>
              {dose.note ? <p className="mt-1 text-xs text-slate-500">“{dose.note}”</p> : null}
            </div>
            {dose.status === 'pending' || dose.status === 'missed' ? (
              <ConfirmButton household={household} dose={dose} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ReminderForm({ household, person }: { household: string; person: string }) {
  const [state, submit, pending] = useActionState(setReminderAction, {});

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="household" value={household} />
      <input type="hidden" name="person" value={person} />
      <p className="text-sm text-slate-200">Add to the schedule</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="label" className="text-slate-300">
            What to take
          </Label>
          <Input id="label" name="label" placeholder="Blood pressure tablet" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dose" className="text-slate-300">
            How much
          </Label>
          <Input id="dose" name="dose" placeholder="one tablet" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="times" className="text-slate-300">
            When (comma separated)
          </Label>
          <Input id="times" name="times" placeholder="08:00, 20:00" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="escalate" className="text-slate-300">
            Tell the carers after (minutes)
          </Label>
          <Input id="escalate" name="escalate" type="number" min={5} max={240} defaultValue={30} />
        </div>
      </div>

      <fieldset className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <legend className="label-xs mb-1">Which days</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="days" value="daily" defaultChecked /> Every day
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="days" value="weekdays" /> Weekdays
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="days" value="weekends" /> Weekends
        </label>
      </fieldset>

      <Button type="submit" disabled={pending} className="bg-cyan-600 text-white hover:bg-cyan-500">
        {pending ? 'Saving…' : 'Save reminder'}
      </Button>
      {state.error ? <p className="text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}

export function RemoveReminder({ household, reminder }: { household: string; reminder: Reminder }) {
  const [state, submit, pending] = useActionState(removeReminderAction, {});

  return (
    <form action={submit}>
      <input type="hidden" name="household" value={household} />
      <input type="hidden" name="reminder" value={reminder.id} />
      <Button type="submit" variant="ghost" disabled={pending} className="h-7 px-2 text-xs text-slate-400">
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
    </form>
  );
}
