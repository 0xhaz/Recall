import { Bell, HeartPulse, MessageCircleWarning } from 'lucide-react';
import { CarePolicyForm } from '@/components/care-policy-form';
import { Empty, Panel, when } from '@/components/panel';
import { describeKind, sentence } from '@/lib/format';
import { getCarePlan } from '@/lib/recall';

export default async function Care({ params }: { params: Promise<{ household: string; person: string }> }) {
  const { household, person } = await params;
  const plan = await getCarePlan(household, person);

  return (
    <>
      <Panel
        title={`How Recall speaks with ${plan.person.name}`}
        icon={MessageCircleWarning}
        subtitle="Correct for safety; reassure and turn elsewhere where correcting would only hurt. Your wording is used as you write it."
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
                <p className="text-sm text-slate-100">{sentence(policy.topic)}</p>
                <span
                  className={`font-mono text-[11px] uppercase tracking-wider ${
                    policy.policy === 'correct' ? 'text-amber-300' : 'text-violet-300'
                  }`}
                >
                  {policy.policy}
                  {policy.set_by === 'default' ? ' · built in' : ''}
                </span>
              </div>
              {policy.guidance ? <p className="mt-1 text-xs text-slate-400">{policy.guidance}</p> : null}
              <p className="mt-1 text-[11px] text-slate-500">brought up by: {policy.keywords.join(', ')}</p>
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

      <Panel title="Today" icon={HeartPulse} subtitle="Check-ins and what happened, from the last day and a half.">
        {plan.day.length === 0 ? (
          <Empty>Nothing recorded yet today.</Empty>
        ) : (
          <ul className="space-y-2">
            {plan.day.map((entry) => (
              <li key={`${entry.kind}-${entry.at}`} className="flex items-center justify-between text-sm">
                <span className={entry.ok ? 'text-slate-200' : 'text-red-300'}>
                  {sentence(describeKind(entry.kind))}
                  {entry.ok ? '' : ' (did not work)'}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
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
          <ul className="space-y-2">
            {plan.alerts.map((alert) => (
              <li key={`${alert.kind}-${alert.at}`} className="text-sm">
                <span className="text-slate-200">{alert.text}</span>
                <span className="ml-2 text-[11px] text-slate-500">
                  {alert.kind.replaceAll('_', ' ')} · {when(alert.at)}
                  {alert.acknowledged_at ? ' · seen' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="px-1 text-xs text-slate-500">
        {plan.person.name} is told plainly what is shared: Recall says so whenever she asks. Nothing here is a medical
        record, and no diagnosis is ever stored.
      </p>
    </>
  );
}
