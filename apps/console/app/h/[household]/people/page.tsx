import { Users } from 'lucide-react';
import { Panel } from '@/components/panel';
import { AddPerson, RemovePerson } from '@/components/people-admin';
import { requireMembership, requireProfile } from '@/lib/guard';
import { getPeople } from '@/lib/recall';

const ROLES: Record<string, string> = {
  owner: 'set up the household',
  adult: 'full member',
  child: 'a parent can see and delete their memory',
  guest: 'nothing is stored',
  caregiver: 'looks after someone here',
  cared_for: 'cared for: hears only what a caregiver entered',
};

const GRANTS: Record<string, string> = {
  view_daily: 'sees check-ins and the daily view',
  edit_care_plan: 'sets the care plan',
  enter_facts: 'can enter facts for them',
  set_rules: 'can set rules for them',
  view_full_memory: 'sees their whole memory',
};

export default async function People({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const [{ people }, profile] = await Promise.all([getPeople(household), requireProfile()]);
  const me = requireMembership(profile, household);
  // The owner manages the household; a cared-for person may also let their own caregiver go.
  const canRemove = (role: string) =>
    role !== 'owner' && (me.role === 'owner' || (role === 'caregiver' && me.role === 'cared_for'));

  return (
    <Panel
      title="Who is here, and what each of them can see"
      icon={Users}
      subtitle="Memory is scoped by person. Nobody sees someone else's personal memory unless it was granted plainly."
    >
      <ul className="divide-y divide-slate-700/40">
        {people.map((person) => (
          <li key={person.person_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="text-sm text-slate-100">
                {person.name}
                <span className="ml-2 font-mono text-xs uppercase tracking-wider text-cyan-300">
                  {person.role.replace('_', ' ')}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{ROLES[person.role] ?? ''}</p>
              {person.grants.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                  {person.grants.map((grant) => (
                    <li key={grant}>· {GRANTS[grant] ?? grant}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="max-w-xs text-right">
              <p className="text-xs text-slate-500">{person.sees}</p>
              {canRemove(person.role) ? (
                <div className="mt-1">
                  <RemovePerson household={household} personId={person.person_id} name={person.name} />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {me.role === 'owner' ? <AddPerson household={household} /> : null}

      <p className="mt-4 text-xs text-slate-500">
        Guests are in ephemeral mode: Recall answers from household memory but stores nothing they say. A caregiver only
        ever sees the person they look after, and only what their grants allow.
      </p>
    </Panel>
  );
}
