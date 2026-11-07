import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conversation, State, WorkspaceState } from '../src/shared/types';

const harness = vi.hoisted(() => ({
  api: vi.fn(),
  chat: vi.fn(),
  threadList: {} as {
    onDelete?: (id: string) => void;
    onSelect?: (id: string) => void;
  },
}));

vi.mock('../src/client/api', () => ({
  api: harness.api,
  setToken: vi.fn(),
  authHeaders: () => ({}),
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));
vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../src/client/Chat', () => ({
  Chat: (props: { thread: Conversation }) => {
    harness.chat(props.thread);
    return null;
  },
}));
vi.mock('../src/client/ThreadList', () => ({
  ThreadList: (props: {
    onDelete?: (id: string) => void;
    onSelect?: (id: string) => void;
  }) => {
    harness.threadList = props;
    return null;
  },
}));
vi.mock('../src/client/Mascot', () => ({ Mascot: () => null }));
vi.mock('../src/client/SpaceNav', () => ({ SpaceNav: () => null }));
vi.mock('../src/client/SpaceWorkspace', () => ({ SpaceWorkspace: () => null }));
vi.mock('../src/client/ResultPane', () => ({ ResultPane: () => null }));
vi.mock('../src/client/TaskPresentation', () => ({ TaskRow: () => null }));
vi.mock('../src/client/TaskActions', () => ({ TaskActions: () => null }));
vi.mock('../src/client/WorkspaceDialog', () => ({
  WorkspaceDialog: () => null,
}));
vi.mock('../src/client/setup-telemetry', () => ({
  trackSetupStep: () => () => {},
}));

import { App } from '../src/client/App';
import { setLocalePreference } from '../src/client/i18n';
setLocalePreference('en');

const state: State = {
  settings: {
    name: 'NexBot',
    paused: false,
    researchAllowed: false,
    memoryAllowed: false,
    appsAllowed: false,
  },
  tasks: [],
  memories: [],
  mode: 'live',
  configured: true,
};
const conversation = (id: string): Conversation =>
  ({
    id,
    dotId: 'dot',
    ownerId: 'owner',
    title: id === 'thread-1' ? 'Doomed chat' : 'Keep me',
    createdAt: 1,
    learningContainerId: null,
  }) as Conversation;
const workspaceWith = (conversations: Conversation[]): WorkspaceState =>
  ({
    spaces: [{ id: 'space', name: 'Space', description: '', createdAt: 0 }],
    dots: [
      {
        id: 'dot',
        spaceId: 'space',
        spaceIds: ['space'],
        name: 'Dot',
        instructions: 'Help.',
        researchAllowed: false,
        memoryAllowed: false,
        appsAllowed: false,
        learningEnabled: false,
        skillDeliveryEnabled: false,
        learningContainerId: null,
        composioToolkits: [],
        composioSessionId: null,
        composioPolicyHash: null,
        createdAt: 0,
      },
    ],
    conversations,
    setup: {
      intelligence: true,
      model: true,
      browser: false,
      voice: false,
      composio: false,
      slack: 'not_configured',
      missing: [],
    },
    calls: [],
  }) as WorkspaceState;

let root: ReactTestRenderer | undefined;
beforeEach(() => {
  harness.api.mockReset();
  harness.chat.mockReset();
  harness.threadList = {};
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    confirm: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hash: '', pathname: '/', search: '' },
  });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
  vi.stubGlobal('history', { replaceState: () => {} });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

it('deleting the open conversation navigates to the remaining conversation, not a dead thread', async () => {
  const respond = (conversations: Conversation[]) =>
    harness.api.mockImplementation(async (path: string, method = 'GET') => {
      if (path === '/state') return state;
      if (path === '/workspace') return workspaceWith(conversations);
      if (path === `/threads/${id}` && method === 'DELETE') return { ok: true };
      if (path.endsWith('/capture')) return null;
      return null;
    });
  respond([conversation('thread-1'), conversation('thread-2')]);
  await act(async () => {
    root = create(createElement(App));
  });
  // Open the first conversation.
  await act(async () => {
    harness.threadList.onSelect!('thread-1');
  });
  expect(harness.chat.mock.calls.at(-1)?.[0]).toMatchObject({
    id: 'thread-1',
  });
  const id = 'thread-1';
  const renderedBefore = harness.chat.mock.calls.length;
  await act(async () => {
    harness.threadList.onDelete!('thread-1');
  });
  expect(harness.api).toHaveBeenCalledWith(`/threads/${id}`, 'DELETE', {});
  // The UI lands on the remaining conversation of the same Dot.
  expect(harness.chat.mock.calls.at(-1)?.[0]).toMatchObject({
    id: 'thread-2',
  });
  // And the deleted thread never renders again after the delete.
  const renderedAfter = harness.chat.mock.calls
    .slice(renderedBefore)
    .map(([rendered]) => rendered.id);
  expect(renderedAfter).not.toContain('thread-1');
});

it('a refused deletion keeps the conversation open and surfaces the reason', async () => {
  harness.api.mockImplementation(async (path: string, method = 'GET') => {
    if (path === '/state') return state;
    if (path === '/workspace')
      return workspaceWith([
        conversation('thread-1'),
        conversation('thread-2'),
      ]);
    if (path === '/threads/thread-1' && method === 'DELETE')
      throw new Error(
        'This Dot still has 1 conversation. Delete the conversation first; deleting a Dot never removes conversations.',
      );
    if (path.endsWith('/capture')) return null;
    return null;
  });
  await act(async () => {
    root = create(createElement(App));
  });
  await act(async () => {
    harness.threadList.onSelect!('thread-1');
  });
  await act(async () => {
    harness.threadList.onDelete!('thread-1');
  });
  // The open conversation survives a failed delete.
  expect(harness.chat.mock.calls.at(-1)?.[0]).toMatchObject({
    id: 'thread-1',
  });
  const text = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number')
      return String(value);
    if (Array.isArray(value)) return value.map(text).join(' ');
    if (value && typeof value === 'object') {
      const children = (value as { props?: { children?: unknown } }).props
        ?.children;
      return children === undefined ? '' : text(children);
    }
    return '';
  };
  const alerts = root!.root.findAllByProps({ role: 'alert' });
  expect(
    alerts.some((node) =>
      text(node.props.children).includes('still has 1 conversation'),
    ),
  ).toBe(true);
});
