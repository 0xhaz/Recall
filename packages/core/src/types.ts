// Domain types shared by the server, workers and console. Shapes follow architecture.md §1.

export type ScopeType = 'person' | 'household' | 'device';
export type FactType = 'episodic' | 'semantic' | 'procedural';
export type SensitivityTag = 'none' | 'pii' | 'health' | 'financial' | 'third_party' | 'child';
export type MembershipRole = 'owner' | 'adult' | 'child' | 'guest' | 'caregiver' | 'cared_for';

export interface EntityRef {
  name: string;
  kind: string;
  ref?: string;
}

export interface FactSource {
  event_id?: string;
  device_id?: string;
  speaker_id?: string;
  speaker_confidence?: number;
  /** 'user' | 'caregiver' | 'extraction' | ... — caregiver-entered facts matter in care mode. */
  origin?: string;
}

export interface Fact {
  id: string;
  household_id: string;
  region: string;
  scope_type: ScopeType;
  scope_id: string;
  type: FactType;
  content: string;
  entities: EntityRef[];
  source: FactSource;
  created_at: string;
  valid_from: string;
  /** null = currently true (bi-temporal supersession, never deletion on update). */
  valid_to: string | null;
  confidence: number;
  sensitivity_tag: SensitivityTag;
  ttl: string | null;
  last_accessed: string | null;
  superseded_by: string | null;
}

/** Device-local time attached to every read response (architecture.md §5). */
export interface TemporalStamp {
  local_date: string;
  local_time: string;
  weekday: string;
  timezone: string;
  utc_offset: string;
  iso_utc: string;
}
