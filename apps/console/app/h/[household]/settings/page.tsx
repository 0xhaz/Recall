import { Download, Settings as SettingsIcon } from 'lucide-react';
import { Panel } from '@/components/panel';
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

      <Panel title="Not built yet">
        <ul className="space-y-1 text-xs text-slate-500">
          <li>· Deleting by day or range (forget by topic works by voice, and fact by fact here)</li>
          <li>· Temporary mode, where nothing at all is stored for a while</li>
          <li>· Adding and removing people from the household</li>
        </ul>
      </Panel>
    </>
  );
}
