import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api }));
vi.mock('../src/client/ModelSettings', () => ({ ModelSettings: () => null }));
vi.mock('../src/client/DotModelSettings', () => ({
  DotModelSettings: () => null,
}));
vi.mock('../src/client/ConnectionsSection', () => ({
  ConnectionsSection: () => null,
}));
vi.mock('../src/client/SkillsSection', () => ({ SkillsSection: () => null }));
import { WorkspaceDialog, type Dialog } from '../src/client/WorkspaceDialog';
import { setLocalePreference } from '../src/client/i18n';
// These assertions cover the English copy; pin it regardless of the machine.
setLocalePreference('en');

const dot = {
  id: 'dot-1',
  spaceId: 'space',
  spaceIds: ['space'],
  name: 'Scout',
  instructions: 'Be concise.',
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
const dialog: Dialog = { type: 'dot', dot, spaceId: 'space' };
const base = {
  dialog,
  state: {
    settings: {
      name: 'NexBot',
      paused: false,
      researchAllowed: false,
      memoryAllowed: false,
      appsAllowed: false,
    },
    tasks: [],
    memories: [],
    mode: 'live' as const,
    configured: true,
  },
  workspace: {
    spaces: [{ id: 'space', name: 'Space', description: '', createdAt: 0 }],
    dots: [dot],
    conversations: [],
    setup: { missing: [] as string[], slack: 'not_configured', voice: false },
    calls: [],
  } as never,
  onClose: vi.fn(),
  mutate: vi.fn(),
  onDotDeleted: vi.fn(),
};
const buttons = (root: ReturnType<typeof create>) =>
  root.root.findAllByType('button');
/** Collect the text content without tripping over circular element refs. */
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
const findButton = (root: ReturnType<typeof create>, label: string) => {
  const match = buttons(root).find((node) =>
    text(node.props.children).includes(label),
  );
  expect(match, `button "${label}" not found`).toBeTruthy();
  return match!;
};

beforeEach(() => {
  api.mockReset();
  base.onClose.mockClear();
  base.onDotDeleted.mockClear();
  base.mutate.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
  });
  // WorkspaceDialog checks `instanceof HTMLElement` for focus restoration.
  class HTMLElementStub {}
  vi.stubGlobal('HTMLElement', HTMLElementStub);
});

it('deletes the Dot only after its exact name is typed, then navigates away', async () => {
  api.mockResolvedValue({ ok: true });
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(WorkspaceDialog, base));
  });
  // Armed only behind an explicit click; no confirm input is shown before.
  expect(root.root.findAllByType('input').length).toBeGreaterThan(1);
  await act(async () => {
    findButton(root, 'Delete this Dot').props.onClick();
  });
  const nameInput = root.root.findByProps({ id: 'delete-dot-name' });
  const confirm = () => findButton(root, 'Delete Dot');
  expect(confirm().props.disabled).toBe(true);
  await act(async () => {
    nameInput.props.onChange({ target: { value: 'scout' } });
  });
  expect(confirm().props.disabled).toBe(true);
  await act(async () => {
    nameInput.props.onChange({ target: { value: 'Scout' } });
  });
  expect(confirm().props.disabled).toBe(false);
  await act(async () => {
    confirm().props.onClick();
  });
  expect(api).toHaveBeenCalledWith('/dots/dot-1', 'DELETE', {});
  expect(base.onDotDeleted).toHaveBeenCalledWith('dot-1');
  expect(base.onClose).toHaveBeenCalled();
  root.unmount();
});

it('shows the server reason and keeps the dialog when deletion is refused', async () => {
  api.mockRejectedValue(
    new Error(
      'This Dot still has 1 conversation. Delete the conversation first; deleting a Dot never removes conversations.',
    ),
  );
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(WorkspaceDialog, base));
  });
  await act(async () => {
    findButton(root, 'Delete this Dot').props.onClick();
  });
  await act(async () => {
    root.root
      .findByProps({ id: 'delete-dot-name' })
      .props.onChange({ target: { value: 'Scout' } });
  });
  await act(async () => {
    findButton(root, 'Delete Dot').props.onClick();
  });
  const alerts = root.root.findAllByProps({ role: 'alert' });
  expect(
    alerts.some((node) =>
      JSON.stringify(node.props.children).includes('still has 1 conversation'),
    ),
  ).toBe(true);
  expect(base.onDotDeleted).not.toHaveBeenCalled();
  expect(base.onClose).not.toHaveBeenCalled();
  root.unmount();
});
