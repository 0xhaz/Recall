import { redirect } from 'next/navigation';
import { ApiError, getProfile, type Profile } from './recall';

/** Every console page starts here: a session, or the sign-in page. */
export async function requireProfile(): Promise<Profile> {
  try {
    return await getProfile();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) redirect('/sign-in');
    throw err;
  }
}

export type Membership = Profile['memberships'][number];

/** A household you are not in is not yours to open. */
export function requireMembership(profile: Profile, householdId: string): Membership {
  const membership = profile.memberships.find((m) => m.household_id === householdId);
  if (!membership) redirect('/');
  return membership;
}
