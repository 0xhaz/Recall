'use client';

import { useActionState, useState } from 'react';
import { forgetRangeAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Deleting is not undoable, so it asks once and says plainly what it will do. */
export function ForgetRangeForm({ household }: { household: string }) {
  const [state, submit, pending] = useActionState(forgetRangeAction, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="household" value={household} />
      <div>
        <label htmlFor="from" className="label-xs">
          From
        </label>
        <Input id="from" name="from" type="date" required className="mt-1 w-40" />
      </div>
      <div>
        <label htmlFor="to" className="label-xs">
          To
        </label>
        <Input id="to" name="to" type="date" required className="mt-1 w-40" />
      </div>
      {confirming ? (
        <>
          <Button type="submit" variant="outline" disabled={pending} className="border-red-500/40 text-red-300">
            {pending ? 'Forgetting…' : 'Yes, forget it'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
          Forget this range
        </Button>
      )}
      {confirming ? (
        <p className="w-full text-xs text-red-300">
          This erases the words, not just the view of them, on every device. It cannot be undone.
        </p>
      ) : null}
      {state.error ? <p className="w-full text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="w-full text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}
