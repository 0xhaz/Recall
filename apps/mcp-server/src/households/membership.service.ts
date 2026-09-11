import { Inject, Injectable } from '@nestjs/common';
import type { Grant, Member, MembershipRole } from '@recall/core';
import { Db } from '../db/db.js';

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  memberships: {
    household_id: string;
    household_name: string;
    role: MembershipRole;
    grants: Grant[];
    capacity_flag: boolean;
  }[];
}

@Injectable()
export class MembershipService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async member(householdId: string, personId: string): Promise<Member | null> {
    const { rows } = await this.db.query<Member>(
      `SELECT person_id, role, grants, capacity_flag FROM membership
        WHERE household_id = $1 AND person_id = $2 AND revoked_at IS NULL`,
      [householdId, personId],
    );
    return rows[0] ?? null;
  }

  async profile(personId: string): Promise<Profile | null> {
    const { rows } = await this.db.query<Profile>(
      `SELECT p.id, p.display_name, p.email,
              COALESCE(
                json_agg(json_build_object(
                  'household_id', h.id, 'household_name', h.name, 'role', m.role,
                  'grants', m.grants, 'capacity_flag', m.capacity_flag
                ) ORDER BY h.name) FILTER (WHERE m.id IS NOT NULL),
                '[]'
              ) AS memberships
         FROM person p
         LEFT JOIN membership m ON m.person_id = p.id AND m.revoked_at IS NULL
         LEFT JOIN household h ON h.id = m.household_id
        WHERE p.id = $1
        GROUP BY p.id`,
      [personId],
    );
    return rows[0] ?? null;
  }
}
