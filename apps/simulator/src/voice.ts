// Giving the simulated Alexa+ a voice (WS12).
//
// Alexa's own voice is not available to anyone outside Amazon — it was built for Alexa and is not
// in Polly's catalogue. Polly is the same text-to-speech family underneath, so its generative
// voices are as close as a third party can get, and `Joanna` is the nearest to the register people
// recognise. This is deliberately a *device* concern and lives in the simulator: Recall is the
// memory, and it neither speaks nor decides how anything sounds.
import { type Engine, PollyClient, SynthesizeSpeechCommand, type VoiceId } from '@aws-sdk/client-polly';

/** Long answers are for reading, not listening; anything past this is spoken up to a sentence end. */
const MAX_SPOKEN = 700;
/** The same sentence comes back a lot in a demo — replays especially. */
const CACHE_SIZE = 40;

export interface Spoken {
  /** MP3, base64, so it rides back with the reply instead of costing a second round trip. */
  audio: string;
  voice: string;
  ms: number;
}

/** Cut to a sentence end rather than mid-word, so a long answer stops cleanly. */
export function speakable(reply: string, max = MAX_SPOKEN): string {
  const text = reply.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export class Voice {
  private readonly polly: PollyClient;
  private readonly cache = new Map<string, Spoken>();

  constructor(
    region: string,
    private readonly voiceId: VoiceId,
    private readonly engine: Engine,
  ) {
    this.polly = new PollyClient({ region });
  }

  /**
   * Null rather than throwing: a demo that loses its voice should carry on in text, not fall over.
   * The reason is logged once here so it is findable without breaking the turn.
   */
  async say(reply: string): Promise<Spoken | null> {
    const text = speakable(reply);
    if (!text) return null;
    const hit = this.cache.get(text);
    if (hit) return hit;

    const started = performance.now();
    try {
      const out = await this.polly.send(
        new SynthesizeSpeechCommand({
          Text: text,
          VoiceId: this.voiceId,
          Engine: this.engine,
          OutputFormat: 'mp3',
        }),
      );
      const bytes = await out.AudioStream?.transformToByteArray();
      if (!bytes?.length) return null;
      const spoken: Spoken = {
        audio: Buffer.from(bytes).toString('base64'),
        voice: this.voiceId,
        ms: Math.round(performance.now() - started),
      };
      if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(text, spoken);
      return spoken;
    } catch (err) {
      console.warn(`voice: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
