import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dot } from '../shared/types';
import type { ComputerAction, ComputerStatus } from '../shared/computer-types';
import { api } from './api';
import { useTranslation } from './i18n';

type Screen = {
  base64: string;
  width: number;
  height: number;
  url: string;
  capturedAt: number;
};

const tabKeys = {
  Browser: 'computer.tabBrowser',
  Files: 'computer.tabFiles',
  Terminal: 'computer.tabTerminal',
  Activity: 'computer.tabActivity',
} as const;

const permissionKeys = {
  enabled: 'computer.permEnabled',
  browser: 'computer.permBrowser',
  files: 'computer.permFiles',
  shell: 'computer.permShell',
} as const;

export function ComputerPanel({ dot }: { dot: Dot }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'Browser' | 'Files' | 'Terminal' | 'Activity'>(
    'Browser',
  );
  const [status, setStatus] = useState<ComputerStatus>();
  const [screen, setScreen] = useState<Screen>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [key, setKey] = useState('Enter');
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [path, setPath] = useState('');
  const [contents, setContents] = useState('');
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [outputError, setOutputError] = useState('');
  const [screenError, setScreenError] = useState('');
  const lifecycle = useRef({
    active: false,
    revision: 0,
    busy: false,
    loaded: false,
    running: false,
  });
  const controller = useRef<AbortController | null>(null);
  const base = `/dots/${encodeURIComponent(dot.id)}/computer`;
  const refresh = useCallback(async () => {
    const revision = lifecycle.current.revision;
    const current = () =>
      lifecycle.current.active && revision === lifecycle.current.revision;
    try {
      const next = await api<ComputerStatus>(
        base,
        'GET',
        undefined,
        controller.current?.signal,
      );
      if (!current()) return;
      setStatus(next);
      lifecycle.current.loaded = true;
      lifecycle.current.running = next.state === 'running';
      setError('');
      if (
        next.state === 'running' &&
        next.permissions.browser &&
        next.permissions.enabled
      ) {
        try {
          const capture = await api<Screen>(
            `${base}/actions`,
            'POST',
            { action: 'screenshot', input: {} },
            controller.current?.signal,
          );
          if (current()) {
            setScreen(capture);
            setScreenError('');
          }
        } catch (cause) {
          if (current()) {
            setScreen(undefined);
            setScreenError(
              cause instanceof Error
                ? cause.message
                : t('computer.screenRefreshFailed'),
            );
          }
        }
      } else {
        setScreen(undefined);
        setScreenError('');
      }
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error ? cause.message : t('computer.loadFailed'),
        );
        setScreen(undefined);
      }
    }
  }, [base]);
  useEffect(() => {
    lifecycle.current.active = true;
    controller.current = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (
        !document.hidden &&
        !lifecycle.current.busy &&
        (!lifecycle.current.loaded || lifecycle.current.running)
      )
        await refresh();
      if (!cancelled && lifecycle.current.active)
        timer = setTimeout(() => void poll(), 4000);
    };
    void poll();
    return () => {
      cancelled = true;
      lifecycle.current.active = false;
      lifecycle.current.revision++;
      controller.current?.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  const run = async (
    endpoint: string,
    body: unknown = {},
    method = 'POST',
    showOutput = false,
  ) => {
    if (lifecycle.current.busy) return;
    lifecycle.current.busy = true;
    lifecycle.current.revision++;
    setBusy(true);
    setError('');
    if (showOutput) setOutputError('');
    try {
      const result = await api<unknown>(
        `${base}${endpoint}`,
        method,
        body,
        controller.current?.signal,
      );
      if (!lifecycle.current.active) return;
      if (showOutput)
        setOutput(
          typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        );
      await refresh();
      return result;
    } catch (cause) {
      if (!lifecycle.current.active) return;
      const message =
        cause instanceof Error ? cause.message : t('computer.actionFailed');
      // Status polling clears the panel error, so keep output action failures
      // next to the output they replace.
      if (showOutput) {
        setOutput('');
        setOutputError(message);
      } else setError(message);
    } finally {
      lifecycle.current.busy = false;
      if (lifecycle.current.active) setBusy(false);
    }
  };
  const action = (action: ComputerAction, input: unknown, showOutput = false) =>
    run('/actions', { action, input }, 'POST', showOutput);
  const running = status?.state === 'running' && status.permissions.enabled;
  const human =
    status?.control?.holder === 'human' && !status.control.transitioning;
  const browser = !!running && !!status?.permissions.browser;
  return (
    <section
      className="computer-panel"
      aria-label={t('computer.aria', { name: dot.name })}
      aria-busy={busy}
    >
      {error && (
        <p className="computer-error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p role="status">
          {error ? t('computer.statusUnavailable') : t('computer.loading')}
        </p>
      ) : (
        <>
          <div className="computer-status">
            <strong>{status.state.replaceAll('_', ' ')}</strong>
            {status.state !== 'running' && (
              <button disabled={busy} onClick={() => void refresh()}>
                {t('common.refresh')}
              </button>
            )}
            <span>
              {busy
                ? t('computer.working')
                : human
                  ? t('computer.humanControl')
                  : t('computer.dotControl')}
            </span>
          </div>
          {!status.configured && (
            <div className="computer-setup">
              <h3>{t('computer.setupTitle')}</h3>
              <p>{t('computer.setupBody')}</p>
              <a
                href="https://github.com/CopilotKit/OpenDots/blob/main/docs/COMPUTERS.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('computer.setupGuide')}
              </a>
            </div>
          )}
          {status.error && (
            <p className="computer-error" role="alert">
              {status.error}
            </p>
          )}
          <div
            className="computer-tool-tabs"
            role="tablist"
            aria-label={t('computer.toolsLabel')}
          >
            {(['Browser', 'Files', 'Terminal', 'Activity'] as const).map(
              (name) => (
                <button
                  role="tab"
                  aria-selected={tab === name}
                  key={name}
                  onClick={() => setTab(name)}
                >
                  {t(tabKeys[name])}
                </button>
              ),
            )}
          </div>
          {status.configured && (
            <>
              <section
                className="computer-section computer-browser"
                hidden={tab !== 'Browser'}
              >
                {!status.permissions.browser && (
                  <p>{t('computer.enableBrowser')}</p>
                )}
                <form
                  className="computer-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action('navigate', { url });
                  }}
                >
                  <input
                    type="url"
                    aria-label={t('computer.browserUrl')}
                    placeholder="https://example.com"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    required
                    disabled={!browser || busy || human}
                  />
                  <button disabled={!browser || busy || human || !url.trim()}>
                    {t('computer.go')}
                  </button>
                </form>
                {screenError && (
                  <p className="computer-error" role="status">
                    {screenError}
                  </p>
                )}
                {screen ? (
                  <>
                    <div className="computer-current-url" title={screen.url}>
                      {screen.url || t('computer.browserScreen')}
                    </div>
                    <button
                      className="computer-screen"
                      aria-label={
                        human
                          ? t('computer.screenAriaHuman')
                          : t('computer.screenAria')
                      }
                      disabled={!browser || !human || busy}
                      onClick={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        void action('human_click', {
                          x: Math.min(
                            screen.width - 1,
                            Math.max(
                              0,
                              Math.floor(
                                ((event.clientX - rect.left) / rect.width) *
                                  screen.width,
                              ),
                            ),
                          ),
                          y: Math.min(
                            screen.height - 1,
                            Math.max(
                              0,
                              Math.floor(
                                ((event.clientY - rect.top) / rect.height) *
                                  screen.height,
                              ),
                            ),
                          ),
                        });
                      }}
                    >
                      <img
                        src={`data:image/png;base64,${screen.base64}`}
                        alt={t('computer.screenAlt', { name: dot.name })}
                      />
                    </button>
                    <small>
                      {t('computer.refreshedAt', {
                        time: new Date(screen.capturedAt).toLocaleTimeString(),
                      })}
                    </small>
                  </>
                ) : (
                  <p className="computer-screen-empty">
                    {running && status.permissions.browser
                      ? t('computer.waitingScreen')
                      : t('computer.startForScreen')}
                  </p>
                )}
                <div className="computer-control-pill">
                  <span>
                    {human
                      ? t('computer.humanControl')
                      : t('computer.dotHasControl', { name: dot.name })}
                  </span>
                  <button
                    disabled={
                      (!human && !browser) ||
                      busy ||
                      status.control?.transitioning
                    }
                    onClick={() => void run(human ? '/release' : '/take')}
                  >
                    {human
                      ? t('computer.returnControl')
                      : t('computer.takeOver')}
                  </button>
                </div>
                {status.control?.transitioning && (
                  <p role="status">{t('computer.transferring')}</p>
                )}
                {human && (
                  <details className="computer-human">
                    <summary>{t('computer.keyboardControls')}</summary>
                    <p>{t('computer.keyboardHelp')}</p>
                    <form
                      className="computer-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void action('human_click', point);
                      }}
                    >
                      <label>
                        X
                        <input
                          type="number"
                          min="0"
                          max={screen ? screen.width - 1 : undefined}
                          value={point.x}
                          onChange={(event) =>
                            setPoint({
                              ...point,
                              x: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Y
                        <input
                          type="number"
                          min="0"
                          max={screen ? screen.height - 1 : undefined}
                          value={point.y}
                          onChange={(event) =>
                            setPoint({
                              ...point,
                              y: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <button disabled={busy || !browser || !screen}>
                        {t('computer.click')}
                      </button>
                    </form>
                    <form
                      className="computer-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = text;
                        setText('');
                        void action('human_type', { text: value });
                      }}
                    >
                      <input
                        type="password"
                        aria-label={t('computer.typeAria')}
                        placeholder={t('computer.typePlaceholder')}
                        autoComplete="off"
                        value={text}
                        maxLength={20000}
                        onChange={(event) => setText(event.target.value)}
                      />
                      <button disabled={busy || !browser || !text}>
                        {t('computer.type')}
                      </button>
                    </form>
                    <form
                      className="computer-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void action('human_key', { key });
                      }}
                    >
                      <select
                        aria-label={t('computer.keyAria')}
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                      >
                        {[
                          'Enter',
                          'Tab',
                          'Escape',
                          'Backspace',
                          'ArrowUp',
                          'ArrowDown',
                          'ArrowLeft',
                          'ArrowRight',
                        ].map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                      <button disabled={busy || !browser}>
                        {t('computer.pressKey')}
                      </button>
                    </form>
                    <div className="computer-actions">
                      <button
                        disabled={busy || !browser}
                        onClick={() =>
                          void action('human_scroll', { deltaY: -500 })
                        }
                      >
                        {t('computer.scrollUp')}
                      </button>
                      <button
                        disabled={busy || !browser}
                        onClick={() =>
                          void action('human_scroll', { deltaY: 500 })
                        }
                      >
                        {t('computer.scrollDown')}
                      </button>
                    </div>
                  </details>
                )}
              </section>
              <details
                className="computer-section"
                open
                hidden={tab !== 'Files'}
              >
                <summary>{t('computer.workspaceFiles')}</summary>
                <p>{t('computer.pathsHelp')}</p>
                <label>
                  {t('computer.path')}
                  <input
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder="notes.txt"
                    disabled={!running || !status.permissions.files || busy}
                  />
                </label>
                <div className="computer-actions">
                  <button
                    disabled={!running || !status.permissions.files || busy}
                    onClick={() => void action('files_list', { path }, true)}
                  >
                    {t('computer.listFiles')}
                  </button>
                  <button
                    disabled={
                      !running ||
                      !status.permissions.files ||
                      busy ||
                      !path.trim()
                    }
                    onClick={() =>
                      void action('files_read', { path }, true).then(
                        (result) => {
                          if (
                            lifecycle.current.active &&
                            result &&
                            typeof result === 'object' &&
                            'text' in result &&
                            typeof result.text === 'string'
                          )
                            setContents(result.text);
                        },
                      )
                    }
                  >
                    {t('computer.readFile')}
                  </button>
                </div>
                <label>
                  {t('computer.fileContents')}
                  <textarea
                    aria-label={t('computer.fileContentsAria')}
                    value={contents}
                    onChange={(event) => setContents(event.target.value)}
                    disabled={!running || !status.permissions.files || busy}
                    maxLength={100000}
                    rows={5}
                  />
                </label>
                <button
                  disabled={
                    !running ||
                    !status.permissions.files ||
                    busy ||
                    !path.trim()
                  }
                  onClick={() =>
                    void action('files_write', { path, contents }, true)
                  }
                >
                  {t('computer.saveFile')}
                </button>
                {!status.permissions.files && (
                  <p>{t('computer.enableFiles')}</p>
                )}
              </details>
              <details
                className="computer-section"
                open
                hidden={tab !== 'Terminal'}
              >
                <summary>{t('computer.terminal')}</summary>
                <p>{t('computer.terminalHelp')}</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action('exec', { command, timeoutMs: 30000 }, true);
                  }}
                >
                  <textarea
                    aria-label={t('computer.terminalCommand')}
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    maxLength={8000}
                    rows={3}
                    disabled={!running || !status.permissions.shell || busy}
                    placeholder="pwd"
                  />
                  <button
                    disabled={
                      !running ||
                      !status.permissions.shell ||
                      busy ||
                      !command.trim()
                    }
                  >
                    {t('computer.runCommand')}
                  </button>
                </form>
                {!status.permissions.shell && (
                  <p>{t('computer.enableShell')}</p>
                )}
              </details>
              {(output || outputError) &&
                (tab === 'Files' || tab === 'Terminal') && (
                  <section className="computer-section">
                    <h3>{t('computer.output')}</h3>
                    {outputError && (
                      <p className="computer-error" role="alert">
                        {outputError}
                      </p>
                    )}
                    {output && <pre tabIndex={0}>{output}</pre>}
                    <button
                      onClick={() => {
                        setOutput('');
                        setOutputError('');
                      }}
                    >
                      {t('computer.clearOutput')}
                    </button>
                  </section>
                )}
            </>
          )}
          <details
            className="computer-section"
            open
            hidden={tab !== 'Activity'}
          >
            <summary>{t('computer.recentActivity')}</summary>
            {status.audit.length ? (
              <ol className="computer-audit">
                {status.audit
                  .slice(-30)
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.action.replaceAll('_', ' ')}</strong>
                      <span>
                        {entry.actor} · {entry.outcome} ·{' '}
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
              </ol>
            ) : (
              <p>{t('computer.noActivity')}</p>
            )}
          </details>
          <details className="computer-settings">
            <summary>{t('computer.settings')}</summary>{' '}
            <details
              className="computer-permissions"
              open={!status.permissions.enabled}
            >
              <summary>{t('computer.permissions')}</summary>
              <p>{t('computer.permissionsHelp', { name: dot.name })}</p>
              {(['enabled', 'browser', 'files', 'shell'] as const).map(
                (permission) => (
                  <label key={permission}>
                    <input
                      type="checkbox"
                      checked={status.permissions[permission]}
                      disabled={busy || !status.configured}
                      onChange={(event) =>
                        void run(
                          '/permissions',
                          { [permission]: event.target.checked },
                          'PATCH',
                        )
                      }
                    />
                    {t(permissionKeys[permission])}
                  </label>
                ),
              )}
            </details>
            <div className="computer-actions">
              <button
                disabled={
                  busy ||
                  !status.configured ||
                  !status.permissions.enabled ||
                  status.state === 'running'
                }
                onClick={() => void run('/start')}
              >
                {t('computer.start')}
              </button>
              <button
                disabled={busy || status.state !== 'running'}
                onClick={() => void run('/stop')}
              >
                {t('computer.stop')}
              </button>
            </div>
            <p className="computer-hint">{t('computer.stopHelp')}</p>
          </details>
        </>
      )}
    </section>
  );
}
