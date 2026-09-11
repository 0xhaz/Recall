import { Inject, Injectable } from '@nestjs/common';
import { asDeviceState, type DeviceStateView, describeDeviceState } from '@recall/core';
import { Db } from '../db/db.js';

export interface DeviceSummary {
  device_id: string;
  name: string | null;
  location: string | null;
  last_seen_at: string;
  state: DeviceStateView;
}

interface DeviceRow {
  device_id: string;
  name: string | null;
  location: string | null;
  last_seen_at: Date;
  state: unknown;
}

@Injectable()
export class DeviceService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** What each device last reported, evaluated now (timers count down, past alarms drop off). */
  async state(householdId: string, deviceId?: string, now: Date = new Date()): Promise<DeviceSummary[]> {
    const { rows } = await this.db.query<DeviceRow>(
      `SELECT device_id, name, location, last_seen_at, state FROM device
        WHERE household_id = $1 AND ($2::text IS NULL OR device_id = $2)
        ORDER BY device_id`,
      [householdId, deviceId ?? null],
    );
    return rows.map((d) => ({
      device_id: d.device_id,
      name: d.name,
      location: d.location,
      last_seen_at: d.last_seen_at.toISOString(),
      state: describeDeviceState(asDeviceState(d.state), now),
    }));
  }

  async primaryPerson(householdId: string, deviceId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ primary_person_id: string | null }>(
      'SELECT primary_person_id FROM device WHERE household_id = $1 AND device_id = $2',
      [householdId, deviceId],
    );
    return rows[0]?.primary_person_id ?? null;
  }
}
