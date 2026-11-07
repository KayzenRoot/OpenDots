import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api }));
// The open-document case only needs the editor's identity, not its tree.
const documentSpy = vi.hoisted(() => ({ pageId: '' as string | undefined }));
vi.mock('../src/client/PageDocument', () => ({
  PageDocument: ({ page }: { page: { id: string } }) => {
    documentSpy.pageId = page.id;
    return null;
  },
}));
import { SpaceWorkspace } from '../src/client/SpaceWorkspace';
import { setLocalePreference } from '../src/client/i18n';
// These assertions cover the English copy; pin it regardless of the machine.
setLocalePreference('en');

const page = (id: string, title = id) => ({
  id,
  spaceId: 'space',
  parentId: null,
  title,
  content: `content of ${id}`,
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  sourceThreadId: null,
});
const space = { id: 'space', name: 'Everyday', description: '', createdAt: 0 };
const props = (pageId?: string) => ({
  space,
  pageId,
  workspace: {} as never,
  paused: false,
  onPage: vi.fn(),
  onDirty: vi.fn(),
  onRefresh: vi.fn(),
  onSchedule: vi.fn(),
  onThread: vi.fn(),
  onSettings: vi.fn(),
  onCreateDot: vi.fn(),
});
const titles = (root: ReactTestRenderer) =>
  root.root.findAllByType('h3').map((node) => node.props.children);

beforeEach(() => {
  api.mockReset();
  documentSpy.pageId = undefined;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('drops a library row that a fresh poll no longer lists (deleted in another tab)', async () => {
  const a = page('a', 'Alpha');
  const b = page('b', 'Beta');
  api.mockResolvedValue([a, b]);
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(SpaceWorkspace, props()));
  });
  expect(titles(root)).toEqual(['Alpha', 'Beta']);
  // The other tab deleted Alpha; later polls omit it and must reconcile.
  api.mockResolvedValue([b]);
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
  });
  expect(titles(root)).toEqual(['Beta']);
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
  });
  expect(titles(root)).toEqual(['Beta']);
  root.unmount();
});

it('keeps a page created while a list poll was in flight, then reconciles', async () => {
  const b = page('b', 'Beta');
  const created = page('new', 'Created');
  let release!: (pages: unknown[]) => void;
  api.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(SpaceWorkspace, props()));
  });
  expect(titles(root)).toEqual([]);
  api.mockImplementation(async (_path: string, method?: string) =>
    method === 'POST' ? created : [b, created],
  );
  // Both the header button and the empty-state button call onNew.
  const newPage = root.root.findAllByProps({
    className: 'document-primary',
  })[0];
  await act(async () => {
    newPage.props.onClick();
  });
  expect(titles(root)).toEqual(['Created']);
  // The poll that started before the create must not remove the new row even
  // though its older snapshot does not know about it.
  await act(async () => {
    release([b]);
  });
  expect(titles(root)).toEqual(['Beta', 'Created']);
  // A fresh poll that lists the page keeps it listed normally.
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
  });
  expect(titles(root)).toEqual(['Beta', 'Created']);
  root.unmount();
});

it('keeps the open draft mounted with a warning when its page is deleted elsewhere', async () => {
  const a = page('a', 'Alpha');
  api.mockResolvedValue([a]);
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(SpaceWorkspace, props('a')));
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(documentSpy.pageId).toBe('a');
  api.mockResolvedValue([]);
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
  });
  // The editor stays mounted so the local draft is not unmounted…
  expect(documentSpy.pageId).toBe('a');
  // …and an accessible warning explains the external deletion.
  const alerts = root.root.findAllByProps({ role: 'alert' });
  expect(
    alerts.some((node) =>
      JSON.stringify(node.props.children).includes('deleted in another tab'),
    ),
  ).toBe(true);
  root.unmount();
});
