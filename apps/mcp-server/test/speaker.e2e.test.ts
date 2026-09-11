// resolve_speaker (simulated Voice ID): a confident voice match is the speaker; a weak one, or a
// device's usual person, is only a candidate to confirm; otherwise nobody.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, personId, startApp, type TestApp, type TestHousehold } from './support.js';

interface Resolved {
  speaker: { name: string; role: string } | null;
  speaker_candidate?: string;
  confidence: number | null;
  source: string;
}

let t: TestApp;
let hh: TestHousehold;
let client: Client;

const resolve = (args: Record<string, unknown>) => callTool<Resolved>(client, 'resolve_speaker', args);

beforeAll(async () => {
  t = await startApp();
  hh = await t.createHousehold([
    ['Alice', 'owner'],
    ['Som', 'cared_for'],
  ]);
  client = await t.mcp(hh.token);
  await t.db.query(
    `INSERT INTO device (household_id, device_id, region, primary_person_id) VALUES ($1, 'bedroom-echo', 'my', $2)`,
    [hh.id, personId(hh, 'Som')],
  );
});

afterAll(() => t?.close());

describe('resolve_speaker', () => {
  it('trusts a confident voice match', async () => {
    expect(await resolve({ name: 'Alice', confidence: 0.92 })).toMatchObject({
      speaker: { name: 'Alice', role: 'owner' },
      confidence: 0.92,
      source: 'voice',
    });
  });

  it('offers a weak voice match only as a candidate', async () => {
    expect(await resolve({ name: 'Alice', confidence: 0.4 })).toMatchObject({
      speaker: null,
      speaker_candidate: 'Alice',
      source: 'voice',
    });
  });

  it("treats a device's usual person as a guess to confirm, never as the speaker", async () => {
    expect(await resolve({ device: 'bedroom-echo' })).toMatchObject({
      speaker: null,
      speaker_candidate: 'Som',
      confidence: 0.5,
      source: 'device',
    });
  });

  it('says so when nobody is recognised', async () => {
    expect(await resolve({ name: 'Zed', device: 'garage' })).toMatchObject({ speaker: null, source: 'unknown' });
  });
});
