import type { MembershipRole } from './types.js';

// Who may do what inside one household (architecture.md §1.3, design.md §9).
// Pure functions so the rules are testable without a database.

export type Grant = 'edit_care_plan' | 'view_daily' | 'enter_facts' | 'set_rules' | 'view_full_memory';

/** On by default for a new caregiver; full memory is opt-in only. */
export const DEFAULT_CAREGIVER_GRANTS: readonly Grant[] = ['edit_care_plan', 'view_daily', 'enter_facts', 'set_rules'];

export interface Member {
  person_id: string;
  role: MembershipRole;
  grants: readonly Grant[];
  capacity_flag: boolean;
}

function isSelf(actor: Member, subject: Member): boolean {
  return actor.person_id === subject.person_id;
}

function caregiverHas(actor: Member, subject: Member, grant: Grant): boolean {
  return actor.role === 'caregiver' && subject.role === 'cared_for' && actor.grants.includes(grant);
}

function isParentOf(actor: Member, subject: Member): boolean {
  return subject.role === 'child' && (actor.role === 'owner' || actor.role === 'adult');
}

/** Read someone's person-scoped memory. Caregivers never see anyone but the cared-for person. */
export function canReadPersonMemory(actor: Member, subject: Member): boolean {
  return isSelf(actor, subject) || caregiverHas(actor, subject, 'view_full_memory') || isParentOf(actor, subject);
}

/** Delete from someone's person-scoped memory (parental deletion for child profiles). */
export function canDeletePersonMemory(actor: Member, subject: Member): boolean {
  return isSelf(actor, subject) || isParentOf(actor, subject);
}

/** Enter or confirm facts on someone's behalf; caregiver entries are tagged source = caregiver. */
export function canEnterFactsFor(actor: Member, subject: Member): boolean {
  return isSelf(actor, subject) || caregiverHas(actor, subject, 'enter_facts');
}

/** Stated rules for someone: yourself, a caregiver with the set_rules grant, or a parent for a child. */
export function canSetRulesFor(actor: Member, subject: Member): boolean {
  return isSelf(actor, subject) || caregiverHas(actor, subject, 'set_rules') || isParentOf(actor, subject);
}

export function canViewDaily(actor: Member, subject: Member): boolean {
  return caregiverHas(actor, subject, 'view_daily');
}

export function canEditCarePlan(actor: Member, subject: Member): boolean {
  return caregiverHas(actor, subject, 'edit_care_plan');
}

export function canManageMembers(actor: Member): boolean {
  return actor.role === 'owner';
}

/**
 * Revoke a caregiver: the owner always; the cared-for person too, unless the owner has
 * recorded a capacity flag (which is itself visible to the person and logged).
 */
export function canRevokeCaregiver(actor: Member, caredFor: Member): boolean {
  if (actor.role === 'owner') return true;
  return isSelf(actor, caredFor) && caredFor.role === 'cared_for' && !caredFor.capacity_flag;
}
