import { DoorOpen, HeartPulse, MonitorSmartphone, Speaker, Tv, Watch } from 'lucide-react';

// The hero: the console itself, with the household's real devices around it and the MCP calls
// running between them. The screen is a scaled-down render of pages that exist — memory with its
// provenance, a dose waiting to be confirmed, a live context score — rather than invented UI.

interface Device {
  icon: typeof Speaker;
  name: string;
  detail: string;
  /** Percentage placement inside the frame, and where the wire meets the screen. */
  at: string;
  wire: { from: [number, number]; to: [number, number] };
  worn?: boolean;
}

const DEVICES: Device[] = [
  {
    icon: MonitorSmartphone,
    name: 'Kitchen Echo Show',
    detail: 'the room everyone passes',
    at: 'left-0 top-[14%]',
    wire: { from: [170, 88], to: [240, 210] },
  },
  {
    icon: Speaker,
    name: "Ruth's Echo",
    detail: 'her own device',
    at: 'left-0 top-[46%]',
    wire: { from: [170, 288], to: [240, 312] },
  },
  {
    icon: DoorOpen,
    name: 'Front door',
    detail: 'arrivals',
    at: 'left-0 top-[78%]',
    wire: { from: [170, 488], to: [240, 414] },
  },
  {
    icon: Tv,
    name: 'Living room Fire TV',
    detail: 'what is playing',
    at: 'right-0 top-[14%]',
    wire: { from: [830, 88], to: [760, 210] },
  },
  {
    icon: HeartPulse,
    name: "Ruth's Bee",
    detail: 'heart rate · movement',
    at: 'right-0 top-[46%]',
    wire: { from: [830, 288], to: [760, 312] },
    worn: true,
  },
  {
    icon: Watch,
    name: "Emma's watch",
    detail: 'heart rate',
    at: 'right-0 top-[78%]',
    wire: { from: [830, 488], to: [760, 414] },
    worn: true,
  },
];

const curve = ({ from, to }: Device['wire']) => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  return `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
};

export function ProductHero() {
  return (
    <div className="relative mx-auto w-full max-w-5xl lg:h-[625px]">
      {/* The wires, behind everything. Hidden on small screens, where the devices stack instead. */}
      <svg
        viewBox="0 0 1000 625"
        className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
        aria-hidden
      >
        <defs>
          <marker id="hero-in" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 1 L 7 4 L 0 7 z" fill="rgb(34 211 238)" fillOpacity="0.85" />
          </marker>
          <marker id="hero-out" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 8 1 L 1 4 L 8 7 z" fill="rgb(34 211 238)" fillOpacity="0.5" />
          </marker>
          <linearGradient id="hero-wire" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.25" />
            <stop offset="55%" stopColor="rgb(34 211 238)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {DEVICES.map((d, i) => (
          <g key={d.name}>
            <path d={curve(d.wire)} fill="none" stroke="rgb(71 85 105)" strokeWidth="1.25" />
            <path
              d={curve(d.wire)}
              fill="none"
              stroke="url(#hero-wire)"
              strokeWidth="2.5"
              className="flow"
              markerStart="url(#hero-out)"
              markerEnd="url(#hero-in)"
              style={{ animationDelay: `${i * 0.35}s` }}
            />
          </g>
        ))}
      </svg>

      {/* The screen. */}
      <div className="relative mx-auto w-full lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[52%] lg:-translate-x-1/2 lg:-translate-y-1/2">
        <div className="panel overflow-hidden border-slate-700/70 shadow-[0_0_80px_-20px_rgba(34,211,238,0.35)]">
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/70 px-4 py-2.5">
            <span className="h-2 w-2 rounded-full bg-cyan-400/80" />
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">
              Recall · Demo household
            </span>
          </div>

          <div className="grid min-w-0 gap-3 p-4 sm:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 sm:col-span-2">
              <p className="label-xs">What it holds about Emma</p>
              <ul className="mt-2.5 space-y-2">
                {[
                  ['Emma is vegetarian', 'hers · 0.95'],
                  ['Family dinner is usually around 19:30', 'household · 0.70'],
                  ['The usual takeaway is Napoli Pizza', 'household · 0.80'],
                ].map(([fact, meta]) => (
                  <li key={fact} className="flex items-center justify-between gap-3 text-[0.82rem]">
                    <span className="min-w-0 truncate text-slate-200">{fact}</span>
                    <span className="shrink-0 font-mono text-[0.68rem] text-slate-500">{meta}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 p-3.5">
              <p className="label-xs">Today · Ruth</p>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-[0.7rem] text-emerald-300">
                  ✓
                </span>
                <span className="text-[0.82rem] text-slate-200">08:00 tablet</span>
              </div>
              <p className="mt-1.5 font-mono text-[0.68rem] text-emerald-300/80">said so herself, 08:04</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-5 w-5 rounded-full border border-slate-700" />
                <span className="text-[0.82rem] text-slate-400">20:00 tablet</span>
              </div>
              <p className="mt-1.5 font-mono text-[0.68rem] text-slate-500">later today</p>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 p-3.5">
              <p className="label-xs">Context · live</p>
              <div className="mt-2.5 flex items-baseline gap-1.5">
                <span className="text-2xl text-slate-100">0.81</span>
                <span className="text-[0.82rem] text-slate-400">workout · Emma</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-[81%] rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
              </div>
              <p className="mt-2 break-words font-mono text-[0.68rem] leading-relaxed text-slate-500">
                heart rate 34% above her resting
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Devices: placed around the screen on a wide screen, stacked beneath it on a narrow one. */}
      <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:mt-0 lg:block">
        {DEVICES.map((d) => (
          <div key={d.name} className={`lg:absolute lg:w-[17%] lg:-translate-y-1/2 ${d.at}`}>
            <div className="panel flex items-center gap-2.5 p-2.5 lg:flex-col lg:items-start lg:gap-1.5 lg:p-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                  d.worn ? 'border-violet-500/30 bg-violet-500/10' : 'border-cyan-500/25 bg-cyan-500/10'
                }`}
              >
                <d.icon className={`h-4 w-4 ${d.worn ? 'text-violet-300' : 'text-cyan-300'}`} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[0.78rem] font-medium text-slate-200">{d.name}</p>
                <p className="truncate font-mono text-[0.66rem] text-slate-500">{d.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
