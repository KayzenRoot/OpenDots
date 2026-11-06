import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conversation, State, WorkspaceState } from '../src/shared/types';

const harness = vi.hoisted(() => ({
  api: vi.fn(),
  chat: vi.fn(),
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
vi.mock('../src/client/ThreadList', () => ({ ThreadList: () => null }));
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
const workspace = (conversations: Conversation[]): WorkspaceState =>
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
const created = {
  id: 'created',
  dotId: 'dot',
  ownerId: 'owner',
  title: 'Hello',
  createdAt: 1,
  learningContainerId: null,
} as Conversation;

let root: ReactTestRenderer | undefined;
beforeEach(() => {
  harness.api.mockReset();
  harness.chat.mockReset();
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

it('keeps the created conversation attached when a poll omits it', async () => {
  harness.api.mockImplementation(async (path: string, method = 'GET') => {
    if (path === '/state') return state;
    // The polled snapshot never contains the new conversation, like a refresh
    // that was already in flight before the conversation existed.
    if (path === '/workspace') return workspace([]);
    if (path === '/conversations' && method === 'POST') return created;
    if (path === `/conversations/${created.id}/capture`) return null;
    return null;
  });
  await act(async () => {
    root = create(createElement(App));
  });
  const textarea = root!.root.findByProps({
    'aria-label': 'Start a conversation',
  });
  await act(async () => {
    textarea.props.onChange({ target: { value: 'Hello' } });
  });
  const form = root!.root
    .findAllByType('form')
    .find((node) => node.props.onSubmit);
  await act(async () => {
    form!.props.onSubmit({ preventDefault: () => {} });
  });
  expect(harness.chat).toHaveBeenCalled();
  expect(harness.chat.mock.calls.at(-1)?.[0]).toMatchObject({
    id: created.id,
  });
});
