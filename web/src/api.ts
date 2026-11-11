import type { AgentEvent } from '../../src/agent/events.ts';
import { isDemo, replay } from './demo.ts';

export type { AgentEvent };

/** POSTs a message and yields the agent's server-sent events as they arrive. */
export async function* chat(
  body: { threadId: string; text: string; timeZone: string },
  opts: { now?: string | null; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  // Demo replay: recorded real answers, no API calls.
  if (isDemo()) {
    yield* replay(body.text, opts.signal);
    return;
  }
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.now ? { 'x-now': opts.now } : {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    yield { type: 'error', message: err.error ?? `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as AgentEvent;
    }
  }
}

export async function loadThread(threadId: string) {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { turns: { id: number; role: 'user' | 'assistant'; text: string; at: string }[] };
  return data.turns;
}

export async function health() {
  const res = await fetch('/api/health').catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as { modelKey: boolean; searchProviders: string[]; fixedNow: string | null };
}
