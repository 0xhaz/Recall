import { Undo2, Zap } from 'lucide-react';
import { undoActionAction } from '@/app/actions';
import { ActButton } from '@/components/act-button';
import { Empty, Panel, when } from '@/components/panel';
import { getActions } from '@/lib/recall';

const STATUS: Record<string, string> = {
  executed: 'text-cyan-300',
  offered: 'text-slate-300',
  checked: 'text-slate-400',
  dismissed: 'text-slate-500',
  blocked: 'text-red-300',
  undone: 'text-violet-300',
};

export default async function Actions({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const { actions } = await getActions(household);

  return (
    <Panel
      title="Done on your behalf"
      icon={Zap}
      subtitle="Everything Recall checked, offered or carried out, with what it asked you first — and undo while the window is open."
    >
      {actions.length === 0 ? (
        <Empty>Nothing has been done for you yet.</Empty>
      ) : (
        <ul className="-mx-5 divide-y divide-slate-700/40 border-t border-slate-700/50">
          {actions.map((action) => (
            <li key={action.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-100">{action.summary}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span className={`font-mono uppercase tracking-wider ${STATUS[action.status] ?? 'text-slate-400'}`}>
                    {action.status}
                  </span>
                  <span>{action.intent.replace('.', ' · ')}</span>
                  {action.person ? <span>for {action.person}</span> : null}
                  <span>{when(action.at)}</span>
                  {action.proactive ? <span className="text-violet-300">offered ({action.tier})</span> : null}
                  {action.source?.text ? <span>because: {action.source.text}</span> : null}
                </p>
                {action.confirmed.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-300">
                    {action.confirmed.map((item) => (
                      <li key={item}>asked first: {item}</li>
                    ))}
                  </ul>
                ) : null}
                {action.blocked_by ? (
                  <p className="mt-1 text-xs text-red-300">blocked by your rule: “{action.blocked_by.text}”</p>
                ) : null}
              </div>

              <div className="shrink-0">
                {action.undoable ? (
                  <ActButton
                    action={undoActionAction}
                    fields={{ household, action: action.id }}
                    label="Undo"
                    pendingLabel="Undoing…"
                    className="border-violet-500/40 text-violet-200"
                  />
                ) : action.status === 'undone' ? (
                  <span className="flex items-center gap-1 text-xs text-violet-300">
                    <Undo2 className="h-3 w-3" /> undone
                  </span>
                ) : action.undo_until ? (
                  <span className="text-xs text-slate-600">window closed</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
