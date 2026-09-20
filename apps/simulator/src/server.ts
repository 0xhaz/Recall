// The simulated Alexa+ web app (workplan WS12). Start Recall (pnpm dev), then: pnpm sim
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent, type AgentModel, OllamaAgentModel } from './agent.js';
import { BedrockAgentModel } from './bedrock-model.js';
import { config, DEMO, PRODUCERS } from './config.js';
import { SimHome } from './devices.js';
import { RecallClient } from './recall.js';
import { listReplays, loadReplay, runReplay } from './replay.js';
import { Voice } from './voice.js';

const recall = new RecallClient(config.recallUrl, config.token);
const model: AgentModel =
  config.provider === 'bedrock'
    ? new BedrockAgentModel(config.region, config.bedrockModel)
    : new OllamaAgentModel(config.ollamaUrl, config.model);
const agent = new Agent(recall, model);
const home = new SimHome(recall, DEMO.devices);
// Alexa's own voice is not available outside Amazon; Polly is the same TTS family. Off with SIM_VOICE=off.
const voice =
  config.voice.toLowerCase() === 'off'
    ? null
    : new Voice(config.region, config.voice as never, config.voiceEngine as never);

const PUBLIC = new URL('../public/', import.meta.url);
const STATIC = /^[a-z0-9-]+\.(html|js|css)$/;
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};
const MAX_BODY = 64_000;

interface ReplayRun {
  sent: number;
  done: boolean;
  error?: string;
  stop: AbortController;
}
const replays = new Map<string, ReplayRun>();

class BadRequest extends Error {}

function text(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequest(`Invalid ${what}`);
  return value.trim();
}

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, Handler> = {
  'GET /api/config': async () => ({
    people: DEMO.people,
    devices: DEMO.devices,
    producers: PRODUCERS.map(({ id, label }) => ({ id, label })),
    replays: await listReplays(),
    model: model.model,
    recall: config.recallUrl,
    voice: voice ? { id: config.voice, engine: config.voiceEngine } : null,
  }),

  'GET /api/devices': async () => ({
    ...(await home.views()),
    replays: Object.fromEntries(
      [...replays].map(([name, r]) => [name, { sent: r.sent, done: r.done, error: r.error }]),
    ),
  }),

  'POST /api/say': async (body) => {
    const device = home.device(text(body.device, 64, 'device'));
    const speaker = body.speaker === null || body.speaker === '' ? null : text(body.speaker, 80, 'speaker');
    const confidence =
      typeof body.confidence === 'number' && body.confidence >= 0 && body.confidence <= 1 ? body.confidence : 1;
    const said = text(body.text, 500, 'text');
    home.lastActive = device.info.id;
    const reply = await agent.respond({ device: device.info.id, speaker, confidence, text: said });
    // Spoken alongside the text, not after it: a second round trip would put a gap between the
    // answer appearing and the device saying it, which is exactly what a real device does not do.
    const spoken = voice ? await voice.say(reply.reply) : null;
    await device.recordTurns(speaker, confidence, said, reply.reply);
    return { ...reply, spoken };
  },

  'POST /api/event': async (body) => {
    const producer = PRODUCERS.find((p) => p.id === body.producer);
    if (!producer) throw new BadRequest('Unknown event');
    return { accepted: await home.produce(producer) };
  },

  'POST /api/replay': async (body) => {
    const replay = await loadReplay(text(body.name, 40, 'replay'));
    replays.get(replay.name)?.stop.abort();
    const run: ReplayRun = { sent: 0, done: false, stop: new AbortController() };
    replays.set(replay.name, run);
    const speed = typeof body.speed === 'number' ? body.speed : 1;
    runReplay(replay, recall, {
      timezone: config.timezone,
      speed,
      signal: run.stop.signal,
      onEvent: () => {
        run.sent++;
      },
    })
      .then(() => {
        run.done = true;
      })
      .catch((err: unknown) => {
        run.done = true;
        run.error = err instanceof Error ? err.message : String(err);
      });
    return { started: replay.name, mode: replay.mode };
  },
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest('Request too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BadRequest('Expected a JSON object');
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      send(res, 200, await handler(req.method === 'POST' ? await readBody(req) : {}));
      return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (req.method !== 'GET' || !STATIC.test(file)) {
      send(res, 404, { error: 'Not found' });
      return;
    }
    const content = await readFile(new URL(file, PUBLIC));
    res.writeHead(200, { 'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'text/plain' });
    res.end(content);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    const bad = err instanceof BadRequest || err instanceof SyntaxError;
    send(res, missing ? 404 : bad ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Simulated Alexa+ on http://${config.host}:${config.port} · Recall ${config.recallUrl} · ${model.model}`);
});
