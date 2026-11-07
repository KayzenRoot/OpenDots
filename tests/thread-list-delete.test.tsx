import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
const useThreads = vi.hoisted(() => vi.fn());
vi.mock('@copilotkit/react-core/v2', () => ({ useThreads }));
import { ThreadList } from '../src/client/ThreadList';
import { setLocalePreference } from '../src/client/i18n';
// These assertions cover the English copy; pin it regardless of the machine.
setLocalePreference('en');

const dot = {
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
} as never;
const thread = (id: string, title: string) => ({
  id,
  dotId: 'dot',
  ownerId: 'owner',
  title,
  createdAt: 1,
  learningContainerId: null,
});
const props = (onDelete?: (id: string) => void) => ({
  dots: [dot],
  dotId: 'dot',
  local: [thread('thread-1', 'Design research'), thread('thread-2', 'Plans')],
  selected: 'thread-1',
  onSelect: vi.fn(),
  onNew: vi.fn(),
  onDelete,
});
const buttons = (root: ReturnType<typeof create>) =>
  root.root.findAllByType('button');

beforeEach(() => {
  useThreads.mockReset().mockReturnValue({
    threads: [],
    error: null,
    hasMoreThreads: false,
    isFetchingMoreThreads: false,
    fetchMoreThreads: vi.fn(),
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

it('offers a labelled delete action for each conversation row', async () => {
  const onDelete = vi.fn();
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(ThreadList, props(onDelete)));
  });
  const deletes = buttons(root).filter((node) =>
    String(node.props['aria-label']).startsWith('Delete conversation'),
  );
  expect(deletes.map((node) => node.props['aria-label'])).toEqual([
    'Delete conversation "Design research"',
    'Delete conversation "Plans"',
  ]);
  await act(async () => {
    deletes[1].props.onClick();
  });
  expect(onDelete).toHaveBeenCalledWith('thread-2');
  root.unmount();
});

it('renders without delete actions when the app does not pass onDelete', async () => {
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(ThreadList, props()));
  });
  expect(
    buttons(root).filter((node) =>
      String(node.props['aria-label']).startsWith('Delete conversation'),
    ),
  ).toEqual([]);
  root.unmount();
});
