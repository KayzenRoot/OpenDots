import { useEffect, useState } from 'react';
import { ArrowUpRight, FileText, Monitor, Terminal } from 'lucide-react';
import { z } from 'zod';
import { api } from './api';
import { useTranslation, type MessageKey } from './i18n';

const screenSchema = z.object({
  base64: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/)
    .max(4_000_000),
  url: z.string(),
});
export type ComputerToolRenderProps = {
  name: string;
  toolCallId: string;
  status: string;
  args?: unknown;
  result?: unknown;
};
const labelKeys: Record<string, MessageKey> = {
  navigate: 'computerTool.navigate',
  snapshot: 'computerTool.snapshot',
  read: 'computerTool.read',
  screenshot: 'computerTool.screenshot',
  click: 'computerTool.click',
  type: 'computerTool.type',
  key: 'computerTool.key',
  scroll: 'computerTool.scroll',
  files_write: 'computerTool.filesWrite',
  files_read: 'computerTool.filesRead',
  files_list: 'computerTool.filesList',
  exec: 'computerTool.exec',
};
export function computerToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: raw };
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw))
    : {};
}
export function ComputerToolCard({
  name,
  status,
  args,
  result,
  dotId,
  dotName,
  showScreen,
  running,
  onExpand,
}: ComputerToolRenderProps & {
  dotId: string;
  dotName: string;
  showScreen: boolean;
  running: boolean;
  onExpand?: () => void;
}) {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<z.infer<typeof screenSchema>>();
  const [screenError, setScreenError] = useState('');
  const action = name.replace(/^computer_/, '');
  const label = labelKeys[action] ? t(labelKeys[action]) : action;
  const headerLabel = labelKeys[action] ? label : t('computerTool.fallback');
  const data = computerToolResult(result);
  const parameters = computerToolResult(args);
  const interrupted =
    data.status === 'stopped' || data.reason === 'stop_requested';
  const error =
    typeof data.error === 'string'
      ? data.error
      : data.status === 'error' && typeof data.message === 'string'
        ? data.message
        : '';
  const interruption =
    interrupted && typeof data.message === 'string' ? data.message : '';
  const complete = status === 'complete';
  const failed =
    data.status === 'error' ||
    !!error ||
    (typeof data.exitCode === 'number' && data.exitCode !== 0);
  const state = interrupted
    ? t('computerTool.stateInterrupted')
    : failed
      ? t('computerTool.stateFailed')
      : complete
        ? t('computerTool.stateFinished')
        : running
          ? t('computerTool.stateWorking')
          : t('computerTool.stateInterrupted');
  const detail =
    typeof parameters.url === 'string'
      ? parameters.url
      : typeof parameters.path === 'string'
        ? parameters.path
        : '';
  useEffect(() => {
    if (!showScreen) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setScreen(undefined);
    setScreenError('');
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const value = await api<unknown>(
            `/dots/${encodeURIComponent(dotId)}/computer/actions`,
            'POST',
            { action: 'screenshot', input: {} },
            controller.signal,
          );
          const next = screenSchema.parse(value);
          if (!controller.signal.aborted) {
            setScreen(next);
            setScreenError('');
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            setScreen(undefined);
            setScreenError(
              cause instanceof Error
                ? cause.message
                : t('computerTool.previewUnavailable'),
            );
          }
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [dotId, showScreen]);
  const Icon =
    action === 'exec'
      ? Terminal
      : action.startsWith('files_')
        ? FileText
        : Monitor;
  return (
    <section
      className={`inline-computer ${showScreen ? 'with-screen' : ''}`}
      aria-label={t('computerTool.aria', { name: dotName, action: label })}
    >
      <header>
        <Icon size={16} aria-hidden="true" />
        <strong>{headerLabel}</strong>
        <span className={failed ? 'tool-state failed' : 'tool-state'}>
          {state}
        </span>
        {onExpand && (
          <button
            type="button"
            aria-label={t('computerTool.expand', { name: dotName })}
            onClick={onExpand}
          >
            <ArrowUpRight size={16} />
          </button>
        )}
      </header>
      {detail && (
        <div className="inline-computer-detail" title={detail}>
          {detail}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {interruption && <p role="status">{interruption}</p>}
      {action === 'exec' && complete && typeof data.stdout === 'string' && (
        <pre aria-label={t('computerTool.terminalOutput')}>
          {data.stdout.slice(0, 4000)}
        </pre>
      )}
      {action === 'exec' &&
        complete &&
        typeof data.stderr === 'string' &&
        data.stderr && <pre>{data.stderr.slice(0, 2000)}</pre>}
      {showScreen && (
        <div className="inline-computer-preview">
          <div className="inline-computer-caption">
            <span className="live-indicator" />
            {t('computerTool.currentView', { name: dotName })}
          </div>
          {screen && (
            <img
              src={`data:image/png;base64,${screen.base64}`}
              alt={t('computerTool.screenAlt', { name: dotName })}
            />
          )}
          {screenError ? (
            <p role="status">{screenError}</p>
          ) : (
            !screen && <p role="status">{t('computerTool.connecting')}</p>
          )}
          {screen && <div className="inline-computer-url">{screen.url}</div>}
        </div>
      )}
    </section>
  );
}
