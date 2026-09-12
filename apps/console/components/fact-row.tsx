'use client';

import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useActionState, useState } from 'react';
import { correctFactAction, forgetFactAction } from '@/app/actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Fact } from '@/lib/recall';

const ORIGINS: Record<string, string> = {
  extraction: 'from something said',
  caregiver: 'entered by a caregiver',
  console: 'corrected here',
  seed: 'set up with the household',
  user_statement: 'just said, not yet extracted',
};

export function FactRow({ household, fact }: { household: string; fact: Fact }) {
  const [editing, setEditing] = useState(false);
  const [corrected, correct, correcting] = useActionState(correctFactAction, {});
  const [forgotten, forget, forgetting] = useActionState(forgetFactAction, {});
  const gone = fact.forgotten_at !== null || forgotten.message !== undefined;

  return (
    <li className={`px-5 py-3 ${gone ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form action={correct} className="space-y-2">
              <input type="hidden" name="household" value={household} />
              <input type="hidden" name="fact" value={fact.id} />
              <Textarea name="content" defaultValue={fact.content} rows={2} className="bg-slate-900/60 text-sm" />
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={correcting}
                  className="bg-cyan-600 text-white hover:bg-cyan-500"
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  {correcting ? 'Saving…' : 'Save correction'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-100">{gone ? <em>Forgotten</em> : fact.content}</p>
          )}

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-mono uppercase tracking-wider text-slate-400">
              {fact.scope === 'household' ? 'Household' : (fact.scope_name ?? 'Someone')}
            </span>
            <span>{ORIGINS[String(fact.source.origin)] ?? 'source unknown'}</span>
            {fact.said_by ? <span>said by {fact.said_by}</span> : null}
            <span>{fact.valid_from.slice(0, 10)}</span>
            <span>confidence {Math.round(fact.confidence * 100)}%</span>
            {fact.sensitivity !== 'none' ? <span className="text-amber-400">{fact.sensitivity}</span> : null}
            {fact.expires_at ? <span>until {fact.expires_at.slice(0, 10)}</span> : null}
            {fact.superseded_by ? <span className="text-violet-300">replaced by a newer version</span> : null}
          </p>

          {corrected.error ? <p className="mt-1 text-xs text-red-400">{corrected.error}</p> : null}
          {corrected.message ? <p className="mt-1 text-xs text-cyan-300">{corrected.message}</p> : null}
          {forgotten.error ? <p className="mt-1 text-xs text-red-400">{forgotten.error}</p> : null}
          {forgotten.message ? <p className="mt-1 text-xs text-cyan-300">{forgotten.message}</p> : null}
        </div>

        {(fact.editable || fact.deletable) && !gone && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            {fact.editable ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} title="This is wrong">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild disabled={!fact.deletable}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title="Forget this"
                  disabled={forgetting || !fact.deletable}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-slate-700 bg-slate-900">
                <AlertDialogHeader>
                  <AlertDialogTitle>Forget this for good?</AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400">
                    “{fact.content}” will be erased here and on every device, along with the statement it came from.
                    Anything said before this moment can&rsquo;t bring it back.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <form action={forget}>
                    <input type="hidden" name="household" value={household} />
                    <input type="hidden" name="fact" value={fact.id} />
                    <AlertDialogAction type="submit" className="bg-red-600 text-white hover:bg-red-500">
                      Forget it
                    </AlertDialogAction>
                  </form>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>
    </li>
  );
}
