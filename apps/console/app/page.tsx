import {
  ArrowRight,
  BellRing,
  Check,
  Fingerprint,
  HeartPulse,
  Hexagon,
  Mic,
  Radio,
  Shield,
  Trash2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProductHero } from '@/components/product-hero';
import { Reveal } from '@/components/reveal';
import { ApiError, getProfile, type Profile } from '@/lib/recall';

// The front door. Anyone can open it: someone arriving for the first time should be told what
// Recall is before being asked for an email address. A signed-in person never sees it.
//
// Every exchange quoted below is a real reply from the deployed assistant (Nova Lite on Bedrock),
// measured 2026-09-15 — not copy written to sound good. If the behaviour changes, this page is
// wrong and should be re-measured rather than reworded.

const SAID = [
  {
    who: 'Aisyah',
    role: 'vegetarian',
    tone: 'text-cyan-300',
    asked: 'What should we cook tonight?',
    replied: 'What about a vegetarian stir-fry with rice?',
  },
  {
    who: 'Daniel',
    role: 'likes it very spicy',
    tone: 'text-violet-300',
    asked: 'What should we cook tonight?',
    replied: 'Spicy food is good. How about we order from Warung Mak Teh?',
  },
  {
    who: null,
    role: 'voice match below the threshold',
    tone: 'text-amber-300',
    asked: 'What do you know about me?',
    replied: "I don't know who is speaking. Could you please tell me your name?",
  },
];

const DOSE = [
  { icon: BellRing, at: '08:00', what: 'Her tablet is due. Recall asks her on her own Echo — nobody else is told.' },
  { icon: Mic, at: '08:04', what: '"I\'ve taken my tablet." Kept as screened text; no audio is stored, ever.' },
  { icon: Check, at: '08:04', what: 'Recorded as confirmed by voice, by her — and the carers are told it is done.' },
  {
    icon: HeartPulse,
    at: '08:30',
    what: 'Had she not answered, only then would the carers hear. Silence is never filed as "taken".',
  },
];

