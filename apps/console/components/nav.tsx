'use client';

import {
  Activity,
  Cpu,
  Database,
  HeartPulse,
  type LucideIcon,
  Radio,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '', label: 'Overview', icon: SlidersHorizontal },
  { href: '/memory', label: 'Memory', icon: Database },
  { href: '/rules', label: 'Rules', icon: Shield },
  { href: '/routines', label: 'Routines', icon: Activity },
  { href: '/actions', label: 'Actions', icon: Zap },
  { href: '/context', label: 'Context', icon: Radio },
  { href: '/people', label: 'People', icon: Users },
  { href: '/devices', label: 'Devices', icon: Cpu },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Nav({ household, carePersonId }: { household: string; carePersonId?: string | null }) {
  const pathname = usePathname();
  const base = `/h/${household}`;
  const items = carePersonId
    ? [...SECTIONS, { href: `/care/${carePersonId}`, label: 'Care', icon: HeartPulse }]
    : SECTIONS;

  return (
    <nav className="space-y-1">
      {items.map(({ href, label, icon: Icon }) => {
        const target = `${base}${href}`;
        const active = href === '' ? pathname === base : pathname.startsWith(target);
        return (
          <Link
            key={label}
            href={target}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              active ? 'bg-slate-800/70 text-cyan-400' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-100'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
