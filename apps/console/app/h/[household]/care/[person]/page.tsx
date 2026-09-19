import { Activity, Bell, CalendarClock, HeartPulse, MessageCircleWarning, Pill } from 'lucide-react';
import { CarePolicyForm } from '@/components/care-policy-form';
import { ReminderForm, RemoveReminder, TodaysDoses } from '@/components/care-reminders';
import { DoseHistory } from '@/components/dose-history';
import { HouseholdClock } from '@/components/household-clock';
import { Empty, Panel, when } from '@/components/panel';
import { describeKind, sentence } from '@/lib/format';
import { ApiError, type CarePlan, getCarePlan } from '@/lib/recall';

/** A week of prompts is dozens of near-identical lines; the seven-day view carries the shape. */
const ALERTS_SHOWN = 8;

export default async function Care({ params }: { params: Promise<{ household: string; person: string }> }) {
  const { household, person } = await params;

  // The person comes straight from the URL, so "no such person" and "not yours to see" are ordinary
  // answers here, not crashes: Recall's own words, shown as written.
  let plan: CarePlan;
  try {
    plan = await getCarePlan(household, person);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <Panel title="Nothing to show here" icon={HeartPulse}>
        <p className="text-sm text-slate-300">{err.message}</p>
        <p className="mt-1 text-xs text-slate-500">
          Care pages exist only for someone being cared for in this household, and only for the people looking after
          them.
        </p>
      </Panel>
    );
  }

  const clock = `${plan.now.weekday}, ${new Date(`${plan.now.local_date}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })} at ${plan.now.local_time.slice(0, 5)}`;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          Looking after <span className="text-slate-100">{plan.person.name}</span>
        </p>
        <HouseholdClock timezone={plan.now.timezone} initial={clock} />
      </div>

      <div className="grid flex-1 gap-8 xl:grid-cols-2">
        <Panel
          title={`How Recall speaks with ${plan.person.name}`}
          icon={MessageCircleWarning}
          subtitle="Correct for safety; reassure and turn elsewhere where correcting would only hurt. Your wording is used as you write it."
          className="xl:row-span-2"
        >
          <ul className="space-y-3">
            {plan.policies.map((policy) => (
              <li
                key={policy.topic}
                className={`rounded-lg border bg-slate-800/40 p-4 ${
                  policy.policy === 'correct' ? 'border-amber-500/30' : 'border-violet-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base text-slate-100">{sentence(policy.topic)}</p>
                  <span
                    className={`font-mono text-xs uppercase tracking-wider ${
                      policy.policy === 'correct' ? 'text-amber-300' : 'text-violet-300'
                    }`}
                  >
                    {policy.policy}
                    {policy.set_by === 'default' ? ' · built in' : ''}
                  </span>
                </div>
                {policy.guidance ? <p className="mt-1.5 text-sm text-slate-400">{policy.guidance}</p> : null}
                <p className="mt-1 text-xs text-slate-500">brought up by: {policy.keywords.join(', ')}</p>
              </li>
            ))}
          </ul>

          {plan.can_edit ? (
            <div className="mt-5 border-t border-slate-700/50 pt-4">
              <CarePolicyForm household={household} person={plan.person.name} />
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Only a caregiver with the care-plan grant can change these.</p>
          )}
        </Panel>

        <Panel
          title="Medication and meals"
          icon={Pill}
          subtitle={`${plan.person.name} is asked on her own device when a dose is due. Confirming is hers to do — by voice or here — and the carers hear about it only if it goes unanswered.`}
        >
          {plan.doses.length === 0 ? (
            <Empty>Nothing on the schedule yet.</Empty>
          ) : (
            <TodaysDoses household={household} doses={plan.doses} />
          )}

          {plan.reminders.length > 0 ? (
            <ul className="mt-5 space-y-1.5 border-t border-slate-700/50 pt-4">
              {plan.reminders.map((reminder) => (
                <li key={reminder.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-300">
                    {reminder.label}
                    {reminder.dose ? <span className="text-slate-500"> · {reminder.dose}</span> : null}
                    <span className="ml-2 font-mono text-xs text-slate-500">
                      {reminder.times.join(', ')}
                      {reminder.days === 'daily' ? '' : ` · ${reminder.days}`}
                    </span>
                  </span>
                  {plan.can_edit ? <RemoveReminder household={household} reminder={reminder} /> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {plan.can_edit ? (
            <div className="mt-5 border-t border-slate-700/50 pt-4">
              <ReminderForm household={household} person={plan.person.name} />
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              Only a caregiver with the care-plan grant can change the schedule.
            </p>
          )}
        </Panel>

        {plan.vitals ? (
          <Panel
            title="Worn tracker"
            icon={Activity}
            subtitle="The last readings from what she is wearing. Numbers and times only — Recall reads nothing into them, and stores no diagnosis."
          >
            <div className="flex flex-wrap gap-8">
              {plan.vitals.bpm !== null ? (
                <div>
                  <p className="label-xs">Heart rate</p>
                  <p className="text-3xl text-slate-100">
                    {plan.vitals.bpm} <span className="text-base text-slate-500">bpm</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {plan.vitals.resting === null
                      ? 'not enough readings yet for her usual resting rate'
                      : `her usual resting rate is ${plan.vitals.resting}`}
                    {plan.vitals.at ? ` · ${when(plan.vitals.at)}` : ''}
                  </p>
                </div>
              ) : null}
              {plan.vitals.moving !== null ? (
                <div>
                  <p className="label-xs">Movement</p>
                  <p className="text-3xl text-slate-100">{plan.vitals.moving ? 'Up and about' : 'Still'}</p>
                  <p className="text-xs text-slate-500">
                    {plan.vitals.moved_at ? when(plan.vitals.moved_at) : ''}
                    {plan.vitals.device ? ` · ${plan.vitals.device}` : ''}
                  </p>
                </div>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              A tracker says where someone is and how they are moving, which is exactly why it is worth saying plainly:{' '}
              {plan.person.name} is told this is being shared, and can have it switched off.
            </p>
          </Panel>
        ) : null}

        <Panel title="Today" icon={HeartPulse} subtitle="Check-ins and what happened, from the last day and a half.">
          {plan.day.length === 0 ? (
            <Empty>Nothing recorded yet today.</Empty>
          ) : (
            <ul className="space-y-2">
              {plan.day.map((entry) => (
                <li key={`${entry.kind}-${entry.at}`} className="flex items-center justify-between text-base">
                  <span className={entry.ok ? 'text-slate-200' : 'text-red-300'}>
                    {sentence(describeKind(entry.kind))}
                    {entry.ok ? '' : ' (did not work)'}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {new Date(entry.at).toISOString().slice(11, 16)} · {when(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Alerts" icon={Bell} subtitle="What reached the carers, and when.">
          {plan.alerts.length === 0 ? (
            <Empty>Nothing has needed attention.</Empty>
          ) : (
            <>
              <ul className="space-y-2">
                {/* Newest first, and only a handful: a week of prompts and misses is dozens of near-identical
                    lines, and burying today's alert in them is the opposite of what this panel is for. The
                    week's shape belongs in "The last seven days" below. */}
                {plan.alerts.slice(0, ALERTS_SHOWN).map((alert) => (
                  <li key={`${alert.kind}-${alert.at}`} className="text-base">
                    <span className="text-slate-200">{alert.text}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {alert.kind.replaceAll('_', ' ')} · {when(alert.at)}
                      {alert.acknowledged_at ? ' · seen' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.alerts.length > ALERTS_SHOWN ? (
                <p className="mt-3 text-xs text-slate-500">
                  {plan.alerts.length - ALERTS_SHOWN} older{' '}
                  {plan.alerts.length - ALERTS_SHOWN === 1 ? 'alert' : 'alerts'} in the last week. Every dose they refer
                  to is in the seven-day view below.
                </p>
              ) : null}
            </>
          )}
        </Panel>

        <Panel
          title="The last seven days"
          icon={CalendarClock}
          subtitle={`Every dose that was due, and whether anyone said it was taken. This is where a missed morning shows up.`}
          className="xl:col-span-2"
        >
          {plan.history.length === 0 ? <Empty>Nothing has been due yet.</Empty> : <DoseHistory days={plan.history} />}
        </Panel>

        <p className="px-1 text-xs text-slate-500 xl:col-span-2">
          {plan.person.name} is told plainly what is shared: Recall says so whenever she asks. Nothing here is a medical
          record, and no diagnosis is ever stored.
        </p>
      </div>
    </div>
  );
}
