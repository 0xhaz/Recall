'use client';

import { useActionState } from 'react';
import { setRetentionAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RetentionForm({ household, days, canEdit }: { household: string; days: number; canEdit: boolean }) {
  const [state, submit, pending] = useActionState(setRetentionAction, {});

  return (
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="household" value={household} />
      <div>
        <label htmlFor="retention_days" className="label-xs">
          Days of raw events
        </label>
        <Input
          id="retention_days"
          name="retention_days"
          type="number"
          min={7}
          max={365}
          defaultValue={days}
          disabled={!canEdit}
          className="mt-1 w-32"
        />
      </div>
      {canEdit ? (
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      ) : (
        <p className="text-xs text-slate-500">Only the household owner can change this.</p>
      )}
      {state.error ? <p className="w-full text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="w-full text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}
