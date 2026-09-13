'use client';

import { Cpu, Mic, Send, Speaker as SpeakerIcon } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { sayAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SimConfig, SimDevice } from '@/lib/simulator';

const SUGGESTIONS = [
  'What should we cook tonight?',
  'Remember I am off coffee until Wednesday',
  'What do you know about me?',
  'Order dinner from the usual place to Menara KL, level 30',
  'Play something',
];

/** Browsers disagree on the name; both are the same Web Speech API. */
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: (event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void;
  onend: () => void;
  start: () => void;
}

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function SimulatorConsole({
  household,
  config,
  initialDevices,
}: {
  household: string;
  config: SimConfig;
  initialDevices: SimDevice[];
}) {
  const [state, submit, pending] = useActionState(sayAction, {});
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const devices = state.devices ?? initialDevices;
  const addressed = state.device ?? config.devices[0]?.id;

  function listen() {
    const speech = window as unknown as SpeechWindow;
    const Recognition = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!Recognition || !input.current) return;
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? '';
      if (input.current) input.current.value = said;
      form.current?.requestSubmit();
    };
    recognition.onend = () => setListening(false);
    recognition.start();
  }

  return (
    <div className="grid flex-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <form ref={form} action={submit} className="space-y-4">
          <input type="hidden" name="household" value={household} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label-xs">Speaking</span>
              <select
                name="speaker"
                defaultValue={config.people[0] ?? ''}
                className="h-11 rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200"
              >
                <option value="">Unknown voice</option>
                {config.people.map((person) => (
                  <option key={person} value={person}>
                    {person}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="label-xs">Voice match</span>
              <select
                name="confidence"
                defaultValue="0.95"
                className="h-11 rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200"
              >
                <option value="0.95">confident (0.95)</option>
                <option value="0.6">unsure (0.60)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="label-xs">On device</span>
              <select
                name="device"
                defaultValue={config.devices[0]?.id}
                className="h-11 rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200"
              >
                {config.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={listen}
              title="Speak"
              className={listening ? 'border-red-500/60 text-red-300' : ''}
            >
              <Mic className="h-5 w-5" />
            </Button>
            <Input ref={input} name="text" placeholder="Say something to the assistant…" autoComplete="off" required />
            <Button type="submit" disabled={pending} className="bg-cyan-600 text-white hover:bg-cyan-500">
              <Send className="mr-2 h-4 w-4" />
              {pending ? 'Thinking…' : 'Send'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  if (input.current) input.current.value = suggestion;
                }}
                className="rounded-full border border-slate-700/60 px-3 py-1 text-xs text-slate-400 hover:border-cyan-500/40 hover:text-slate-200"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>

        {state.error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{state.error}</p>
        ) : null}

        {state.reply ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
              <p className="label-xs">{state.speaker ?? 'Unknown voice'} said</p>
              <p className="mt-1 text-base text-slate-300">“{state.said}”</p>
              <p className="mt-4 label-xs">The assistant answered</p>
              <p className="mt-1 text-xl leading-relaxed text-slate-100">{state.reply.reply}</p>
              <p className="mt-3 text-xs text-slate-500">
                {config.model} · thought for {seconds(state.reply.model_ms)}
                {state.reply.ask_who ? ' · it does not know who is speaking' : ''}
              </p>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
              <p className="label-xs">What it asked Recall</p>
              <ul className="mt-3 space-y-2">
                {state.reply.steps.map((step, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a finished trace of one reply — fixed order, never edited.
                  <li key={`${step.tool}-${index}`}>
                    <details>
                      <summary className="cursor-pointer text-sm text-slate-200">
                        <code className="text-cyan-300">{step.tool}</code>
                        <span className="ml-2 text-xs text-slate-500">{seconds(step.ms)}</span>
                        {step.error ? <span className="ml-2 text-xs text-red-400">{step.error}</span> : null}
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-900/80 p-3 text-xs text-slate-400">
                        {JSON.stringify({ args: step.args, result: step.result }, null, 2).slice(0, 4000)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-6 text-sm text-slate-400">
            Speak or type, and the assistant answers using only what Recall holds. Every tool call it makes is listed
            here, and anything it changes shows up on the other pages.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <p className="label-xs">Devices</p>
        {devices.map((device) => {
          const playing = device.state?.now_playing;
          const latest = device.commands[0];
          return (
            <div
              key={device.id}
              className={`rounded-xl border p-5 ${
                device.id === addressed ? 'border-cyan-500/50 bg-slate-800/60' : 'border-slate-700/50 bg-slate-800/30'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-base text-slate-100">
                  <Cpu className="h-4 w-4 text-cyan-400" />
                  {device.name}
                </p>
                {device.id === addressed ? <span className="label-xs text-cyan-300">spoken to</span> : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {device.location} · synced to #{device.cursor}
              </p>

              <p className="mt-3 flex items-center gap-2 text-sm text-slate-300">
                <SpeakerIcon className="h-4 w-4 text-slate-500" />
                {playing ? `${playing.paused ? 'paused' : 'playing'}: ${playing.title}` : 'nothing playing'}
              </p>

              {latest ? (
                <p className="mt-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                  carried out: {latest.text}
                </p>
              ) : null}

              {device.notices.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                  {device.notices.slice(0, 2).map((notice) => (
                    <li key={notice.id}>🔔 {notice.text}</li>
                  ))}
                </ul>
              ) : null}

              {device.error ? <p className="mt-2 text-xs text-red-400">{device.error}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
