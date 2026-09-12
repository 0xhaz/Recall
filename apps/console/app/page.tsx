import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/guard';

export default async function Home() {
  const profile = await requireProfile();
  const first = profile.memberships[0];
  if (first) redirect(`/h/${first.household_id}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="panel p-6">
        <h1 className="text-lg font-semibold">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-slate-400">
          You are signed in as {profile.display_name}, but you are not part of a household. Ask whoever set up Recall at
          home to add you.
        </p>
      </div>
    </main>
  );
}
