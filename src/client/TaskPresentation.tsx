import {
  CheckCheck,
  ChevronRight,
  LoaderCircle,
  MessageCircle,
} from 'lucide-react';
import type { Task } from '../shared/types';
import { Mascot } from './Mascot';
import { t as translateMessage, useTranslation, type MessageKey } from './i18n';
export const relative = (value: number) => {
  const minutes = Math.floor((Date.now() - value) / 60000);
  return minutes < 1
    ? translateMessage('task.justNow')
    : minutes < 60
      ? translateMessage('task.minutesAgo', { count: minutes })
      : minutes < 1440
        ? translateMessage('task.hoursAgo', {
            count: Math.floor(minutes / 60),
          })
        : new Date(value).toLocaleDateString();
};
const statusKeys: Record<string, MessageKey> = {
  completed: 'task.statusCompleted',
  running: 'task.statusRunning',
  queued: 'task.statusQueued',
  paused: 'task.statusPaused',
  failed: 'task.statusFailed',
  interrupted: 'task.statusInterrupted',
  cancelled: 'task.statusCancelled',
};
export const statusLabel = (task: Task) =>
  task.status === 'completed' && task.nextRunAt
    ? translateMessage('task.statusScheduled')
    : statusKeys[task.status]
      ? translateMessage(statusKeys[task.status])
      : task.status.charAt(0).toUpperCase() + task.status.slice(1);
export function Status({ task }: { task: Task }) {
  useTranslation();
  return (
    <span className={`status ${task.status}`}>
      <span />
      {statusLabel(task)}
    </span>
  );
}

export function TaskRow({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button className="task-row" onClick={onClick}>
      <span className="task-row-icon">
        {task.status === 'completed' ? (
          <CheckCheck size={19} />
        ) : task.status === 'running' ? (
          <LoaderCircle className="spin" size={19} />
        ) : (
          <MessageCircle size={19} />
        )}
      </span>
      <div>
        <strong>{task.prompt}</strong>
        <span>
          {task.intervalSeconds
            ? task.intervalSeconds < 3600
              ? t('task.repeatsMinutes', {
                  count: task.intervalSeconds / 60,
                })
              : t('task.repeatsHours', {
                  count: task.intervalSeconds / 3600,
                })
            : ''}
          {relative(task.updatedAt)}
        </span>
      </div>
      <Status task={task} />
      <ChevronRight size={16} />
    </button>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="large-empty">
      <Mascot />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
