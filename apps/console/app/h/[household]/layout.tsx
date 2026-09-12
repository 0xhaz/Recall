import { Hexagon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/actions';
import { Nav } from '@/components/nav';
import { requireMembership, requireProfile } from '@/lib/guard';
import { getPeople, getSettings } from '@/lib/recall';

export default async function HouseholdLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ household: string }>;
}) {
  const { household } = await params;
  const profile = await requireProfile();
  const membership = requireMembership(profile, household);
  const [settings, people] = await Promise.all([getSettings(household), getPeople(household)]);
  const caredFor = people.people.find((p) => p.role === 'cared_for');

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700/50 px-8 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Hexagon className="h-7 w-7 text-cyan-400" />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-xl font-bold text-transparent">
            RECALL
          </span>
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {profile.memberships.length > 1 ? (
            <div className="flex items-center gap-1">
              {profile.memberships.map((m) => (
                <Link
                  key={m.household_id}
                  href={`/h/${m.household_id}`}
                  className={`rounded-md px-2 py-1 text-xs ${
                    m.household_id === household
                      ? 'bg-slate-800/70 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {m.household_name}
                </Link>
              ))}
            </div>
          ) : (
            <span className="text-slate-400">{settings.name}</span>
          )}

          <span className="text-slate-500">
            {profile.display_name} · <span className="text-slate-400">{membership.role.replace('_', ' ')}</span>
          </span>
          <form action={signOutAction}>
            <button type="submit" className="text-xs text-slate-500 hover:text-slate-200">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-5.5rem)] max-w-[1800px] grid-cols-12 gap-8 px-8 py-8">
        <aside className="col-span-12 self-start md:col-span-3 lg:col-span-2">
          <div className="panel p-4">
            <Nav household={household} carePersonId={caredFor?.person_id ?? null} />
          </div>
          <p className="mt-4 px-3 text-xs leading-relaxed text-slate-500">
            {settings.name} · {settings.timezone}
            <br />
            Raw events kept {settings.retention_days} days
          </p>
        </aside>
        <main className="col-span-12 flex flex-col gap-8 md:col-span-9 lg:col-span-10">{children}</main>
      </div>
    </div>
  );
}
