'use client';

import { UserPlus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { addPersonAction, removePersonAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ROLES = [
  { value: 'adult', label: 'Adult — full member' },
  { value: 'child', label: 'Child — a parent can see and delete their memory' },
  { value: 'guest', label: 'Guest — nothing is stored' },
  { value: 'caregiver', label: 'Caregiver — looks after someone here' },
  { value: 'cared_for', label: 'Cared for — hears only what a caregiver entered' },
];

export function AddPerson({ household }: { household: string }) {
  const [state, submit, pending] = useActionState(addPersonAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="mt-4">
        <UserPlus className="mr-2 h-4 w-4 text-cyan-400" />
        Add someone
      </Button>
    );
  }

  return (
    <form action={submit} className="mt-4 space-y-3 rounded-md border border-slate-700/60 p-4">
      <input type="hidden" name="household" value={household} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="name" className="label-xs">
            Name
          </label>
          <Input id="name" name="name" required maxLength={80} className="mt-1" placeholder="Leo" />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="email" className="label-xs">
            Email (optional — only needed to sign in to this console)
          </label>
          <Input id="email" name="email" type="email" maxLength={200} className="mt-1" placeholder="leo@example.com" />
        </div>
      </div>
      <div>
        <label htmlFor="role" className="label-xs">
          Role
        </label>
        <select
          id="role"
          name="role"
          defaultValue="adult"
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Adding…' : 'Add to household'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        A role decides what they can see, and it is the only thing that does. A caregiver starts with the usual grants
        and never sees anyone but the person they look after.
      </p>
      {state.error ? <p className="text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}

export function RemovePerson({ household, personId, name }: { household: string; personId: string; name: string }) {
  const [state, submit, pending] = useActionState(removePersonAction, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-slate-500 underline underline-offset-2 hover:text-red-300"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={submit} className="text-right">
      <input type="hidden" name="household" value={household} />
      <input type="hidden" name="person_id" value={personId} />
      <p className="text-xs text-slate-400">Remove {name}?</p>
      <div className="mt-1 flex justify-end gap-2">
        <button type="submit" disabled={pending} className="text-xs text-red-300 underline underline-offset-2">
          {pending ? 'Removing…' : 'Yes'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-slate-500 underline underline-offset-2"
        >
          No
        </button>
      </div>
      {state.error ? <p className="mt-1 text-xs text-red-400">{state.error}</p> : null}
    </form>
  );
}
