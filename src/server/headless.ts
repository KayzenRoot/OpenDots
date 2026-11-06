import { HttpAgent, type Message } from '@ag-ui/client';
import { randomUUID } from 'node:crypto';
import { voiceReceiptMessagePrefix } from '../shared/voice-receipt.js';
import { scheduledTaskMessagePrefix } from '../shared/scheduled-message.js';

export function currentTurnText(messages: Message[], error?: Error): string {
  if (error) throw error;
  const content = messages
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new Error('The current compute turn returned no assistant response.');
  return content;
}

/**
 * Server-side turn against our own SSE runtime. The runtime serves the local
 * thread backend, so no CopilotKit hosted service or API key is involved.
 */
export async function runThreadTurn(
  runtimeUrl: string,
  headers: Record<string, string>,
  dotId: string,
  threadId: string,
  prompt: string,
  signal: AbortSignal,
  metadata?: Record<string, unknown>,
): Promise<string> {
  signal.throwIfAborted();
  const response = await fetch(`${runtimeUrl}/info`, { headers, signal });
  if (!response.ok)
    throw new Error(`Runtime returned HTTP ${response.status}.`);
  const info = (await response.json()) as { agents?: Record<string, unknown> };
  if (!info.agents || !Object.hasOwn(info.agents, dotId))
    throw new Error('The selected Dot is unavailable in the runtime.');
  const agent = new HttpAgent({
    url: `${runtimeUrl}/agent/${encodeURIComponent(dotId)}/run`,
    agentId: dotId,
    threadId,
    headers,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  });
  let runError: Error | undefined;
  const subscription = agent.subscribe({
    onRunErrorEvent: ({ event }) => {
      runError = new Error(event.message);
    },
  });
  const stop = () => agent.abortRun();
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const idPrefix =
      metadata?.nexbotSource === 'voice_receipt'
        ? voiceReceiptMessagePrefix
        : metadata?.nexbotSource === 'scheduled_task'
          ? scheduledTaskMessagePrefix
          : '';
    agent.addMessage({
      id: `${idPrefix}${randomUUID()}`,
      role: 'user',
      content: prompt,
      ...(metadata ? { metadata } : {}),
    });
    const result = await agent.runAgent();
    signal.throwIfAborted();
    return currentTurnText(result.newMessages, runError);
  } finally {
    signal.removeEventListener('abort', stop);
    subscription.unsubscribe();
    await agent.detachActiveRun();
  }
}
