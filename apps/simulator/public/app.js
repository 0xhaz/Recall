// Simulated Alexa+: two devices side by side, a speaker picker standing in for Voice ID, and the
// browser's speech in and out. Every request goes to the simulator, which talks to Recall over MCP.

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

async function api(path, body) {
  const init =
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const panels = [];
let config;

const speaker = () => $('#speaker').value || null;
const confidence = () => Number($('#confidence').value);

function status(text) {
  $('#status').textContent = text;
}

function speak(text) {
  if (!$('#voice').checked || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function bubble(panel, who, text, extra) {
  const node = el('div', { class: `bubble ${who}` }, el('div', { class: 'text' }, text), extra);
  panel.log.append(node);
  panel.log.scrollTop = panel.log.scrollHeight;
  return node;
}

function trace(steps, modelMs) {
  const calls = `${steps.length} Recall call${steps.length === 1 ? '' : 's'}`;
  return el(
    'details',
    { class: 'trace' },
    el('summary', {}, `${calls} · model ${modelMs} ms`),
    el(
      'ol',
      {},
      steps.map((s) =>
        el(
          'li',
          {},
          el('code', {}, s.tool),
          ` ${s.ms} ms`,
          s.error ? el('span', { class: 'error' }, ` ${s.error}`) : null,
          el('pre', {}, JSON.stringify({ args: s.args, result: s.result }, null, 2).slice(0, 4000)),
        ),
      ),
    ),
  );
}

async function say(panel, text) {
  const who = speaker();
  bubble(panel, 'user', `${who ?? 'Someone'}: ${text}`);
  const pending = bubble(panel, 'assistant pending', '…');
  try {
    const res = await api('/api/say', { device: panel.device, speaker: who, confidence: confidence(), text });
    pending.remove();
    bubble(panel, 'assistant', res.reply, trace(res.steps, res.model_ms));
    speak(res.reply);
  } catch (err) {
    pending.remove();
    bubble(panel, 'assistant error', `Error: ${err.message}`);
  }
  refresh();
}

function listen(panel, button) {
  if (!Recognition) {
    bubble(panel, 'assistant error', 'This browser has no speech recognition: type instead.');
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  button.classList.add('live');
  recognition.onresult = (event) => say(panel, event.results[0][0].transcript);
  recognition.onend = () => button.classList.remove('live');
  recognition.start();
}

function makePanel(deviceId) {
  const panel = { device: deviceId };
  const select = el(
    'select',
    {
      onchange: (event) => {
        panel.device = event.target.value;
        refresh();
      },
    },
    config.devices.map((d) => el('option', { value: d.id, selected: d.id === deviceId }, d.name)),
  );
  const input = el('input', { type: 'text', placeholder: 'Say something…', autocomplete: 'off' });
  const mic = el('button', { type: 'button', class: 'mic', title: 'Speak' }, '🎙');
  mic.addEventListener('click', () => listen(panel, mic));
  const form = el(
    'form',
    {
      onsubmit: (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        say(panel, text);
      },
    },
    mic,
    input,
    el('button', { type: 'submit' }, 'Say'),
  );
  panel.log = el('div', { class: 'log' });
  panel.now = el('div', { class: 'now muted' }, 'Nothing playing');
  panel.notices = el('ul', { class: 'notices' });
  panel.memory = el('details', { class: 'memory' }, el('summary', {}, 'On this device'));
  panel.node = el(
    'section',
    { class: 'panel' },
    el('header', {}, select, el('span', { class: 'ring' })),
    panel.now,
    panel.log,
    form,
    panel.notices,
    panel.memory,
  );
  return panel;
}

function renderDevice(panel, view) {
  if (!view) return;
  const playing = view.state?.now_playing;
  const timers = view.state?.timers ?? [];
  panel.now.replaceChildren(
    playing
      ? `${playing.paused ? '⏸' : '▶'} ${playing.title}${playing.source ? ` · ${playing.source}` : ''}`
      : 'Nothing playing',
    ...timers.map((t) =>
      el('span', { class: 'timer' }, ` ⏱ ${t.label ?? 'timer'} ${Math.ceil(t.remaining_s / 60)} min`),
    ),
  );
  panel.notices.replaceChildren(
    ...view.notices.slice(0, 3).map((n) => el('li', {}, `🔔 ${n.text}`)),
    ...view.commands.slice(0, 3).map((c) => el('li', { class: 'muted' }, `⚙ ${c.text}`)),
  );
  const summary = `On this device: ${view.facts.length} facts, ${view.rules.length} rules · synced to #${view.cursor}`;
  panel.memory.replaceChildren(
    el('summary', {}, view.error ? `${summary} · ${view.error}` : summary),
    el(
      'ul',
      {},
      view.rules.map((r) => el('li', { class: 'rule' }, `Rule: ${r}`)),
      view.facts.map((f) => el('li', {}, `${f.content} `, el('span', { class: 'muted' }, f.scope))),
    ),
  );
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api('/api/devices');
    for (const panel of panels)
      renderDevice(
        panel,
        data.devices.find((d) => d.id === panel.device),
      );
    $('#feed').replaceChildren(
      ...data.notices
        .slice(0, 8)
        .map((n) => el('li', {}, el('span', { class: `tag ${n.audience}` }, n.audience), ` ${n.text}`)),
    );
    for (const [name, run] of Object.entries(data.replays)) {
      const line = document.querySelector(`[data-replay="${name}"] .status`);
      if (line) line.textContent = run.error ? `error: ${run.error}` : `${run.sent} sent${run.done ? ' ✓' : '…'}`;
    }
    status(`${config.model} · ${config.recall}`);
  } catch (err) {
    status(`Simulator: ${err.message}`);
  } finally {
    refreshing = false;
  }
}

function trigger(path, body) {
  api(path, body)
    .then(refresh)
    .catch((err) => {
      status(err.message);
    });
}

async function init() {
  config = await api('/api/config');
  const speakers = $('#speaker');
  speakers.append(
    el('option', { value: '' }, 'Unknown voice'),
    ...config.people.map((p) => el('option', { value: p }, p)),
  );
  speakers.value = config.people[0];
  $('#confidence').addEventListener('input', () => {
    $('#confidence-value').textContent = confidence().toFixed(2);
  });
  for (const id of ['kitchen-echo', 'bedroom-echo']) {
    const panel = makePanel(id);
    panels.push(panel);
    $('#panels').append(panel.node);
  }
  $('#producers').append(
    ...config.producers.map((p) =>
      el('button', { type: 'button', onclick: () => trigger('/api/event', { producer: p.id }) }, p.label),
    ),
  );
  $('#replays').append(
    ...config.replays.map((r) =>
      el(
        'div',
        { class: 'replay', 'data-replay': r.name },
        el('button', { type: 'button', onclick: () => trigger('/api/replay', { name: r.name }) }, `▶ ${r.name}`),
        el('span', { class: 'status muted' }),
        el('p', { class: 'muted' }, r.description),
      ),
    ),
  );
  refresh();
  setInterval(refresh, 2000);
}

init().catch((err) => {
  document.body.prepend(el('p', { class: 'error' }, `Could not start: ${err.message}`));
});
