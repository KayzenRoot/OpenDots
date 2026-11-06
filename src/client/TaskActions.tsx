import { Clock3, Pause, Play, Square } from 'lucide-react';
import type { Action, Settings, Task } from '../shared/types';
import { useTranslation } from './i18n';
export function TaskActions({
  task,
  busy,
  settings,
  onAction,
  onSchedule,
}: {
  task: Task;
  busy: boolean;
  settings: Settings;
  onAction: (action: Action) => void;
  onSchedule: () => void;
}) {
  const { t } = useTranslation();
  const active = task.status === 'running' || task.status === 'queued';
  return (
    <div className="task-controls">
      {active ? (
        <button disabled={busy} onClick={() => onAction('pause')}>
          <Pause size={14} />
          {t('task.pause')}
        </button>
      ) : (
        <button
          disabled={busy || settings.paused || !settings.researchAllowed}
          onClick={() => onAction('run')}
        >
          <Play size={14} />
          {task.status === 'interrupted'
            ? t('task.retryAfterReview')
            : task.status === 'failed'
              ? t('task.retry')
              : task.status === 'paused'
                ? t('task.resume')
                : t('task.runAgain')}
        </button>
      )}
      {task.status === 'completed' && !!task.intervalSeconds && (
        <button disabled={busy} onClick={() => onAction('pause')}>
          <Pause size={14} />
          {t('task.pauseSchedule')}
        </button>
      )}
      <button onClick={onSchedule}>
        <Clock3 size={14} />
        {task.intervalSeconds ? t('task.editSchedule') : t('task.setSchedule')}
      </button>
      {task.status !== 'cancelled' && (
        <button
          disabled={busy}
          className="quiet-button"
          onClick={() => onAction('cancel')}
        >
          <Square size={12} />
          {t('common.cancel')}
        </button>
      )}
    </div>
  );
}
