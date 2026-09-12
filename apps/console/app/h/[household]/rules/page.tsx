import { Ban, Shield } from 'lucide-react';
import { removeRuleAction } from '@/app/actions';
import { ActButton } from '@/components/act-button';
import { Empty, Panel, when } from '@/components/panel';
import { getRules } from '@/lib/recall';

const SEVERITY: Record<string, string> = {
  safety: 'border-red-500/40 text-red-300',
  hard: 'border-amber-500/40 text-amber-300',
  soft: 'border-slate-600/40 text-slate-300',
};

export default async function Rules({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const { rules, blocked } = await getRules(household);

  return (
    <div className="grid flex-1 gap-8 xl:grid-cols-2">
      <Panel
        title="Rules you have set"
        icon={Shield}
        subtitle="Kept in your own words. Rules are law here: they override anything Recall has learned."
      >
        {rules.length === 0 ? (
          <Empty>No rules yet. Say one to a device: “No music after 10pm on school nights.”</Empty>
        ) : (
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className={`flex items-start justify-between gap-4 rounded-lg border bg-slate-800/40 p-4 ${
                  SEVERITY[rule.severity] ?? SEVERITY.soft
                }`}
              >
                <div>
                  <p className="text-base text-slate-100">“{rule.text}”</p>
                  <p className="mt-1.5 text-sm text-slate-400">{rule.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {rule.author ? `set by ${rule.author}` : 'set by someone no longer here'} · {rule.severity}
                    {rule.expires_at ? ` · until ${rule.expires_at.slice(0, 10)}` : ''}
                  </p>
                </div>
                <ActButton
                  action={removeRuleAction}
                  fields={{ household, rule: rule.id }}
                  label="Remove"
                  pendingLabel="Removing…"
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="What your rules stopped"
        icon={Ban}
        subtitle="Every time a rule blocked something, with the rule that did it."
      >
        {blocked.length === 0 ? (
          <Empty>Nothing has been blocked.</Empty>
        ) : (
          <ul className="space-y-3">
            {blocked.map((item) => (
              <li key={item.action_id} className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-base text-slate-100">{item.summary}</p>
                  <span className="shrink-0 text-xs text-slate-500">{when(item.at)}</span>
                </div>
                <p className="mt-1 text-xs text-amber-300">
                  {item.rule ? `Blocked by your rule: “${item.rule.text}”` : null}
                  {item.withheld ? `Withheld: ${item.withheld.reason.replaceAll('_', ' ')}` : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.intent.replace('.', ' · ')}
                  {item.person ? ` · for ${item.person}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
