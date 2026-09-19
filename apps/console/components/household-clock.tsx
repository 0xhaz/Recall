'use client';

import { useEffect, useState } from 'react';

/**
 * The household's own clock, ticking. The care page is entirely about times — "not confirmed" means
 * nothing without knowing what time it is now — and a server-rendered stamp is wrong within a
 * minute of the page being left open, which is how a caregiver actually uses it.
 */
export function HouseholdClock({ timezone, initial }: { timezone: string; initial: string }) {
  const [now, setNow] = useState(initial);

  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date());
    setNow(format());
    const tick = setInterval(() => setNow(format()), 30_000);
    return () => clearInterval(tick);
  }, [timezone]);

  return (
    <span suppressHydrationWarning className="font-mono text-xs text-slate-400">
      {now} · {timezone.replace('_', ' ')}
    </span>
  );
}
