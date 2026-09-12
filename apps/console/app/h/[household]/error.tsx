'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Recall answers with plain reasons — "Nobody is being cared for here", "Not yours to change" — so
// the console shows them as written rather than crashing into a blank 500.
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        That didn&rsquo;t work
      </h2>
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
    </section>
  );
}
