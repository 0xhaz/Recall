import { Cpu } from 'lucide-react';
import { Empty, Panel, when } from '@/components/panel';
import { getDevices } from '@/lib/recall';

export default async function Devices({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  const { devices } = await getDevices(household);

  return (
    <Panel
      title="Devices and sources"
      icon={Cpu}
      subtitle="What reports to Recall, what it is playing, and how far each one has caught up with the log."
    >
      {devices.length === 0 ? (
        <Empty>No device has reported yet.</Empty>
      ) : (
        <ul className="-mx-5 divide-y divide-slate-700/40 border-t border-slate-700/50">
          {devices.map((device) => (
            <li key={device.device_id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm text-slate-100">
                  {device.name ?? device.device_id}
                  {device.location ? <span className="text-slate-500"> · {device.location}</span> : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <span className="font-mono">{device.device_id}</span>
                  {device.primary_person ? ` · usually ${device.primary_person}` : ''} · first seen{' '}
                  {device.first_seen_at.slice(0, 10)}
                </p>
                {device.state?.now_playing ? (
                  <p className="mt-1 text-xs text-cyan-300">
                    {device.state.now_playing.paused ? 'paused' : 'playing'}: {device.state.now_playing.title}
                  </p>
                ) : null}
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>last seen {when(device.last_seen_at)}</div>
                <div className="font-mono">synced to #{device.last_cursor}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
