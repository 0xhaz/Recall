import { Download, PauseCircle, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { ForgetRangeForm } from '@/components/forget-range-form';
import { Panel } from '@/components/panel';
import { PauseForm } from '@/components/pause-form';
import { RetentionForm } from '@/components/retention-form';
import { requireMembership, requireProfile } from '@/lib/guard';
import { getSettings } from '@/lib/recall';

export default async function Settings({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const [settings, profile] = await Promise.all([getSettings(household), requireProfile()]);
  const membership = requireMembership(profile, household);

  return (
    <>
      <Panel
        title="How long things are kept"
        icon={SettingsIcon}
        subtitle="Raw device reports are dropped after this. Facts stay until they are forgotten or expire."
      >
        <RetentionForm household={household} days={settings.retention_days} canEdit={membership.role === 'owner'} />
        <p className="mt-4 text-xs text-slate-500">
          Anything forgotten stays forgotten: its tombstone outlives the window by 30 days, so a device that was offline
          can&rsquo;t bring it back. Snapshots are rewritten too.
        </p>
      </Panel>

      <Panel title="Take your memory with you" icon={Download} subtitle="Everything you are allowed to see, as JSON.">
        <a
          href={`/h/${household}/export`}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40"
        >
          <Download className="h-4 w-4 text-cyan-400" />
          Download export
        </a>
        <p className="mt-3 text-xs text-slate-500">
          Facts, rules, routines, actions, devices and notices — the same scoping as the pages you just read.
        </p>
      </Panel>

      <Panel
        title="Forget a day, or a stretch of days"
        icon={Trash2}
        subtitle="By topic, say “forget that I'm on a diet”. Fact by fact, use the Memory page. This is for “delete last Tuesday”."
      >
        <ForgetRangeForm household={household} />
        <p className="mt-3 text-xs text-slate-500">
          Only what you are allowed to delete: your own memory, the household&rsquo;s, and a child&rsquo;s if you are
          their parent. Each fact goes the same way a spoken <span className="font-mono">forget</span> sends it — a
          tombstone every device picks up, and the words erased where Recall kept them.
        </p>
      </Panel>

      <Panel
        title="Pause for a while"
        icon={PauseCircle}
        subtitle="Temporary mode: Recall neither reads nor writes until it is over."
      >
        <PauseForm household={household} pausedUntil={settings.paused_until} />
        <p className="mt-3 text-xs text-slate-500">
          The whole household pauses together — pausing in the kitchen while the bedroom kept listening would be worse
          than not offering it. Nothing already stored is affected; this is only about the next few minutes.
        </p>
      </Panel>
    </>
  );
}
