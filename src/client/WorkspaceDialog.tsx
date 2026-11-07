import { ModelSettings } from './ModelSettings';
import { DotModelSettings } from './DotModelSettings';
import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Dot, Memory, State, WorkspaceState } from '../shared/types';
import { api } from './api';
import { ConnectionsSection } from './ConnectionsSection';
import { SkillsSection } from './SkillsSection';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
import {
  localePreference,
  setLocalePreference,
  useTranslation,
  type LocalePreference,
} from './i18n';
export type Dialog =
  | { type: 'space' }
  | { type: 'dot'; dot?: Dot; spaceId: string }
  | { type: 'settings' }
  | { type: 'memory'; memory?: Memory }
  | { type: 'schedule'; threadId: string };
const themeKeys = {
  system: 'dialog.themeSystem',
  light: 'dialog.themeLight',
  dark: 'dialog.themeDark',
} as const;
const languageKeys = {
  system: 'dialog.languageSystem',
  en: 'dialog.languageEnglish',
  'pt-BR': 'dialog.languagePortuguese',
} as const;
const LocalePreferences: LocalePreference[] = ['system', 'en', 'pt-BR'];
export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  mutate,
  onDotDeleted,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
  /** Called after an existing Dot was deleted, so the app can navigate away. */
  onDotDeleted?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(
    dialog.type === 'dot' ? (dialog.dot?.name ?? '') : '',
  );
  const [text, setText] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.instructions ?? '')
      : dialog.type === 'memory'
        ? (dialog.memory?.text ?? '')
        : '',
  );
  const [research, setResearch] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.researchAllowed ?? true)
      : state.settings.researchAllowed,
  );
  const [memory, setMemory] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.memoryAllowed ?? true)
      : state.settings.memoryAllowed,
  );
  const [apps, setApps] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.appsAllowed ?? false)
      : state.settings.appsAllowed,
  );
  const [composioToolkits, setComposioToolkits] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.composioToolkits ?? []).join(', ')
      : '',
  );
  const [spaceIds, setSpaceIds] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceIds ?? [dialog.spaceId]) : [],
  );
  const [defaultSpace, setDefaultSpace] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceId ?? dialog.spaceId) : '',
  );
  const [interval, setInterval] = useState('86400');
  const [learningContainer, setLearningContainer] = useState(
    dialog.type === 'dot' ? (dialog.dot?.learningContainerId ?? '') : '',
  );
  const [skillDelivery, setSkillDelivery] = useState(
    dialog.type === 'dot' ? (dialog.dot?.skillDeliveryEnabled ?? false) : false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Deleting a Dot is armed separately from saving: the owner must type the
  // Dot's exact name, so a stray click never deletes a specialist.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [theme, setTheme] = useState(themePreference);
  const [language, setLanguage] = useState(localePreference);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    container.current
      ?.querySelector<HTMLElement>('input,textarea,select')
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [
          ...(container.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,textarea,select,a[href]',
          ) ?? []),
        ];
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  const title =
    dialog.type === 'space'
      ? t('dialog.titleSpace')
      : dialog.type === 'dot'
        ? dialog.dot
          ? t('dialog.titleDotEdit')
          : t('dialog.titleDotNew')
        : dialog.type === 'settings'
          ? t('dialog.titleSettings')
          : dialog.type === 'memory'
            ? t('dialog.titleMemory')
            : t('dialog.titleSchedule');
  const confirmDotDelete = async () => {
    const dot = dialog.type === 'dot' ? dialog.dot : undefined;
    if (!dot || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/dots/${dot.id}`, 'DELETE', {});
      onDotDeleted?.(dot.id);
      onClose();
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : t('dialog.deleteDotFailed'),
      );
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={container}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label={t('dialog.close')}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">{t('dialog.eyebrow')}</span>
        <h2 id="dialog-title">{title}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            let path = '',
              method = 'POST',
              body: unknown;
            if (dialog.type === 'space') {
              path = '/spaces';
              body = { name, description: text };
            }
            if (dialog.type === 'dot') {
              path = dialog.dot ? `/dots/${dialog.dot.id}` : '/dots';
              method = dialog.dot ? 'PUT' : 'POST';
              body = {
                spaceId: defaultSpace,
                spaceIds,
                name,
                instructions: text,
                researchAllowed: research,
                memoryAllowed: memory,
                appsAllowed: apps,
                composioToolkits: composioToolkits
                  .split(',')
                  .map((slug) => slug.trim())
                  .filter(Boolean),
                learningContainerId: learningContainer.trim() || null,
                skillDeliveryEnabled: skillDelivery,
              };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = {
                researchAllowed: research,
                memoryAllowed: memory,
                appsAllowed: apps,
              };
            }
            if (dialog.type === 'memory') {
              path = dialog.memory
                ? `/memories/${dialog.memory.id}`
                : '/memories';
              method = dialog.memory ? 'PUT' : 'POST';
              body = { text };
            }
            if (dialog.type === 'schedule') {
              path = '/tasks';
              body = {
                prompt: text,
                threadId: dialog.threadId,
                intervalSeconds: Number(interval),
              };
            }
            if (await mutate(path, method, body)) onClose();
            else setError(t('dialog.saveFailed'));
            setBusy(false);
          }}
        >
          {(dialog.type === 'space' || dialog.type === 'dot') && (
            <>
              <label className="field-label" htmlFor="entity-name">
                {t('dialog.name')}
              </label>
              <input
                id="entity-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </>
          )}
          {dialog.type !== 'settings' && (
            <>
              <label className="field-label" htmlFor="entity-text">
                {dialog.type === 'dot'
                  ? t('dialog.roleInstructions')
                  : dialog.type === 'space'
                    ? t('dialog.whatBelongs')
                    : dialog.type === 'memory'
                      ? t('dialog.preferenceOrContext')
                      : t('dialog.taskToRevisit')}
              </label>
              <textarea
                id="entity-text"
                rows={4}
                maxLength={dialog.type === 'schedule' ? 4000 : 2000}
                required={dialog.type !== 'space'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  dialog.type === 'dot'
                    ? t('dialog.instructionsPlaceholder')
                    : ''
                }
              />
            </>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="space-access-fields">
              <legend>{t('dialog.spaceAccess')}</legend>
              <p className="muted">{t('dialog.spaceAccessHelp')}</p>
              {workspace.spaces.map((space) => (
                <label className="permission-row" key={space.id}>
                  <input
                    type="checkbox"
                    checked={spaceIds.includes(space.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...spaceIds, space.id]
                        : spaceIds.filter((id) => id !== space.id);
                      setSpaceIds(next);
                      if (!next.includes(defaultSpace))
                        setDefaultSpace(next[0] ?? '');
                    }}
                  />
                  <span>{space.name}</span>
                </label>
              ))}
              <label className="field-label" htmlFor="default-space">
                {t('dialog.defaultSpaceLabel')}
              </label>
              <select
                id="default-space"
                value={defaultSpace}
                required
                onChange={(event) => setDefaultSpace(event.target.value)}
              >
                <option value="" disabled>
                  {t('dialog.chooseSpace')}
                </option>
                {workspace.spaces
                  .filter((space) => spaceIds.includes(space.id))
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
              </select>
            </fieldset>
          )}
          {(dialog.type === 'dot' || dialog.type === 'settings') && (
            <>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                <span>
                  <strong>{t('dialog.publicResearch')}</strong>
                  <small>{t('dialog.publicResearchHelp')}</small>
                </span>
              </label>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(e) => setMemory(e.target.checked)}
                />
                <span>
                  <strong>{t('dialog.useMemories')}</strong>
                  <small>{t('dialog.useMemoriesHelp')}</small>
                </span>
              </label>
              {workspace.setup.composio && (
                <label className="permission-row">
                  <input
                    type="checkbox"
                    checked={apps}
                    onChange={(event) => setApps(event.target.checked)}
                  />
                  <span>
                    <strong>{t('dialog.connectedApps')}</strong>
                    <small>{t('dialog.connectedAppsHelp')}</small>
                  </span>
                </label>
              )}
            </>
          )}
          {dialog.type === 'dot' && workspace.setup.composio && (
            <fieldset className="space-access-fields">
              <legend>{t('dialog.connectedApps')}</legend>
              <label className="field-label" htmlFor="composio-toolkits">
                {t('dialog.toolkitSlugs')}
              </label>
              <input
                id="composio-toolkits"
                value={composioToolkits}
                pattern="[a-z0-9_]+(, *[a-z0-9_]+)*"
                placeholder="gmail, google_calendar"
                aria-describedby="composio-toolkits-help"
                onChange={(event) => setComposioToolkits(event.target.value)}
              />
              <p className="muted" id="composio-toolkits-help">
                {t('dialog.toolkitSlugsHelp')}
              </p>
            </fieldset>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="space-access-fields">
              <legend>{t('dialog.localSkills')}</legend>
              <label className="field-label" htmlFor="learning-container">
                {t('dialog.skillSetId')}
              </label>
              <input
                id="learning-container"
                value={learningContainer}
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="research-workflow"
                aria-describedby="learning-help"
                onChange={(event) => {
                  setLearningContainer(event.target.value);
                  if (!event.target.value.trim()) setSkillDelivery(false);
                }}
              />
              <p className="muted" id="learning-help">
                {t('dialog.skillsHelp')}
              </p>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={skillDelivery}
                  disabled={!learningContainer.trim()}
                  onChange={(event) => setSkillDelivery(event.target.checked)}
                />
                <span>
                  <strong>{t('dialog.deliverSkills')}</strong>
                  <small>{t('dialog.deliverSkillsHelp')}</small>
                </span>
              </label>
            </fieldset>
          )}
          {dialog.type === 'dot' && dialog.dot && (
            <SkillsSection dotId={dialog.dot.id} />
          )}
          {dialog.type === 'dot' && dialog.dot && (
            <DotModelSettings dotId={dialog.dot.id} />
          )}
          {dialog.type === 'dot' && dialog.dot && (
            <ConnectionsSection dotId={dialog.dot.id} />
          )}
          {dialog.type === 'dot' && dialog.dot && (
            <fieldset className="space-access-fields danger-zone">
              <legend>{t('dialog.deleteDotLegend')}</legend>
              <p className="muted">{t('dialog.deleteDotHelp')}</p>
              {deleteArmed ? (
                <>
                  <label className="field-label" htmlFor="delete-dot-name">
                    {t('dialog.deleteDotType', { name: dialog.dot.name })}
                  </label>
                  <input
                    id="delete-dot-name"
                    value={deleteName}
                    autoComplete="off"
                    maxLength={40}
                    placeholder={dialog.dot.name}
                    onChange={(event) => setDeleteName(event.target.value)}
                  />
                  <div className="delete-dot-actions">
                    <button
                      type="button"
                      className="danger-button"
                      disabled={deleting || deleteName !== dialog.dot.name}
                      onClick={() => void confirmDotDelete()}
                    >
                      <Trash2 size={14} />
                      {t('dialog.deleteDotConfirm')}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => {
                        setDeleteArmed(false);
                        setDeleteName('');
                        setDeleteError('');
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setDeleteArmed(true)}
                >
                  <Trash2 size={14} />
                  {t('dialog.deleteDot')}
                </button>
              )}
              {deleteError && (
                <p className="chat-error" role="alert">
                  {deleteError}
                </p>
              )}
            </fieldset>
          )}
          {dialog.type === 'schedule' && (
            <>
              <label className="field-label" htmlFor="schedule-interval">
                {t('dialog.repeatAfter')}
              </label>
              <select
                id="schedule-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
              >
                <option value="60">{t('dialog.everyMinute')}</option>
                <option value="3600">{t('dialog.everyHour')}</option>
                <option value="86400">{t('dialog.everyDay')}</option>
                <option value="604800">{t('dialog.everyWeek')}</option>
              </select>
              <p className="muted">{t('dialog.scheduleHelp')}</p>
            </>
          )}
          {dialog.type === 'settings' && (
            <>
              <fieldset className="appearance-fields">
                <legend>{t('dialog.appearance')}</legend>
                <div className="segmented" role="radiogroup">
                  {(['system', 'light', 'dark'] as ThemePreference[]).map(
                    (option) => (
                      <label key={option}>
                        <input
                          type="radio"
                          name="theme"
                          value={option}
                          checked={theme === option}
                          onChange={() => {
                            setTheme(option);
                            setThemePreference(option);
                          }}
                        />
                        <span>{t(themeKeys[option])}</span>
                      </label>
                    ),
                  )}
                </div>
                <p className="muted">{t('dialog.appearanceHelp')}</p>
              </fieldset>
              <fieldset className="appearance-fields">
                <legend>{t('dialog.language')}</legend>
                <div className="segmented" role="radiogroup">
                  {LocalePreferences.map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name="locale"
                        value={option}
                        checked={language === option}
                        onChange={() => {
                          setLanguage(option);
                          setLocalePreference(option);
                        }}
                      />
                      <span>{t(languageKeys[option])}</span>
                    </label>
                  ))}
                </div>
                <p className="muted">{t('dialog.languageHelp')}</p>
              </fieldset>
            </>
          )}
          {dialog.type === 'settings' && (
            <div className="config-note">
              <strong>{t('dialog.serviceSetup')}</strong>
              <ModelSettings />
              <p>
                {workspace.setup.missing.length
                  ? t('dialog.setupMissing')
                  : t('dialog.setupPresent')}
              </p>
              <p>
                {t('dialog.slackVoice', {
                  slack: workspace.setup.slack.replaceAll('_', ' '),
                  voice: workspace.setup.voice
                    ? t('dialog.voicePresent')
                    : t('dialog.voiceMissing'),
                })}
              </p>
              <p>
                {t('app.telemetryLead')}{' '}
                <a
                  href="https://github.com/CopilotKit/OpenDots/blob/main/docs/SETUP-TELEMETRY.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('app.telemetryLink')}
                </a>
              </p>
              <a
                href="https://github.com/CopilotKit/OpenDots/blob/main/docs/SETUP.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('dialog.setupGuide')}
              </a>
            </div>
          )}
          {dialog.type === 'memory' && (
            <p className="muted">{t('dialog.memoryHelp')}</p>
          )}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </section>
    </div>
  );
}