const CONTROL = [
  {
    icon: Shield,
    title: 'Rules are law',
    body: '"No music after 10pm on school nights" is kept word for word and outranks anything Recall has learned. Conflicts are reported, never quietly resolved.',
  },
  {
    icon: Trash2,
    title: 'Forgetting reaches every device',
    body: 'A tombstone follows the fact everywhere, erasing the words from the fact, the history it replaced, and the events behind it. A later recording cannot bring it back.',
  },
  {
    icon: Undo2,
    title: 'Nothing is done unquestioned',
    body: 'Orders and device changes are checked against your rules first, recorded with what was asked, and undone while the window is open. Anything costing money is only ever drafted.',
  },
  {
    icon: Radio,
    title: 'Thresholds are yours, not average',
    body: "A workout is measured against your own resting rate, learned from your history — so a flight of stairs isn't one. Raw heart rate never leaves the server.",
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
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
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

      {/* ---------------------------------------------------------------- the house */}
      <section className="mx-auto max-w-6xl px-6 pb-8 pt-10 text-center sm:pt-16">
        <Reveal>
          <p className="label-xs break-words">Memory for Alexa+ and any other assistant · served over MCP</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-semibold leading-tight text-slate-100 sm:text-6xl">
            A home that remembers <span className="text-cyan-300">the people in it</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            Every device in the house reports to one memory, and every person in it gets their own. Ask the same
            question as two different people and you get two different answers — because it knows which of you is
            asking.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="group inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
            >
              Open your console
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <span className="text-sm text-slate-500">A sign-in link, no password.</span>
          </div>
        </Reveal>

        <Reveal className="mt-12 lg:mt-8">
          <ProductHero />
        </Reveal>

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
          {[
            {
              icon: Fingerprint,
              title: 'Knows who is asking',
              body: 'Per-person memory, and a voice match it refuses to guess past.',
            },
            {
              icon: Check,
              title: 'Confirmed, never assumed',
              body: 'A dose is recorded because someone said so — silence is filed as unconfirmed.',
            },
            {
              icon: Trash2,
              title: 'Yours to erase',
              body: 'Forget something and it goes from every device, and from the events behind it.',
            },
          ].map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} step={(i % 3) as 0 | 1 | 2}>
              <div className="panel h-full p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10">
                  <Icon className="h-4 w-4 text-cyan-300" />
                </div>
                <h2 className="mt-3 text-[0.95rem] font-semibold text-slate-100">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mx-auto max-w-2xl text-sm text-slate-500">
            Devices sync by sequence number and merge by hybrid logical clock, so a device that was offline catches up
            in the right order. Raw events are kept seven days; what was learned outlives them.
          </p>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- speaking */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <Reveal>
          <p className="label-xs">Said out loud</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-100 sm:text-4xl">One question, three answers</h2>
          <p className="mt-4 max-w-2xl text-slate-400">
            The same words, spoken into the same kitchen, by different people. Below the voice-match threshold nobody is
            guessed at — it asks.
          </p>
        </Reveal>

        <div className="mt-10 space-y-4">
          {SAID.map((line, i) => (
            <Reveal key={line.replied} step={(i % 3) as 0 | 1 | 2}>
              <div className="panel overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
                  <div className="flex h-8 items-end gap-[3px]" aria-hidden>
                    {[0, 1, 2].map((b) => (
                      <span
                        key={b}
                        className={`bar w-[3px] rounded-full ${line.who ? 'bg-cyan-400/70' : 'bg-amber-400/70'}`}
                        style={{ height: '18px', animationDelay: `${b * 0.18}s` }}
                      />
                    ))}
                  </div>
                  <span className={`text-sm font-medium ${line.tone}`}>{line.who ?? 'Someone'}</span>
                  <span className="font-mono text-xs text-slate-500">{line.role}</span>
                </div>
                <div className="space-y-3 px-5 py-4">
                  <p className="text-slate-300">
                    <span className="label-xs mr-2">asked</span>
                    {line.asked}
                  </p>
                  <p className="text-lg text-slate-100">
                    <span className="label-xs mr-2">answered</span>
                    {line.replied}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mt-6 text-sm text-slate-500">
            Real replies from the deployed assistant, not written for this page. It has no memory of its own — only
            Recall, over MCP.
          </p>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- care */}
      <section className="border-y border-slate-800/70 bg-slate-950/40">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <Reveal>
            <p className="label-xs">Care mode</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-100 sm:text-4xl">
              A quieter house, for the person being cared for
            </h2>
            <p className="mt-4 max-w-2xl text-slate-400">
              Medication is asked for on her own device, and confirming it is hers to do. The defaults invert: only what
              a caregiver entered is ever said back to her, and a question asked twice gets the same warm answer — never
              &ldquo;I already told you&rdquo;.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 lg:grid-cols-5">
            <div className="space-y-3 lg:col-span-3">
              {DOSE.map(({ icon: Icon, at, what }, i) => (
                <Reveal key={at + what} step={(i % 3) as 0 | 1 | 2}>
                  <div className="panel flex gap-4 p-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10">
                      <Icon className="h-5 w-5 text-cyan-300" />
                    </div>
                    <div>
                      <p className="font-mono text-xs text-slate-500">{at}</p>
                      <p className="mt-1 text-slate-200">{what}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="lg:col-span-2">
              <div className="panel h-full p-6">
                <HeartPulse className="h-5 w-5 text-violet-300" />
                <h3 className="mt-3 text-base font-semibold text-slate-100">What she wears, and what it is for</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  A worn tracker reports heart rate and movement, read against her own learned resting rate. A door
                  opening at night that is not usual for the hour reaches the carers; a usual one does not.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-slate-400">
                  Readings and times only. Recall stores no diagnosis, and she is told plainly what is shared and with
                  whom — the transparency runs towards her, not only towards the people looking after her.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- control */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <Reveal>
          <p className="label-xs">Yours to change</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-100 sm:text-4xl">
            Everything it holds, and everything it did
          </h2>
          <p className="mt-4 max-w-2xl text-slate-400">
            The console shows every fact, where it came from, how sure Recall is, and whose it is. Correct one and the
            old wording is kept as history rather than overwritten.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CONTROL.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} step={(i % 3) as 0 | 1 | 2}>
              <div className="panel h-full p-6">
                <Icon className="h-5 w-5 text-cyan-400" />
                <h3 className="mt-3 text-base font-semibold text-slate-100">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <div className="panel mt-4 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <Fingerprint className="h-5 w-5 shrink-0 text-cyan-400" />
            <p className="text-sm leading-relaxed text-slate-400">
              And when there is nothing on file, it says so.{' '}
              <span className="text-slate-200">&ldquo;Nothing stored about your uncle&rdquo;</span> is a better answer
              than a confident invention, so that is the one you get.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- in */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <Reveal>
          <div className="panel flex flex-col items-start gap-5 p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-100">See what it remembers about you.</h2>
              <p className="mt-2 text-slate-400">
                Sign in with the email you were invited with. Everything in there can be corrected, forgotten or
                exported.
              </p>
            </div>
            <Link
              href="/sign-in"
              className="group inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
            >
              Open your console
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
