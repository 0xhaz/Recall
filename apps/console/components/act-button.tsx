'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';

/**
 * One button wired to one server action, with its own pending and result state. Whatever Recall
 * answers is shown as-is: these are the person's own words coming back, not a toast we invented.
 */
export function ActButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'outline',
  className = '',
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: 'outline' | 'ghost' | 'destructive' | 'default';
  className?: string;
}) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form action={submit} className="inline-flex flex-col items-end gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending} className={className}>
        {pending ? (pendingLabel ?? 'Working…') : label}
      </Button>
      {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      {state.message ? <span className="max-w-xs text-right text-xs text-cyan-300">{state.message}</span> : null}
    </form>
  );
}
