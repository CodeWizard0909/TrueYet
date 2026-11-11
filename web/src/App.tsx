import { Fragment, useEffect, useRef, useState } from 'react';
import { chat, health, loadThread, type AgentEvent } from './api.ts';
import { Markdown } from './Markdown.tsx';
import { DogAvatar, Mascot, PACK, type Breed, type DogState } from './Mascot.tsx';
import { isDemo, MAX_GAP_MS, RECORDINGS } from './demo.ts';
import { breedForStep, crewStatus, holdTime, stateForBreed, withStage, type CrewState } from './director.ts';
import type { RecheckRow, SourceRef } from '../../src/agent/events.ts';

type Step = { id: string; label: string; status: 'running' | 'done' | 'failed' };
type MemoryEvent = Extract<AgentEvent, { type: 'memory' }>;

interface Message {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  at?: string;
  steps: Step[];
  sources: SourceRef[];
  memory?: MemoryEvent;
  recheck?: RecheckRow[];
  tier?: string;
  timings?: Record<string, number>;
  error?: string;
  streaming?: boolean;
  /** The dogs that worked on this answer, in hand-off order. */
  trail?: Breed[];
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: fall back to per-page state */
  }
  return value ?? null;
}

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = store('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const CREW_LABEL: Record<CrewState, string> = { resting: 'resting', working: 'working…', waiting: 'waiting', done: 'done ✓' };

function threadIdFromStorage(): string {
  return store('threadId') ?? store('threadId', crypto.randomUUID())!;
}

const DEMO = isDemo();
const DEMO_EXAMPLES = RECORDINGS.map((r) => ({ tag: r.id.includes('recheck') ? 'recheck' : 'search', text: r.question }));

const EXAMPLES = [
  { tag: 'search', text: 'Which managed Postgres hosts have the best free tier right now?' },
  { tag: 'research', text: 'Shortlist 5 CRM tools for a 20-person sales team, with pricing.' },
  { tag: 'memory', text: 'What did I ask you on 3 November? Is your answer still correct today?' },
];

export function App() {
  const [threadId, setThreadId] = useState(threadIdFromStorage);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [celebrateTurn, setCelebrateTurn] = useState<string | null>(null);
  const [preview, setPreview] = useState<Breed | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The dog watches the input box while you type, and loses interest ~1.5s after you stop.
  function onType(value: string) {
    setInput(value);
    setTyping(value.trim().length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  }
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState<string | null>(() => store('fixedNow'));
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Day/night: starts from the system setting, then remembers the user's choice.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store('theme', theme);
  }, [theme]);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof health>>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void health().then(setStatus);
  }, []);

  useEffect(() => {
    if (DEMO) {
      setMessages([]); // demo replays never touch the server or your saved history
      return;
    }
    void loadThread(threadId).then((turns) =>
      setMessages(turns.map((t) => ({ key: `t${t.id}`, role: t.role, text: t.text, at: t.at, steps: [], sources: [] }))),
    );
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const updateLast = (fn: (m: Message) => Message) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1]!)]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setTyping(false);
    setBusy(true);
    setCelebrateTurn(null);
    const at = now ?? new Date().toISOString();
    const replyKey = `a${Date.now()}`;
    setMessages((ms) => [
      ...ms,
      { key: `u${Date.now()}`, role: 'user', text, at, steps: [], sources: [] },
      { key: replyKey, role: 'assistant', text: '', steps: [], sources: [], streaming: true, trail: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let ok = false;
    try {
      for await (const e of chat({ threadId, text, timeZone }, { now, signal: controller.signal })) {
        if (e.type === 'done') ok = true;
        updateLast((m) => apply(m, e));
      }
    } catch (err) {
      if (!controller.signal.aborted) updateLast((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      updateLast((m) => ({ ...m, streaming: false }));
      setBusy(false);
      abortRef.current = null;
      if (ok) setCelebrateTurn(replyKey);
    }
  }

  function newThread() {
    abortRef.current?.abort();
    setMessages([]);
    setThreadId(store('threadId', crypto.randomUUID())!);
  }

  function setFixedNow(value: string) {
    setNow(store('fixedNow', value ? new Date(value).toISOString() : null));
  }

  const last = messages[messages.length - 1];
  const reply = last?.role === 'assistant' ? last : undefined;
  const director = useDirector(reply?.trail ?? [], reply?.key);
  const playing = busy || !director.caughtUp;
  const celebrating = celebrateTurn !== null && celebrateTurn === reply?.key && !playing;

  // Clear the celebration a moment after the director has finished playing the hand-offs.
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrateTurn(null), 2200);
    return () => clearTimeout(t);
  }, [celebrating]);

  // Who is on stage, and what they are doing.
  let breed: Breed = 'biscuit';
  let stageState: DogState = 'idle';
  if (preview && !playing) {
    breed = preview; // clicked in the pack bar
    stageState = 'happy';
  } else if (reply?.error && !busy) {
    breed = director.breed ?? 'biscuit';
    stageState = 'error';
  } else if (playing) {
    breed = director.breed ?? 'biscuit';
    // Biscuit after a hand-off is writing the answer; Biscuit first in line is planning.
    const writing = breed === 'biscuit' && (director.index > 0 || (director.caughtUp && Boolean(reply?.text)));
    stageState = stateForBreed(breed, writing);
  } else if (celebrating) {
    breed = director.breed ?? 'biscuit';
    stageState = 'happy';
  }
  const statusLine = statusFor(breed, stageState, reply, preview !== null && !playing);
  // Everyone involved in this question and what they are doing right now (truthful and concurrent).
  const crew = crewStatus(reply?.steps ?? [], { busy, hasText: Boolean(reply?.text) });
  const helpers = (Object.keys(PACK) as Breed[]).filter((b) => b !== breed && crew[b] !== 'resting');

  function meet(b: Breed) {
    setPreview(b);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreview(null), 2600);
  }


  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-name">BYTE</span>
          <span className="brand-sub">chat agent · v0.1</span>
        </div>
        <div className="stage" data-stage={breed}>
          <Mascot breed={breed} state={stageState} size={200} attention={typing && !busy} say={preview && !busy ? `hi, I'm ${PACK[breed].name}!` : undefined} />
          {!preview && helpers.length > 0 && (
            <ul className="crew-row" aria-label="Also working on this question">
              {helpers.map((b) => (
                <li key={b} data-crew={crew[b]} title={`${PACK[b].name}: ${CREW_LABEL[crew[b]]}`}>
                  <DogAvatar breed={b} size={26} />
                  <span className="crew-badge">{crew[b] === 'done' ? '✓' : crew[b] === 'working' ? '•••' : '…'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="status" aria-live="polite">
          <span className="prompt">&gt;</span> {statusLine}
          {busy && <span className="cursor">▍</span>}
        </div>
        <ul className="pack" aria-label="The Savvy Paws">
          {(Object.keys(PACK) as Breed[]).map((b) => (
            <li key={b}>
              <button type="button" className={b === breed ? 'on' : ''} data-crew={crew[b]} onClick={() => meet(b)} disabled={playing}>
                <DogAvatar breed={b} size={34} />
                <span>
                  <b>{PACK[b].name}</b>
                  <small>{PACK[b].job}</small>
                </span>
                <span className="crew-chip" aria-label={`${PACK[b].name} is ${CREW_LABEL[crew[b]]}`}>
                  {CREW_LABEL[crew[b]]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <label className="travel" title="Pretend it is this moment, to test memory across days.">
          <span>{now ? 'pretend now' : 'clock: real time'}</span>
          <input type="datetime-local" value={now ? toLocalInput(now) : ''} onChange={(e) => setFixedNow(e.target.value)} />
          {now && (
            <button className="link" onClick={() => setFixedNow('')}>
              reset
            </button>
          )}
        </label>
      </aside>

      <section className="chat">
        <header className="topbar">
          <div className="mini-dog" data-stage={breed}>
            <Mascot breed={breed} state={stageState} size={44} bubble={false} attention={typing && !busy} />
          </div>
          <div className="topbar-status">
            <span className="prompt">&gt;</span> {statusLine}
          </div>
          <button
            className="btn btn-theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}
            title={theme === 'dark' ? 'Day theme' : 'Night theme'}
          >
            {theme === 'dark' ? '☀ day' : '☾ night'}
          </button>
          <button className="btn" onClick={newThread}>
            + new chat
          </button>
        </header>

        {DEMO && <DemoBanner />}

        {!DEMO && status && (!status.modelKey || status.searchProviders.length === 0) && (
          <div className="banner">
            {!status.modelKey && 'No model API key (ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY). '}
            {status.searchProviders.length === 0 && 'No search key (EXA_API_KEY or BRAVE_API_KEY), so answers will not use the web. '}
            Copy .env.example to .env and restart.
          </div>
        )}

        <main>
          {messages.length === 0 && (
            <div className="empty">
              <h1>
                Fetches facts.
                <br />
                <span className="hl">Remembers them.</span>
              </h1>
              <p>Ask anything and Byte searches, cites and remembers. Next week, ask what you asked, or whether that answer still holds.</p>
              <div className="examples">
                {(DEMO ? DEMO_EXAMPLES : EXAMPLES).map((e) => (
                  <button key={e.text} className="example" onClick={() => send(e.text)}>
                    <span className={`tag tag-${e.tag}`}>{e.tag}</span>
                    {e.text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageView key={m.key} m={m} />
          ))}
          <div ref={endRef} />
        </main>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            placeholder={DEMO ? 'Demo replay: click an example above' : 'Throw Byte a question…'}
            rows={1}
            onChange={(e) => onType(e.target.value)}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn btn-stop" onClick={() => abortRef.current?.abort()}>
              stop
            </button>
          ) : (
            <button type="submit" className="btn btn-go" disabled={!input.trim()}>
              fetch ↵
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

/**
 * Plays a turn's hand-off trail one dog at a time, holding each on stage long
 * enough to be seen (memory lookup takes milliseconds; nobody would see Bones).
 */
function useDirector(trail: Breed[], turnKey: string | undefined) {
  const [index, setIndex] = useState(0);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    setIndex(0);
    shownAt.current = Date.now();
  }, [turnKey]);

  const behind = trail.length - 1 - index;
  useEffect(() => {
    if (behind <= 0) return;
    const wait = Math.max(0, holdTime(behind) - (Date.now() - shownAt.current));
    const t = setTimeout(() => {
      shownAt.current = Date.now();
      setIndex((i) => i + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [behind, index]);

  const safe = Math.min(index, Math.max(trail.length - 1, 0));
  return { breed: trail[safe] as Breed | undefined, index: safe, caughtUp: behind <= 0 };
}

/** The status line under the stage: who is on stage, and what they are doing right now. */
function statusFor(breed: Breed, state: DogState, m: Message | undefined, previewing: boolean): string {
  const name = PACK[breed].name;
  if (previewing) return `${name} ${PACK[breed].job}`;
  const latest = m ? [...m.steps].reverse().find((s) => breedForStep(s.id) === breed) : undefined;
  const detail = (latest?.label ?? '').replace(/^(Searching|Searched|Checking|Checked):?\s*/i, '').toLowerCase();
  switch (state) {
    case 'thinking':
      return `${name} is working out what you mean`;
    case 'searching':
      return breed === 'watch' ? `${name} is rechecking ${detail || 'old answers'}` : `${name} is sniffing: ${detail || 'the web'}`;
    case 'remembering':
      return `${name} is digging through memory…`;
    case 'answering':
      return `${name} is writing it up${m?.sources.length ? ` · ${m.sources.length} sources fetched` : ''}`;
    case 'happy':
      return `${name}: good dog! ${m?.sources.length ? `${m.sources.length} sources fetched` : 'done'}`;
    case 'error':
      return `${name} says ruh-roh. something broke (see below)`;
    default:
      return `${name} is napping. ask anything`;
  }
}

function apply(m: Message, e: AgentEvent): Message {
  switch (e.type) {
    case 'text':
      return { ...m, text: m.text + e.delta, trail: withStage(m.trail ?? [], { type: 'text' }) };
    case 'step': {
      const others = m.steps.filter((s) => s.id !== e.id);
      const trail = e.status === 'running' ? withStage(m.trail ?? [], { type: 'step-start', id: e.id }) : m.trail;
      return { ...m, steps: [...others, { id: e.id, label: e.label, status: e.status }], trail };
    }
    case 'source':
      return { ...m, sources: [...m.sources, e.source] };
    case 'memory':
      return { ...m, memory: e };
    case 'recheck':
      return { ...m, recheck: e.rows };
    case 'plan':
      return { ...m, tier: e.tier };
    case 'done':
      return { ...m, tier: e.tier, timings: e.timings };
    case 'error':
      return { ...m, error: e.message };
  }
}

function MessageView({ m }: { m: Message }) {
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">{m.text}</div>
        {m.at && <time>{new Date(m.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>}
      </div>
    );
  }
  const total = m.timings ? Math.max(...Object.values(m.timings)) : null;
  return (
    <div className={`msg assistant${m.error ? ' has-error' : ''}`}>
      <div className="msg-head">
        <TrailView trail={m.trail?.length ? m.trail : ['biscuit']} />
        {m.tier && <span className={`tag tag-${m.tier}`}>{m.tier}</span>}
        {total !== null && <span className="took">{(total / 1000).toFixed(1)}s</span>}
      </div>

      {m.steps.length > 0 && (
        <ol className="log">
          {m.steps.map((s) => (
            <li key={s.id} className={s.status}>
              <span className="mark">{s.status === 'running' ? '…' : s.status === 'done' ? 'ok' : 'x'}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {m.streaming && !m.text && m.steps.length === 0 && <div className="log"><span className="mark">…</span>thinking</div>}
      {m.text && <Markdown text={m.text} sources={m.sources} />}
      {m.error && <div className="error">{m.error}</div>}

      {!m.streaming && (m.sources.length > 0 || m.memory) && (
        <div className="extras">
          {m.sources.length > 0 && (
            <details className="drawer">
              <summary>fetched {m.sources.length} sources</summary>
              <ol className="sources">
                {m.sources.map((s) => (
                  <li key={s.n} value={s.n}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                    <span className="host">
                      {hostOf(s.url)}
                      {s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {m.memory && <MemoryDrawer memory={m.memory} />}
        </div>
      )}
    </div>
  );
}

/** The dogs that handled an answer, in hand-off order: Biscuit › Bones › Watch › Biscuit. */
function TrailView({ trail }: { trail: Breed[] }) {
  const names = [...new Set(trail)].map((b) => PACK[b].name);
  return (
    <span className="trail" title={`Handled by ${trail.map((b) => PACK[b].name).join(' → ')}`}>
      {trail.map((b, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="trail-arrow">›</span>}
          <span className="trail-dog" style={{ animationDelay: `${i * 90}ms` }}>
            <DogAvatar breed={b} size={24} />
          </span>
        </Fragment>
      ))}
      <span className="who">{names.join(' · ').toUpperCase()}</span>
    </span>
  );
}

/** Says plainly that this is a replay of recorded answers, and how to leave it. */
function DemoBanner() {
  const first = RECORDINGS[0]!;
  const day = new Date(first.recordedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="demo-banner" role="note">
      <b>DEMO REPLAY</b>
      <span>
        Real answers recorded on {day} with {first.provider} {first.models.answer} and live web search. No API calls; waits
        over {MAX_GAP_MS / 1000}s are shortened.
      </span>
      <a href={window.location.pathname}>exit demo</a>
    </div>
  );
}

function MemoryDrawer({ memory }: { memory: MemoryEvent }) {
  const count = memory.turns.length + memory.claims.length + memory.collections.length;
  return (
    <details className="drawer memory">
      <summary>dug up {count ? `${count} memories` : 'nothing'}</summary>
      {memory.emptyDays.length > 0 && <p className="dim">No conversation found for: {memory.emptyDays.join(', ')}</p>}
      {memory.collections.map((c) => (
        <p key={c.name}>
          <b>{c.name}:</b> {c.members.join(', ')}
        </p>
      ))}
      {memory.turns.map((t, i) => (
        <p key={i} className="turn">
          <span className="dim">
            {new Date(t.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {t.role}
          </span>
          <br />
          {t.text}
        </p>
      ))}
      {memory.claims.length > 0 && (
        <ul className="claims">
          {memory.claims.map((c, i) => (
            <li key={i} className={c.superseded ? 'superseded' : ''}>
              {c.entity} · {c.attribute}: <b>{c.value}</b> <span className="dim">as of {new Date(c.asOf).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
