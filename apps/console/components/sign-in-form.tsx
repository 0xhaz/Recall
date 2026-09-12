'use client';

import { useActionState } from 'react';
import { requestLinkAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignInForm() {
  const [state, submit, pending] = useActionState(requestLinkAction, {});

  return (
    <form action={submit} className="mt-5 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-slate-300">
          Email
        </Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </div>
      <Button type="submit" disabled={pending} className="w-full bg-cyan-600 text-white hover:bg-cyan-500">
        {pending ? 'Sending…' : 'Send me a link'}
      </Button>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-cyan-300">{state.message}</p> : null}
    </form>
  );
}
