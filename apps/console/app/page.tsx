import { Database, Fingerprint, HeartPulse, Hexagon, Radio, Shield, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, getProfile, type Profile } from '@/lib/recall';

// The front door. Anyone can open it: someone arriving at the console for the first time should be
// told what Recall is before being asked for an email address. A signed-in person skips all of it.

const CLAIMS = [
  {
    icon: Fingerprint,
    title: 'It knows who is talking',
    body: 'Ask the same question as two different people and you get two different answers. Below the voice-match threshold nobody is guessed at: it asks.',
  },
  {
    icon: Shield,
    title: 'Rules are law',
    body: 'A rule you state is followed word for word, and outranks anything Recall has learned. Conflicts are reported, never quietly resolved.',
  },
  {
    icon: Trash2,
    title: 'Forgetting reaches every device',
    body: 'Forget something and a tombstone follows it everywhere, erasing the words from the fact, its history, and the events behind it. It does not come back.',
  },
  {
    icon: Database,
    title: 'Every fact says where it came from',
    body: 'Source, confidence and date on all of it. Correct one and the old wording is kept as history rather than overwritten.',
  },
  {
    icon: Radio,
    title: 'Context, with its reasons',
    body: 'Thresholds are learned per person, against their own resting rate — so a flight of stairs is not a workout.',
  },
  {
    icon: HeartPulse,
    title: 'Care mode inverts the defaults',
    body: 'For someone being cared for, only what a caregiver entered is ever said back. A repeated question gets the same warm answer, never "I already told you".',
  },
];

export default async function Home() {
  // Not a guard: the page is public, and a signed-in visitor simply goes where they were going.
  let profile: Profile | null = null;
  try {
    profile = await getProfile();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  if (profile) {
    const first = profile.memberships[0];
    if (first) redirect(`/h/${first.household_id}`);
    // Signed in, but in no household: say so plainly rather than showing them the front door again.
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Nothing to show yet</h1>
          <p className="mt-2 text-sm text-slate-400">
            You are signed in as {profile.display_name}, but you are not part of a household. Ask whoever set up Recall
            at home to add you.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Hexagon className="h-7 w-7 text-cyan-400" />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-xl font-bold text-transparent">
            RECALL
          </span>
        </div>
        <Link
          href="/sign-in"
          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          Sign in
        </Link>
      </header>

      <section className="mt-16 sm:mt-24">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-slate-100 sm:text-5xl">
          A memory that belongs to the people it is about.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-400">
          Recall is a memory layer for Alexa+ and any other assistant, served over MCP. Per-person, inspectable,
          editable and forgettable — and the same on every device in the house.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
          >
            Open your console
          </Link>
          <span className="text-sm text-slate-500">A sign-in link, no password.</span>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2">
        {CLAIMS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="panel p-6">
            <Icon className="h-5 w-5 text-cyan-400" />
            <h2 className="mt-3 text-base font-semibold text-slate-100">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</p>
          </div>
        ))}
      </section>

      <section className="panel mt-4 p-6">
        <Undo2 className="h-5 w-5 text-cyan-400" />
        <h2 className="mt-3 text-base font-semibold text-slate-100">Nothing is done on your behalf unquestioned</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-400">
          Anything ordered, booked, played or changed is checked against your rules first, recorded with what it was
          asked to do, and can be undone while the window is open. Anything that costs money is only ever drafted for
          you to confirm. And when Recall has nothing on file, it says so rather than inventing an answer.
        </p>
      </section>

      <footer className="mt-16 border-t border-slate-800 pt-6 text-xs text-slate-500">
        <p>
          The console shows what is held about you and everyone in your household, where each fact came from, and what
          Recall has done. Everything in it can be corrected, forgotten or exported.
        </p>
      </footer>
    </main>
  );
}
