import { MessageSquare } from 'lucide-react';
import { Panel } from '@/components/panel';
import { SimulatorConsole } from '@/components/simulator-console';
import { getSimConfig, getSimDevices, type SimConfig, type SimDevice, SimulatorOffline } from '@/lib/simulator';

export default async function Simulator({ params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;

  let config: SimConfig | null = null;
  let devices: SimDevice[] = [];
  try {
    [config, devices] = await Promise.all([getSimConfig(), getSimDevices().then((d) => d.devices)]);
  } catch (err) {
    if (!(err instanceof SimulatorOffline)) throw err;
    return (
      <Panel title="The simulator isn't running" icon={MessageSquare}>
        <p className="text-sm text-slate-300">{(err as Error).message}</p>
        <p className="mt-3 text-sm text-slate-400">
          It is a separate process standing in for Alexa+: a local model with tool calling whose only memory is Recall,
          over MCP. Start it in a terminal and reload this page.
        </p>
        <pre className="mt-3 rounded-md bg-slate-900/80 p-3 text-xs text-slate-300">pnpm sim</pre>
      </Panel>
    );
  }

  return (
    <Panel
      title="Speak to the assistant"
      icon={MessageSquare}
      subtitle={`A stand-in for Alexa+ (${config.model}) that reaches Recall only through MCP. Watch what it asks for, and what the devices do about it.`}
      className="flex-1"
    >
      <SimulatorConsole household={household} config={config} initialDevices={devices} />
    </Panel>
  );
}
