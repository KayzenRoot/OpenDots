import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  PanelLeft,
  Check,
  LoaderCircle,
  FileCode2,
} from 'lucide-react';
import type { Page } from '../server/pages';
import type { WorkspaceState } from '../shared/types';
import { api } from './api';
import { usePageAutosave } from './editor/use-page-autosave';
import { inspectMarkdown } from './editor/markdown';
import { DocumentMenu } from './editor/DocumentMenu';
import { PageConversation } from './PageConversation';
import { useTranslation } from './i18n';
const RichEditor = lazy(() => import('./editor/RichEditor'));
export function PageDocument({
  page,
  pages,
  workspace,
  paused,
  onHome,
  onOutline,
  onSubpage,
  onDirty,
  onSaved,
  onRefresh,
  onDeleted,
  onSchedule,
  onThread,
  onSettings,
  onCreateDot,
}: {
  page: Page;
  pages: Page[];
  workspace: WorkspaceState;
  paused: boolean;
  onHome: () => void;
  onOutline: () => void;
  onSubpage: () => void;
  onDirty: (value: boolean) => void;
  onSaved: (page: Page) => void;
  onRefresh: () => void;
  onDeleted: (id: string) => void;
  onSchedule: (id: string) => void;
  onThread: (id: string) => void;
  onSettings: () => void;
  onCreateDot: () => void;
}) {
  const { t } = useTranslation();
  const { controller, state } = usePageAutosave(page, onSaved);
  const draft = state.draft!;
  const [source, setSource] = useState(false);
  const [move, setMove] = useState(false);
  const [notice, setNotice] = useState('');
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const [chatOpen, setChatOpen] = useState(false);
  const safety = useMemo(() => inspectMarkdown(draft.content), [draft.content]);
  const sourceMode = source || !safety.supported;
  useEffect(() => {
    onDirty(controller.dirty);
    return () => onDirty(false);
  }, [state, controller, onDirty]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (controller.dirty) event.preventDefault();
    };
    const save = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's' &&
        !event.isComposing
      ) {
        event.preventDefault();
        void controller.flush(true);
      }
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('keydown', save);
    return () => {
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('keydown', save);
    };
  }, [controller]);
  const beforeChat = useCallback(() => controller.flush(true), [controller]);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([draft.content], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 80) || 'page'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const latest = async () => {
    if (!window.confirm(t('doc.loadLatestConfirm'))) return;
    const confirmedDraft = controller.getSnapshot().draft;
    try {
      const latestPage = await api<Page>(
        `/spaces/${page.spaceId}/pages/${page.id}`,
      );
      if (!open.current) return;
      const edited = controller.getSnapshot().draft !== confirmedDraft;
      controller.receive(latestPage);
      if (edited) {
        setNotice(t('doc.draftChanged'));
        return;
      }
      controller.useLatest();
      setNotice('');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : t('doc.loadLatestFailed'),
      );
    }
  };
  const descendants = new Set([page.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of pages)
      if (
        item.parentId &&
        descendants.has(item.parentId) &&
        !descendants.has(item.id)
      ) {
        descendants.add(item.id);
        changed = true;
      }
  }
  const status =
    state.status === 'saving'
      ? t('doc.statusSaving')
      : state.status === 'saved'
        ? t('doc.statusSaved')
        : state.status === 'dirty'
          ? t('doc.statusDirty')
          : state.status === 'conflict'
            ? t('doc.statusConflict')
            : t('doc.statusError');
  return (
    <section
      className={`document-session ${chatOpen ? 'chat-visible' : ''}`}
      aria-label={t('doc.workspace')}
    >
      <div className="document-column">
        <header className="document-topbar">
          <button className="document-back" onClick={onHome}>
            <ArrowLeft size={16} />
            <span>{t('doc.allPages')}</span>
          </button>
          <button
            className="document-icon"
            aria-label={t('doc.toggleOutline')}
            onClick={onOutline}
          >
            <PanelLeft size={17} />
          </button>
          <span
            className={`document-save-status ${state.status}`}
            role="status"
            aria-live="polite"
          >
            {state.status === 'saved' ? (
              <Check size={13} />
            ) : state.status === 'saving' ? (
              <LoaderCircle size={13} className="saving-spinner" />
            ) : null}
            {status}
          </span>
          <DocumentMenu
            items={[
              {
                label: t('doc.menuSaveNow'),
                action: () => void controller.flush(true),
              },
              {
                label: sourceMode
                  ? t('doc.menuVisualEditor')
                  : t('doc.menuMarkdownSource'),
                action: () => {
                  if (sourceMode && !safety.supported) {
                    setNotice(safety.reason ?? t('doc.needsSourceMode'));
                    return;
                  }
                  setSource(!sourceMode);
                },
              },
              { label: t('doc.menuMovePage'), action: () => setMove(!move) },
              { label: t('doc.menuNewSubpage'), action: onSubpage },
              { label: t('doc.menuDownload'), action: download },
              ...(page.sourceThreadId
                ? [
                    {
                      label: t('doc.menuOpenSource'),
                      action: () => onThread(page.sourceThreadId!),
                    },
                  ]
                : []),
              {
                label: t('doc.menuDelete'),
                action: async () => {
                  if (
                    !window.confirm(
                      t('doc.deleteConfirm', {
                        title: draft.title || t('doc.untitled'),
                      }),
                    )
                  )
                    return;
                  try {
                    await api(
                      `/spaces/${page.spaceId}/pages/${page.id}`,
                      'DELETE',
                    );
                    onDeleted(page.id);
                    onRefresh();
                    // A slow DELETE can finish after the user opened another
                    // page: only leave, and drop the pending autosave, if this
                    // document is still the one on screen.
                    if (open.current) {
                      controller.dispose();
                      onDirty(false);
                      onHome();
                    }
                  } catch (error) {
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : t('doc.deleteFailed'),
                    );
                  }
                },
              },
            ]}
          />
        </header>
        <div className="document-scroll">
          <article className="document-reading-column">
            {state.error && (
              <div
                className={`document-save-notice ${state.status}`}
                role="alert"
              >
                <p>{state.error}</p>
                <div>
                  {state.status === 'error' && (
                    <button onClick={() => void controller.flush(true)}>
                      {t('doc.retrySave')}
                    </button>
                  )}
                  <button onClick={download}>{t('doc.downloadDraft')}</button>
                  {state.status === 'conflict' && (
                    <button onClick={() => void latest()}>
                      {t('doc.loadLatest')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {notice && (
              <div className="document-notice" role="status">
                {notice}
                <button onClick={() => setNotice('')}>
                  {t('common.dismiss')}
                </button>
              </div>
            )}
            {move && (
              <div
                className="document-move"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setMove(false);
                }}
              >
                <label>
                  {t('doc.moveUnder')}
                  <select
                    autoFocus
                    aria-label={t('doc.parentPage')}
                    value={draft.parentId ?? ''}
                    onChange={(e) =>
                      controller.edit({ parentId: e.target.value || null })
                    }
                  >
                    <option value="">{t('doc.spaceRoot')}</option>
                    {pages
                      .filter((p) => !descendants.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button onClick={() => setMove(false)}>
                  {t('common.done')}
                </button>
              </div>
            )}
            <input
              className="document-title"
              aria-label={t('doc.pageTitle')}
              placeholder={t('doc.untitledPage')}
              maxLength={160}
              value={draft.title}
              onChange={(event) =>
                controller.edit({ title: event.target.value })
              }
            />
            {sourceMode ? (
              <>
                <div className="source-mode-label">
                  <FileCode2 size={15} />
                  <span>{t('doc.markdownSource')}</span>
                </div>
                {!safety.supported && (
                  <p className="source-mode-reason">{safety.reason}</p>
                )}
                <textarea
                  className="document-source"
                  aria-label={t('doc.pageMarkdown')}
                  spellCheck={false}
                  value={draft.content}
                  maxLength={100000}
                  onChange={(event) =>
                    controller.edit({ content: event.target.value })
                  }
                />
              </>
            ) : (
              <Suspense
                fallback={
                  <div className="editor-loading">{t('doc.loadingEditor')}</div>
                }
              >
                <RichEditor
                  value={draft.content}
                  onChange={(content) => controller.edit({ content })}
                  onNotice={setNotice}
                />
              </Suspense>
            )}
          </article>
        </div>
      </div>
      <div className={`document-assistant ${chatOpen ? 'open' : ''}`}>
        <PageConversation
          page={page}
          workspace={workspace}
          paused={paused}
          beforeChat={beforeChat}
          onRefresh={onRefresh}
          onSchedule={onSchedule}
          onSettings={onSettings}
          onCreateDot={onCreateDot}
          onOpenChange={setChatOpen}
        />
      </div>
    </section>
  );
}
