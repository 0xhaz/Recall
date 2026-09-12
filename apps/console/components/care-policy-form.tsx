'use client';

import { useActionState } from 'react';
import { setCarePolicyAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function CarePolicyForm({ household, person }: { household: string; person: string }) {
  const [state, submit, pending] = useActionState(setCarePolicyAction, {});

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="household" value={household} />
      <input type="hidden" name="person" value={person} />
      <p className="text-sm text-slate-200">Add a topic</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="topic" className="text-slate-300">
            Topic
          </Label>
          <Input id="topic" name="topic" placeholder="Ahmad" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="keywords" className="text-slate-300">
            Words that bring it up
          </Label>
          <Input id="keywords" name="keywords" placeholder="Ahmad, husband" />
        </div>
      </div>

      <fieldset className="flex items-center gap-4 text-sm text-slate-300">
        <legend className="label-xs mb-1">What should Recall do</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="policy" value="redirect" defaultChecked /> Reassure and turn elsewhere
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="policy" value="correct" /> Say plainly what is true
        </label>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="guidance" className="text-slate-300">
          In your words
        </Label>
        <Textarea
          id="guidance"
          name="guidance"
          rows={2}
          placeholder="Talk about his garden. Only say he has passed if she asks directly."
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="bg-cyan-600 text-white hover:bg-cyan-500">
          {pending ? 'Saving…' : 'Save topic'}
        </Button>
        <Button type="submit" name="remove" value="true" variant="ghost" disabled={pending}>
          Remove this topic
        </Button>
      </div>
      {state.error ? <p className="text-xs text-red-400">{state.error}</p> : null}
      {state.message ? <p className="text-xs text-cyan-300">{state.message}</p> : null}
    </form>
  );
}
