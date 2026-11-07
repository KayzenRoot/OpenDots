import { useThreads } from '@copilotkit/react-core/v2';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import type { Conversation, Dot } from '../shared/types';
import { useTranslation } from './i18n';
export function ThreadList({
  dots,
  dotId,
  local,
  selected,
  onSelect,
  onNew,
  onDelete,
}: {
  dots: Dot[];
  dotId: string;
  local: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** When provided, each row shows a delete action for its conversation. */
  onDelete?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const threads = useThreads({
    agentId: dotId,
    enabled: true,
    includeArchived: false,
    limit: 20,
  });
  return (
    <section className="thread-list">
      <div className="nav-label">
        {t('threads.heading')}
        <button
          className="icon-button"
          onClick={onNew}
          aria-label={t('threads.new')}
        >
          <Plus size={14} />
        </button>
      </div>
      {threads.error && (
        <p className="sidebar-error">{t('threads.syncUnavailable')}</p>
      )}
      {local.map((thread) => {
        const remote = threads.threads.find((item) => item.id === thread.id);
        const title = remote?.name || thread.title;
        return (
          <div className="thread-row" key={thread.id}>
            <button
              className={`nav-item ${selected === thread.id ? 'active' : ''}`}
              onClick={() => onSelect(thread.id)}
            >
              <MessageCircle size={15} />
              <span className="thread-summary">
                <span>{title}</span>
                <small>
                  {dots.find((dot) => dot.id === thread.dotId)?.name}
                </small>
              </span>
            </button>
            {onDelete && (
              <button
                className="icon-button thread-delete"
                aria-label={t('threads.deleteAria', { title })}
                title={t('threads.deleteAria', { title })}
                onClick={() => onDelete(thread.id)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
      {!local.length && <p className="sidebar-empty">{t('threads.empty')}</p>}
      {threads.hasMoreThreads && (
        <button
          className="text-button"
          disabled={threads.isFetchingMoreThreads}
          onClick={() => void threads.fetchMoreThreads()}
        >
          {t('threads.loadMore')}
        </button>
      )}
    </section>
  );
}
