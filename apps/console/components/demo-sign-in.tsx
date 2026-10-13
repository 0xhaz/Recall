'use client';

import { ArrowRight } from 'lucide-react';
import { useActionState } from 'react';
import { demoSignInAction } from '@/app/actions';

/**
 * One-click sign-in for judging. The three seats are the access model, not a shortcut around it:
 * the same household looks different from each, and that difference is the product.
 */
const SEATS = [
  { person: 'Emma', role: 'owner', sees: 'everything the household shares, and her own' },
  { person: 'Daniel', role: 'adult', sees: 'the same household memory — but none of Emma’s' },
  { person: 'Nina', role: 'caregiver', sees: 'only Ruth, and only what her grants allow' },
];

export function DemoSignIn() {
  const [state, submit, pending] = useActionState(demoSignInAction, {});

  return (
    <form action={submit} className="mt-6 border-t border-slate-700/50 pt-5">
      <p className="text-sm text-slate-300">Judging this, or just looking?</p>
      <p className="mt-1 text-xs text-slate-500">
        Sign in to the demo household. Everyone in it is invented and so is everything they said.
      </p>

      <ul className="mt-3 space-y-2">
        {SEATS.map((seat) => (
          <li key={seat.person}>
            <button
              type="submit"
              name="person"
              value={seat.person}
              disabled={pending}
              className="group flex w-full items-center justify-between gap-3 rounded-md border border-slate-700/60 px-3 py-2 text-left hover:border-cyan-500/40 disabled:opacity-60"
            >
              <span>
                <span className="text-sm text-slate-100">{seat.person}</span>
                <span className="ml-2 font-mono text-xs uppercase tracking-wider text-cyan-300">{seat.role}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{seat.sees}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 group-hover:text-cyan-400" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        Signs you in for a day. Try the same question from two of them — that difference is the whole point.
      </p>
      {state.error ? <p className="mt-2 text-xs text-red-400">{state.error}</p> : null}
    </form>
  );
}
