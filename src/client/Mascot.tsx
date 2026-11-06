import { useTranslation, type MessageKey } from './i18n';

const characters = ['blue', 'mint', 'orange', 'purple'] as const;

const stateKeys: Record<string, MessageKey> = {
  idle: 'mascot.stateIdle',
  working: 'mascot.stateWorking',
  paused: 'mascot.statePaused',
};

/** Stable identity keeps each specialist recognizable across views and reloads. */
function characterFor(identity?: string) {
  if (!identity) return characters[0];
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return characters[hash % characters.length];
}

export function Mascot({
  state = 'idle',
  small = false,
  identity,
  name = 'Dot',
  decorative = false,
}: {
  state?: string;
  small?: boolean;
  identity?: string;
  name?: string;
  decorative?: boolean;
}) {
  const { t } = useTranslation();
  const label = stateKeys[state] ? t(stateKeys[state]) : state;
  return (
    <span className={`mascot ${state} ${small ? 'small' : ''}`}>
      <img
        className="dot-body"
        src={`/dots/${characterFor(identity)}.png`}
        alt={decorative ? '' : t('mascot.alt', { name, state: label })}
        width={512}
        height={512}
        draggable={false}
      />
    </span>
  );
}
