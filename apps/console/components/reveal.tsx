import type { ReactNode } from 'react';

/**
 * A scroll-linked reveal, done entirely in CSS (see globals.css). Deliberately not a client
 * component: the content is visible from the first paint and the animation is an enhancement,
 * so a reader whose JavaScript is slow, blocked or broken still gets the page.
 */
export function Reveal({
  children,
  step = 0,
  className = '',
}: {
  children: ReactNode;
  /** Staggers a row: 1, 2 or 3 start progressively later than their neighbour. */
  step?: 0 | 1 | 2 | 3;
  className?: string;
}) {
  return <div className={`reveal ${step ? `reveal-step-${step}` : ''} ${className}`}>{children}</div>;
}
