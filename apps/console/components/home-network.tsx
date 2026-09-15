// The household as Recall sees it: the devices from the demo seed, each reporting in to one memory
// the whole house shares. Drawn rather than photographed, because what matters is the wiring.

interface Node {
  x: number;
  y: number;
  label: string;
  detail: string;
  /** Worn things report readings and are never spoken to; it is worth showing the difference. */
  worn?: boolean;
}

const CX = 450;
const CY = 262;

const NODES: Node[] = [
  { x: 450, y: 72, label: "Aisyah's watch", detail: 'heart rate', worn: true },
  { x: 706, y: 167, label: 'Living room Fire TV', detail: 'what is playing' },
  { x: 706, y: 357, label: "Mak Som's Bee", detail: 'heart rate · movement', worn: true },
  { x: 450, y: 452, label: 'Front door', detail: 'arrivals' },
  { x: 194, y: 357, label: "Mak Som's Echo", detail: 'her own device' },
  { x: 194, y: 167, label: 'Kitchen Echo Show', detail: 'the room everyone passes' },
];

export function HomeNetwork() {
  return (
    <svg
      viewBox="0 0 900 524"
      className="h-auto w-full"
      role="img"
      aria-label="Six household devices — two Echos, a Fire TV, a front door, a worn tracker and a watch — each connected to one shared memory at the centre."
    >
      <title>The devices in one household, reporting to a single memory</title>
      <defs>
        <radialGradient id="core-glow">
          <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {NODES.map((n, i) => (
        <g key={n.label}>
          <line x1={n.x} y1={n.y} x2={CX} y2={CY} stroke="rgb(51 65 85)" strokeWidth="1" />
          <line
            x1={n.x}
            y1={n.y}
            x2={CX}
            y2={CY}
            stroke="url(#wire)"
            strokeWidth="1.75"
            className="flow"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        </g>
      ))}

      <circle cx={CX} cy={CY} r="120" fill="url(#core-glow)" />
      <circle
        cx={CX}
        cy={CY}
        r="46"
        fill="none"
        stroke="rgb(34 211 238)"
        strokeWidth="1"
        className="core-ring"
        opacity="0.6"
      />
      <circle cx={CX} cy={CY} r="46" fill="rgb(2 8 23)" stroke="rgb(34 211 238)" strokeWidth="1.5" opacity="0.9" />
      <text x={CX} y={CY - 4} textAnchor="middle" className="fill-cyan-300 font-mono text-[15px] tracking-[0.2em]">
        RECALL
      </text>
      <text x={CX} y={CY + 16} textAnchor="middle" className="fill-slate-500 font-mono text-[11px]">
        one memory
      </text>

      {NODES.map((n, i) => {
        const above = n.y < CY;
        return (
          <g key={n.label}>
            <circle
              cx={n.x}
              cy={n.y}
              r="9"
              fill={n.worn ? 'rgb(167 139 250)' : 'rgb(34 211 238)'}
              className="node-pulse"
              style={{ animationDelay: `${i * 0.5}s` }}
            />
            <circle cx={n.x} cy={n.y} r="17" fill="none" stroke="rgb(51 65 85)" strokeWidth="1" />
            <text
              x={n.x}
              y={above ? n.y - 30 : n.y + 38}
              textAnchor="middle"
              className="fill-slate-200 text-[14px] font-medium"
            >
              {n.label}
            </text>
            <text
              x={n.x}
              y={above ? n.y - 13 : n.y + 55}
              textAnchor="middle"
              className="fill-slate-500 font-mono text-[11px]"
            >
              {n.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
