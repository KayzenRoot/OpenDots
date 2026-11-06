import { useEffect, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from './api';
import { useTranslation } from './i18n';

/** A skill as returned by the API, with its derived catalog description. */
type SkillView = {
  id: string;
  dotId: string;
  name: string;
  body: string;
  revision: number;
  enabled: boolean;
  status: 'approved' | 'proposed' | 'rejected';
  rejectionReason: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type Editor = { mode: 'new' | 'edit'; name: string; body: string } | null;

// Lives inside the Dot form, so it saves through its own requests and keeps
// Enter in one-line inputs from submitting the surrounding form.
const stayInSection = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault();
};

/**
 * Per-Dot skill management: approved skills (with enable/disable), model
 * proposals that need a human decision, and a plain Markdown editor with a
 * preview. A skill is a prompt fragment for a model to read, not code, so the
 * editor is deliberately plain.
 */
export function SkillsSection({ dotId }: { dotId: string }) {
  const { t } = useTranslation();
  const [approved, setApproved] = useState<SkillView[]>();
  const [proposals, setProposals] = useState<SkillView[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [rejecting, setRejecting] = useState<{
    name: string;
    reason: string;
  }>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    void api<{ skills: SkillView[]; proposals: SkillView[] }>(
      `/skills?dotId=${encodeURIComponent(dotId)}`,
    )
      .then((value) => {
        if (!active) return;
        setApproved(value.skills);
        setProposals(value.proposals);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : t('skills.loadFailed'),
          );
      });
    return () => {
      active = false;
    };
  }, [dotId, attempt]);

  const call = async <T,>(key: string, request: () => Promise<T>) => {
    setBusy(key);
    setError('');
    try {
      return await request();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('skills.requestFailed'),
      );
    } finally {
      setBusy('');
    }
  };

  const reload = () => setAttempt((value) => value + 1);

  const patch = async (
    name: string,
    action: 'enable' | 'disable' | 'approve',
  ) =>
    call(name, () =>
      api(
        `/skills/${encodeURIComponent(name)}?dotId=${encodeURIComponent(dotId)}`,
        'PATCH',
        {
          action,
        },
      ),
    ).then((done) => done && reload());

  const reject = async (name: string, reason: string) => {
    const done = await call(name, () =>
      api(
        `/skills/${encodeURIComponent(name)}?dotId=${encodeURIComponent(dotId)}`,
        'PATCH',
        {
          action: 'reject',
          reason,
        },
      ),
    );
    if (done) {
      setRejecting(undefined);
      reload();
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(t('skills.deleteConfirm', { name }))) return;
    const done = await call(name, () =>
      api(
        `/skills/${encodeURIComponent(name)}?dotId=${encodeURIComponent(dotId)}`,
        'DELETE',
      ),
    );
    if (done) reload();
  };

  const save = async () => {
    if (!editor) return;
    const done = await call('save', () =>
      api(
        `/skills/${encodeURIComponent(editor.name)}?dotId=${encodeURIComponent(dotId)}`,
        'PUT',
        {
          body: editor.body,
        },
      ),
    );
    if (done) {
      setEditor(null);
      reload();
    }
  };

  return (
    <fieldset className="space-access-fields skills-fields">
      <legend>{t('skills.title')}</legend>
      <p className="muted">{t('skills.help')}</p>

      {editor ? (
        <div className="skill-editor">
          <label className="field-label" htmlFor="skill-name">
            {t('skills.name')}
          </label>
          <input
            id="skill-name"
            value={editor.name}
            disabled={editor.mode === 'edit'}
            maxLength={64}
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder={t('skills.namePlaceholder')}
            onKeyDown={stayInSection}
            onChange={(event) =>
              setEditor({ ...editor, name: event.target.value.trim() })
            }
          />
          <p className="muted">{t('skills.nameHint')}</p>
          <label className="field-label" htmlFor="skill-body">
            {t('skills.body')}
          </label>
          <textarea
            id="skill-body"
            rows={8}
            value={editor.body}
            placeholder={t('skills.bodyPlaceholder')}
            onChange={(event) =>
              setEditor({ ...editor, body: event.target.value })
            }
          />
          <div className="skill-preview">
            <span className="field-label">{t('skills.preview')}</span>
            {editor.body.trim() ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt }) => <span>{alt}</span>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {editor.body}
              </ReactMarkdown>
            ) : (
              <p className="muted">{t('skills.noPreview')}</p>
            )}
          </div>
          <div className="skill-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditor(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!!busy || !editor.name || !editor.body.trim()}
              onClick={() => void save()}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="connection-connect"
          onClick={() => setEditor({ mode: 'new', name: '', body: '' })}
        >
          <Plus size={15} /> {t('skills.new')}
        </button>
      )}

      {approved?.length === 0 && <p className="muted">{t('skills.empty')}</p>}
      {approved?.map((skill) => (
        <div className="skill" key={skill.id}>
          <div className="skill-head">
            <span>
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
            </span>
            <em>{t('skills.revision', { revision: skill.revision })}</em>
          </div>
          <label className="permission-row">
            <input
              type="checkbox"
              checked={skill.enabled}
              disabled={!!busy}
              onChange={(event) =>
                void patch(
                  skill.name,
                  event.target.checked ? 'enable' : 'disable',
                )
              }
            />
            <span>
              <strong>
                {skill.enabled ? t('skills.enabled') : t('skills.disabled')}
              </strong>
            </span>
          </label>
          <div className="skill-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={t('skills.editAria', { name: skill.name })}
              disabled={!!busy}
              onClick={() =>
                setEditor({
                  mode: 'edit',
                  name: skill.name,
                  body: skill.body,
                })
              }
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('skills.deleteAria', { name: skill.name })}
              disabled={!!busy}
              onClick={() => void remove(skill.name)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}

      {proposals.length > 0 && (
        <div className="skill-proposals">
          <h4>{t('skills.proposals')}</h4>
          <p className="muted">{t('skills.proposalsHelp')}</p>
          {proposals.map((proposal) => (
            <div className="skill skill-proposal" key={proposal.id}>
              <div className="skill-head">
                <strong>{proposal.name}</strong>
              </div>
              <div className="skill-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {proposal.body}
                </ReactMarkdown>
              </div>
              {rejecting?.name === proposal.name ? (
                <div className="skill-reject">
                  <label className="field-label" htmlFor="skill-reject-reason">
                    {t('skills.rejectReason')}
                  </label>
                  <input
                    id="skill-reject-reason"
                    value={rejecting.reason}
                    maxLength={2000}
                    placeholder={t('skills.rejectReasonPlaceholder')}
                    onKeyDown={stayInSection}
                    onChange={(event) =>
                      setRejecting({
                        name: proposal.name,
                        reason: event.target.value,
                      })
                    }
                  />
                  <div className="skill-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setRejecting(undefined)}
                    >
                      <X size={14} /> {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy || !rejecting.reason.trim()}
                      onClick={() =>
                        void reject(proposal.name, rejecting.reason.trim())
                      }
                    >
                      {t('skills.reject')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="skill-actions">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void patch(proposal.name, 'approve')}
                  >
                    <Check size={14} /> {t('skills.approve')}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      setEditor({
                        mode: 'edit',
                        name: proposal.name,
                        body: proposal.body,
                      })
                    }
                  >
                    {t('skills.editApprove')}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      setRejecting({ name: proposal.name, reason: '' })
                    }
                  >
                    {t('skills.reject')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
