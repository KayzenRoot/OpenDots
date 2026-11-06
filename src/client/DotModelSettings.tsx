import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useTranslation } from './i18n';

type Effective =
  | { configured: false }
  | { baseUrl: string; model: string; hasKey: boolean; inherited: boolean };

type Status = { tone: 'ok' | 'error' | 'busy'; text: string } | null;

/**
 * Model section in the Dot's edit dialog (WORK-030). Shows the effective model
 * and whether it is inherited from the global provider. The override fields
 * start blank: filling them in gives this Dot its own provider, and the key is
 * write-only, sent once, tested by the server and never shown again. Saving is
 * refused unless the provider accepts the key.
 */
export function DotModelSettings({ dotId }: { dotId: string }) {
  const { t } = useTranslation();
  const [effective, setEffective] = useState<Effective | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(() => {
    void api<Effective>(`/model/dot/${dotId}`)
      .then(setEffective)
      .catch(() => setEffective({ configured: false }));
  }, [dotId]);
  useEffect(load, [load]);

  const complete = () =>
    baseUrl.trim() !== '' && model.trim() !== '' && apiKey.trim() !== '';

  const test = async () => {
    setStatus({ tone: 'busy', text: t('dotModel.testing') });
    try {
      await api(`/model/dot/${dotId}/test`, 'POST', {
        baseUrl,
        model,
        apiKey,
      });
      setStatus({ tone: 'ok', text: t('dotModel.accepted') });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : t('dotModel.testFailed'),
      });
    }
  };

  const save = async () => {
    setStatus({ tone: 'busy', text: t('dotModel.testingSaving') });
    try {
      const next = await api<{ saved: true; model: string }>(
        `/model/dot/${dotId}`,
        'PUT',
        { baseUrl, model, apiKey },
      );
      setEffective({
        baseUrl,
        model: next.model,
        hasKey: true,
        inherited: false,
      });
      setApiKey('');
      setStatus({ tone: 'ok', text: t('dotModel.saved') });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : t('dotModel.saveFailed'),
      });
    }
  };

  const remove = async () => {
    setStatus({ tone: 'busy', text: t('dotModel.removing') });
    try {
      await api(`/model/dot/${dotId}`, 'DELETE');
      setApiKey('');
      load();
      setStatus({ tone: 'ok', text: t('dotModel.removed') });
    } catch (error) {
      setStatus({
        tone: 'error',
        text:
          error instanceof Error ? error.message : t('dotModel.removeFailed'),
      });
    }
  };

  const effectiveText = () => {
    if (!effective || !('model' in effective))
      return t('dotModel.notConfigured');
    return effective.inherited
      ? t('dotModel.inherited', { model: effective.model })
      : t('dotModel.set', { model: effective.model });
  };

  return (
    <fieldset className="model-settings">
      <legend>{t('dotModel.title')}</legend>
      <p className="muted">{effectiveText()}</p>
      <p className="muted">{t('dotModel.overrideHelp')}</p>
      <label className="field">
        <span>{t('model.baseUrl')}</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>{t('model.model')}</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>{t('model.apiKey')}</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            effective && 'model' in effective && !effective.inherited
              ? t('dotModel.replaceKey')
              : t('dotModel.pasteKey')
          }
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>
      <div className="model-actions">
        <button
          type="button"
          className="secondary"
          onClick={test}
          disabled={!complete() || status?.tone === 'busy'}
        >
          {t('dotModel.testConnection')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!complete() || status?.tone === 'busy'}
        >
          {t('common.save')}
        </button>
        {effective && 'model' in effective && !effective.inherited && (
          <button
            type="button"
            className="secondary"
            onClick={remove}
            disabled={status?.tone === 'busy'}
          >
            {t('dotModel.remove')}
          </button>
        )}
      </div>
      {status && (
        <p role="status" className={`model-status ${status.tone}`}>
          {status.text}
        </p>
      )}
    </fieldset>
  );
}
