import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { TaskActions } from '../src/client/TaskActions';
import type { Settings, Task } from '../src/shared/types';
import { setLocalePreference } from '../src/client/i18n';
// These assertions cover the English copy; pin it regardless of the machine.
setLocalePreference('en');
afterEach(() => setLocalePreference('en'));
const settings: Settings = {
  name: 'Dot',
  paused: false,
  researchAllowed: true,
  memoryAllowed: true,
  appsAllowed: false,
};
const task: Task = {
  id: 'one',
  prompt: 'A recurring task',
  status: 'completed',
  intervalSeconds: 3600,
  nextRunAt: Date.now() + 3600000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  error: null,
  lease: null,
  leaseUntil: null,
};
it('offers pause for a completed task waiting on its next scheduled run', () => {
  const html = renderToStaticMarkup(
    <TaskActions
      task={task}
      settings={settings}
      busy={false}
      onAction={() => {}}
      onSchedule={() => {}}
    />,
  );
  expect(html).toContain('Pause schedule');
  expect(html).toContain('Edit schedule');
});
it('offers resume for a paused task without claiming to be running', () => {
  const html = renderToStaticMarkup(
    <TaskActions
      task={{ ...task, status: 'paused' }}
      settings={settings}
      busy={false}
      onAction={() => {}}
      onSchedule={() => {}}
    />,
  );
  expect(html).toContain('Resume task');
  expect(html).not.toContain('Pause schedule');
});
it('labels an interrupted task for owner review before retry', () => {
  const html = renderToStaticMarkup(
    <TaskActions
      task={{ ...task, status: 'interrupted' }}
      settings={settings}
      busy={false}
      onAction={() => {}}
      onSchedule={() => {}}
    />,
  );
  expect(html).toContain('Retry after review');
  expect(html).not.toContain('Pause task');
});
it('renders the Brazilian Portuguese copy when that language is active', () => {
  setLocalePreference('pt-BR');
  const html = renderToStaticMarkup(
    <TaskActions
      task={task}
      settings={settings}
      busy={false}
      onAction={() => {}}
      onSchedule={() => {}}
    />,
  );
  expect(html).toContain('Pausar agendamento');
  expect(html).toContain('Editar agendamento');
  expect(html).not.toContain('Pause schedule');
});
