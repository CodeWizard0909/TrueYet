import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AgentDeps } from '../agent/pipeline.ts';
import { runTurn } from '../agent/pipeline.ts';
import { clockFor } from '../lib/clock.ts';
import { isValidTimeZone } from '../memory/time.ts';
import { MISSING_KEY_MESSAGE } from '../agent/models.ts';

const chatBody = z.object({
  threadId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(4000),
  timeZone: z.string().optional(),
});

export function createApp(deps: AgentDeps, config: { hasModelKey: boolean; searchProviders: string[] }) {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({ ok: true, modelKey: config.hasModelKey, searchProviders: config.searchProviders, fixedNow: process.env.NOW ?? null }),
  );

  app.get('/api/threads/:id', (c) => {
    const turns = deps.memory.recentTurns(c.req.param('id'), 200);
    return c.json({ turns: turns.map((t) => ({ id: t.id, role: t.role, text: t.text, at: t.at.toISOString() })) });
  });

  app.post('/api/chat', async (c) => {
    const parsed = chatBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
    const { threadId, text } = parsed.data;
    const timeZone = parsed.data.timeZone && isValidTimeZone(parsed.data.timeZone) ? parsed.data.timeZone : 'UTC';

    let clock;
    try {
      clock = clockFor(c.req.header('x-now'));
    } catch {
      return c.json({ error: 'X-Now must be an ISO 8601 date-time' }, 400);
    }

    return streamSSE(c, async (stream) => {
      // Events are emitted synchronously by the agent; writes are queued so order is kept
      // and the stream isn't closed before the last one is flushed.
      let writes = Promise.resolve();
      const send = (event: object) => {
        writes = writes.then(() => stream.writeSSE({ data: JSON.stringify(event) }));
      };
      try {
        if (!config.hasModelKey) {
          send({ type: 'error', message: MISSING_KEY_MESSAGE });
          return;
        }
        await runTurn(deps, { threadId, text, timeZone, clock, signal: c.req.raw.signal }, send);
      } catch (err) {
        if (c.req.raw.signal.aborted) return;
        console.error('[chat]', err);
        send({ type: 'error', message: friendlyError(err) });
      } finally {
        await writes.catch(() => undefined);
      }
    });
  });

  return app;
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/credit balance|quota|billing/i.test(message)) return 'The model provider account is out of credits or quota. Top it up, or set MODEL_PROVIDER to the other provider in .env.';
  if (/not in request\.tools|tool call validation failed/i.test(message))
    return 'The model tried to use a tool this agent does not have. Please ask again; it usually works on a retry.';
  if (/401|authentication|api key/i.test(message)) return 'The model provider rejected the API key. Check the model API key in .env.';
  if (/429|rate/i.test(message)) return 'Rate limited by a provider. Try again in a few seconds.';
  return `Something went wrong: ${message}`;
}
