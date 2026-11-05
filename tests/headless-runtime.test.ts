import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentSubscriber } from '@ag-ui/client';
import { runThreadTurn } from '../src/server/headless.js';
const sdk = vi.hoisted(() => ({
  run: vi.fn(),
  detach: vi.fn(),
  abort: vi.fn(),
  message: vi.fn(),
  config: vi.fn(),
  unsubscribe: vi.fn(),
  subscriber: undefined as AgentSubscriber | undefined,
}));
vi.mock('@ag-ui/client', () => ({
  HttpAgent: class {
    constructor(config: unknown) {
      sdk.config(config);
    }
    subscribe(subscriber: AgentSubscriber) {
      sdk.subscriber = subscriber;
      return { unsubscribe: sdk.unsubscribe };
    }
    addMessage(message: unknown) {
      sdk.message(message);
    }
    runAgent() {
      return sdk.run();
    }
    detachActiveRun() {
      return sdk.detach();
    }
    abortRun() {
      sdk.abort();
    }
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sdk.subscriber = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const info = (agents: Record<string, unknown>) =>
  Response.json({ mode: 'sse', agents });
it('runs server turns through our own SSE runtime and tears down the stream', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(info({ dot: {} }));
  vi.stubGlobal('fetch', fetcher);
  sdk.run.mockResolvedValue({
    newMessages: [
      { id: 'reply', role: 'assistant', content: 'Confirmed receipt' },
    ],
  });
  expect(
    await runThreadTurn(
      'https://runtime.test',
      { Authorization: 'Bearer test' },
      'dot',
      'thread',
      'Record my call',
      new AbortController().signal,
      { opendotsSource: 'voice_receipt' },
    ),
  ).toBe('Confirmed receipt');
  expect(fetcher).toHaveBeenCalledWith(
    'https://runtime.test/info',
    expect.objectContaining({ headers: { Authorization: 'Bearer test' } }),
  );
  expect(sdk.config).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: 'dot',
      threadId: 'thread',
      url: 'https://runtime.test/agent/dot/run',
      headers: { Authorization: 'Bearer test' },
    }),
  );
  expect(sdk.message).toHaveBeenCalledWith(
    expect.objectContaining({
      id: expect.stringMatching(/^opendots:voice_receipt:/),
      role: 'user',
      content: 'Record my call',
      metadata: { opendotsSource: 'voice_receipt' },
    }),
  );
  expect(sdk.unsubscribe).toHaveBeenCalledOnce();
  expect(sdk.detach).toHaveBeenCalledOnce();
});
it('marks scheduled user prompts while preserving their text and user role', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(info({ dot: {} })),
  );
  sdk.run.mockResolvedValue({
    newMessages: [
      { id: 'reply', role: 'assistant', content: 'Scheduled task complete' },
    ],
  });

  await runThreadTurn(
    'https://runtime.test',
    {},
    'dot',
    'thread',
    'Check the nightly report',
    new AbortController().signal,
    { opendotsSource: 'scheduled_task' },
  );

  expect(sdk.message).toHaveBeenCalledWith(
    expect.objectContaining({
      id: expect.stringMatching(/^opendots:scheduled_task:/),
      role: 'user',
      content: 'Check the nightly report',
      metadata: { opendotsSource: 'scheduled_task' },
    }),
  );
});
it('rejects failed runtime discovery instead of running the agent', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 })),
  );
  await expect(
    runThreadTurn(
      'https://runtime.test',
      {},
      'dot',
      'thread',
      'Call',
      new AbortController().signal,
    ),
  ).rejects.toThrow('HTTP 403');
  expect(sdk.run).not.toHaveBeenCalled();
});
it('rejects a Dot missing from runtime metadata', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(info({})));
  await expect(
    runThreadTurn(
      'https://runtime.test',
      {},
      'dot',
      'thread',
      'Call',
      new AbortController().signal,
    ),
  ).rejects.toThrow('Dot is unavailable');
});

it('aborts the running SDK turn and releases the subscriber on cancellation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(info({ dot: {} })),
  );
  const controller = new AbortController();
  sdk.run.mockImplementation(async () => {
    controller.abort(new Error('Call ended'));
    return {
      newMessages: [{ id: 'late', role: 'assistant', content: 'Late answer' }],
    };
  });
  await expect(
    runThreadTurn(
      'https://runtime.test',
      {},
      'dot',
      'thread',
      'Call',
      controller.signal,
    ),
  ).rejects.toThrow('Call ended');
  expect(sdk.abort).toHaveBeenCalledOnce();
  expect(sdk.unsubscribe).toHaveBeenCalledOnce();
  expect(sdk.detach).toHaveBeenCalledOnce();
  controller.abort();
  expect(sdk.abort).toHaveBeenCalledOnce();
});
it('cleans up rejected SDK turns while preserving the error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(info({ dot: {} })),
  );
  sdk.run.mockRejectedValue(new Error('Runtime socket failed'));
  await expect(
    runThreadTurn(
      'https://runtime.test',
      {},
      'dot',
      'thread',
      'Call',
      new AbortController().signal,
    ),
  ).rejects.toThrow('Runtime socket failed');
  expect(sdk.unsubscribe).toHaveBeenCalledOnce();
  expect(sdk.detach).toHaveBeenCalledOnce();
});
