import { describe, expect, it } from 'vitest';
import {
  canDeletePersonMemory,
  canEnterFactsFor,
  canReadPersonMemory,
  canRevokeCaregiver,
  canSetRulesFor,
  canViewDaily,
  DEFAULT_CAREGIVER_GRANTS,
  type Member,
} from './access.js';

const member = (person_id: string, role: Member['role'], extra: Partial<Member> = {}): Member => ({
  person_id,
  role,
  grants: [],
  capacity_flag: false,
  ...extra,
});

const owner = member('aisyah', 'owner');
const adult = member('daniel', 'adult');
const child = member('sofia', 'child');
const guest = member('ravi', 'guest');
const elder = member('som', 'cared_for');
const caregiver = member('farah', 'caregiver', { grants: DEFAULT_CAREGIVER_GRANTS });

describe('reading person memory', () => {
  it('everyone reads their own', () => {
    for (const m of [owner, adult, child, guest, elder, caregiver]) expect(canReadPersonMemory(m, m)).toBe(true);
  });

  it('adults cannot read each other', () => {
    expect(canReadPersonMemory(owner, adult)).toBe(false);
    expect(canReadPersonMemory(adult, owner)).toBe(false);
  });

  it('parents can read and delete child profiles; guests cannot', () => {
    expect(canReadPersonMemory(owner, child)).toBe(true);
    expect(canDeletePersonMemory(adult, child)).toBe(true);
    expect(canReadPersonMemory(guest, child)).toBe(false);
  });

  it("caregivers never read other members' memory", () => {
    expect(canReadPersonMemory(caregiver, owner)).toBe(false);
    expect(canReadPersonMemory(caregiver, child)).toBe(false);
  });

  it("caregivers read the cared-for person's full memory only with the opt-in grant", () => {
    expect(canReadPersonMemory(caregiver, elder)).toBe(false);
    const optedIn = { ...caregiver, grants: [...DEFAULT_CAREGIVER_GRANTS, 'view_full_memory' as const] };
    expect(canReadPersonMemory(optedIn, elder)).toBe(true);
  });
});

describe('caregiver defaults', () => {
  it('can see the daily view and enter facts for the cared-for person only', () => {
    expect(canViewDaily(caregiver, elder)).toBe(true);
    expect(canEnterFactsFor(caregiver, elder)).toBe(true);
    expect(canEnterFactsFor(caregiver, adult)).toBe(false);
  });
});

describe('setting rules for someone', () => {
  it('parents for children, caregivers for the person they care for, nobody for another adult', () => {
    expect(canSetRulesFor(owner, child)).toBe(true);
    expect(canSetRulesFor(caregiver, elder)).toBe(true);
    expect(canSetRulesFor(adult, owner)).toBe(false);
    expect(canSetRulesFor(caregiver, adult)).toBe(false);
    expect(canSetRulesFor(child, adult)).toBe(false);
  });
});

describe('revoking a caregiver', () => {
  it('the owner always can', () => {
    expect(canRevokeCaregiver(owner, elder)).toBe(true);
  });

  it('the cared-for person can, unless a capacity flag is set', () => {
    expect(canRevokeCaregiver(elder, elder)).toBe(true);
    const flagged = { ...elder, capacity_flag: true };
    expect(canRevokeCaregiver(flagged, flagged)).toBe(false);
  });

  it('other members cannot', () => {
    expect(canRevokeCaregiver(adult, elder)).toBe(false);
  });
});
