'use client';

import { useActionState } from 'react';
import { pauseAction } from '@/app/actions';
import { Button } from '@/components/ui/button';

const OPTIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 120, label: '2 hours' },
  { minutes: 480, label: 'Rest of the day' },
];

export function PauseForm({ household, pausedUntil }: { household: string; pausedUntil: string | null }) {
  const [state, submit, pending] = useActionState(pauseAction, {});
  const paused = pausedUntil !== null && new Date(pausedUntil).getTime() > Date.now();

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="household" value={household} />
      {paused ? (
        <>
          <p className="w-full text-sm text-amber-300">
            Paused until {new Date(pausedUntil ?? '').toLocaleTimeString()}. Nothing is being read or stored.
          </p>
          <Button type="submit" name="minutes" value="0" variant="outline" disabled={pending}>
            {pending ? 'Resuming…' : 'Start listening again'}
          </Button>
        </>
      ) : (
        OPTIONS.map((o) => (
          <Button key={o.minutes} type="submit" name="minutes" value={o.minutes} variant="outline" disabled={pending}>
            {o.label}
          </Button>
        ))
      )}
      {state.error ? <p className="w-full text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="w-full text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}
