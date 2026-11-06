import { useEffect, useState } from 'react';
import { api } from './api';

type Saved =
  { configured: false } | { baseUrl: string; model: string; hasKey: true };

/**
 * Model provider form inside Settings. The key is write-only: it is sent once,
 * tested by the server, and never shown again. Saving is refused unless the
 * provider accepts the key, so a typo cannot silently break every conversation.
 */
export function ModelSettings() {
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
    setStatus({ tone: 'busy', text: 'Testing the connection…' });
    try {
      await api('/model/test', 'POST', JSON.parse(body()));
      setStatus({
        tone: 'ok',
        text: 'The provider accepted this configuration.',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Test failed.',
      });
    }
  };

  const save = async () => {
    setStatus({ tone: 'busy', text: 'Testing and saving…' });
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
        text: 'Saved. New conversations use this provider.',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Save failed.',
      });
    }
  };

  return (
    <fieldset className="model-settings">
      <legend>Model provider</legend>
      <p className="muted">
        {saved && 'hasKey' in saved
          ? `Connected to ${saved.model}. The key is stored encrypted and is not shown again.`
          : 'Choose the provider your conversations will use.'}
      </p>
      <label className="field">
        <span>Base URL</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Model</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            saved && 'hasKey' in saved
              ? 'Enter a new key to replace it'
              : 'Paste your key'
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
          Test connection
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!apiKey || status?.tone === 'busy'}
        >
          Save
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
