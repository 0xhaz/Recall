import { Activity, AlertTriangle } from 'lucide-react';
import { decideRoutineAction } from '@/app/actions';
import { ActButton } from '@/components/act-button';
import { Empty, Panel } from '@/components/panel';
import { describeKind, hhmm, sentence } from '@/lib/format';
import { getRoutines, type Routine } from '@/lib/recall';

const HEALTH: Record<string, string> = {
  ok: 'text-slate-400',
  fading: 'text-amber-300',
  broken: 'text-red-300',
};

function RoutineCard({ household, routine, decide }: { household: string; routine: Routine; decide: boolean }) {
  return (
    <li className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-100">
            {sentence(describeKind(routine.kind))}{' '}
            <span className="text-slate-400">
              around {hhmm(routine.center_minute)} ± {routine.spread_minutes} min, {routine.days}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {routine.person ? `${routine.person} · ` : 'everyone · '}
            seen {routine.support} times · {Math.round(routine.confidence * 100)}% sure
            {routine.last_seen ? ` · last on ${routine.last_seen}` : ''}
            {routine.shifted_from !== null ? ` · moved from ${hhmm(routine.shifted_from)}` : ''}
          </p>
          {routine.sequence.length > 0 ? (
            <p className="mt-1 text-[11px] text-slate-500">
              then usually: {routine.sequence.map(describeKind).join(', ')}
            </p>
          ) : null}
          {routine.health !== 'ok' ? (
            <p className={`mt-1 flex items-center gap-1 text-xs ${HEALTH[routine.health]}`}>
              <AlertTriangle className="h-3.5 w-3.5" />
              {routine.health === 'broken' ? 'Not working' : 'Fading'}
              {routine.health_reason ? `: ${routine.health_reason}` : ''}
            </p>
          ) : null}
        </div>
        {decide ? (
          <div className="flex shrink-0 items-center gap-2">
            <ActButton
              action={decideRoutineAction}
              fields={{ household, routine: routine.id, decision: 'accept' }}
              label="Yes, that's right"
              className="border-cyan-600/50 text-cyan-300"
            />
            <ActButton
              action={decideRoutineAction}
              fields={{ household, routine: routine.id, decision: 'dismiss' }}
              label="No"
              variant="ghost"
            />
          </div>
        ) : (
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-slate-500">
            {routine.status}
          </span>
        )}
      </div>
    </li>
  );
}

export default async function Routines({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const { routines } = await getRoutines(household);
  const candidates = routines.filter((r) => r.status === 'candidate' || r.status === 'offered');
  const active = routines.filter((r) => r.status === 'active');
  const retired = routines.filter((r) => r.status === 'retired');

  return (
    <>
      <Panel
        title="Noticed, not yet confirmed"
        icon={Activity}
        subtitle="Patterns Recall spotted in what your devices reported. Nothing is acted on until you say so."
      >
        {candidates.length === 0 ? (
          <Empty>Nothing new noticed.</Empty>
        ) : (
          <ul className="space-y-3">
            {candidates.map((r) => (
              <RoutineCard key={r.id} household={household} routine={r} decide />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Your routines" subtitle="Confirmed, and watched for changes.">
        {active.length === 0 ? (
          <Empty>None confirmed yet.</Empty>
        ) : (
          <ul className="space-y-3">
            {active.map((r) => (
              <RoutineCard key={r.id} household={household} routine={r} decide={false} />
            ))}
          </ul>
        )}
      </Panel>

      {retired.length > 0 ? (
        <Panel title="Retired" subtitle="Not seen for a while, or dismissed. Kept so Recall doesn't ask again.">
          <ul className="space-y-3">
            {retired.map((r) => (
              <RoutineCard key={r.id} household={household} routine={r} decide={false} />
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
