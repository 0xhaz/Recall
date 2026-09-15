'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// Recall answers with plain reasons — "Nobody is being cared for here", "Not yours to change" — so
// the console shows them as written rather than crashing into a blank 500.

/**
 * A tab open across a deployment posts a server action id the new build has never heard of. That
 * is not something to explain to a reader: the page they were on still exists, their session is
 * still good, and the fix is to fetch the new build. Reload once and say why, rather than showing
 * them a hex id and a link to the Next.js docs.
 */
const isStaleBuild = (message: string) => /server action|failed-to-find-server-action/i.test(message);

const RELOAD_KEY = 'recall:reloaded-for-stale-build';
/** Long enough that a genuinely broken deployment cannot put the page in a reload loop. */
const RELOAD_COOLDOWN_MS = 30_000;

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuild(error.message);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!stale) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    } catch {
      // Private browsing, or storage refused: fall through and let them press the button.
    }
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {}
    setReloading(true);
    window.location.reload();
  }, [stale]);

  return (
    <section className="panel p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        {stale ? 'Recall was updated' : "That didn't work"}
      </h2>
      {stale ? (
        <>
          <p className="mt-2 text-sm text-slate-300">
            {reloading
              ? 'Fetching the new version…'
              : 'This page was left open across an update. Reload and it will work — nothing was lost, and you are still signed in.'}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-300">{error.message || 'Something went wrong reading your memory.'}</p>
          <p className="mt-1 text-xs text-slate-500">
            If this is about someone else&rsquo;s memory, it may simply not be yours to see.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button type="button" variant="outline" onClick={reset}>
              Try again
            </Button>
            <a href="/" className="text-xs text-slate-400 hover:text-slate-200">
              Back to the overview
            </a>
          </div>
        </>
      )}
    </section>
  );
}
