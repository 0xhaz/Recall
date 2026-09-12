import { Database, Search } from 'lucide-react';
import { FactRow } from '@/components/fact-row';
import { Empty, Panel } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getFacts, getPeople } from '@/lib/recall';

const STATES = [
  { value: 'current', label: 'Held now' },
  { value: 'superseded', label: 'Replaced' },
  { value: 'forgotten', label: 'Forgotten' },
  { value: 'all', label: 'Everything' },
];

export default async function Memory({
  params,
  searchParams,
}: {
  params: Promise<{ household: string }>;
  searchParams: Promise<{ query?: string; state?: string; person?: string }>;
}) {
  const { household } = await params;
  const filters = await searchParams;
  const [{ facts }, { people }] = await Promise.all([getFacts(household, filters), getPeople(household)]);
  const state = filters.state ?? 'current';

  return (
    <Panel
      title="What Recall remembers"
      icon={Database}
      subtitle="Every fact it holds for you, where it came from, and how sure it is. Fix or forget any of them."
    >
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            name="query"
            defaultValue={filters.query ?? ''}
            placeholder="Search remembered facts…"
            className="pl-8"
          />
        </div>
        <select
          name="person"
          defaultValue={filters.person ?? ''}
          className="h-10 rounded-md border border-slate-700 bg-slate-900/60 px-3 text-sm text-slate-200"
        >
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.person_id} value={p.person_id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          name="state"
          defaultValue={state}
          className="h-10 rounded-md border border-slate-700 bg-slate-900/60 px-3 text-sm text-slate-200"
        >
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <div className="-mx-5 border-t border-slate-700/50">
        {facts.length === 0 ? (
          <Empty>{filters.query ? `Nothing matches “${filters.query}”.` : 'Nothing is remembered here yet.'}</Empty>
        ) : (
          <ul className="divide-y divide-slate-700/40">
            {facts.map((fact) => (
              <FactRow key={fact.id} household={household} fact={fact} />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        You see household memory and your own. Someone else&rsquo;s personal memory stays theirs, unless they are a
        child you look after or you are their caregiver with full access.
      </p>
    </Panel>
  );
}
