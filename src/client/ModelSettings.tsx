import { useEffect, useState } from 'react';
import { api } from './api';
import { useTranslation } from './i18n';

type Saved =
  { configured: false } | { baseUrl: string; model: string; hasKey: true };

/**
 * Model provider form inside Settings. The key is write-only: it is sent once,
 * tested by the server, and never shown again. Saving is refused unless the
 * provider accepts the key, so a typo cannot silently break every conversation.
 */
export function ModelSettings() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [baseUrl, setBaseUrl] = useState('https://opencode.ai/zen/go/v1');
  const [model, setModel] = useState('deepseek-v4.1-flash');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<{
    tone: 'ok' | 'error' | 'busy';
    text: string;
  } | null>(null);

  useEffect(() => {
    void api<Saved>('/model')
      .then((current) => {
        setSaved(current);
        if ('baseUrl' in current) {
          setBaseUrl(current.baseUrl);
          setModel(current.model);
        }
      })
      .catch(() => setSaved({ configured: false }));
  }, []);

  const body = () => JSON.stringify({ baseUrl, model, apiKey });

  const test = async () => {
    setStatus({ tone: 'busy', text: t('model.testing') });
    try {
      await api('/model/test', 'POST', JSON.parse(body()));
      setStatus({
        tone: 'ok',
        text: t('model.accepted'),
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : t('model.testFailed'),
      });
    }
  };

  const save = async () => {
    setStatus({ tone: 'busy', text: t('model.testingSaving') });
    try {
      const next = await api<{
        saved: true;
        baseUrl: string;
        model: string;
        hasKey: true;
      }>('/model', 'PUT', JSON.parse(body()));
      setSaved({ baseUrl: next.baseUrl, model: next.model, hasKey: true });
      setApiKey('');
      setStatus({
        tone: 'ok',
        text: t('model.saved'),
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : t('model.saveFailed'),
      });
    }
  };

  return (
    <fieldset className="model-settings">
      <legend>{t('model.title')}</legend>
      <p className="muted">
        {saved && 'hasKey' in saved
          ? t('model.connected', { model: saved.model })
          : t('model.choose')}
      </p>
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
            saved && 'hasKey' in saved
              ? t('model.replaceKey')
              : t('model.pasteKey')
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
          disabled={!apiKey || status?.tone === 'busy'}
        >
          {t('model.testConnection')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!apiKey || status?.tone === 'busy'}
        >
          {t('common.save')}
        </button>
      </div>
      {status && (
        <p role="status" className={`model-status ${status.tone}`}>
          {status.text}
        </p>
      )}
    </fieldset>
  );
}
