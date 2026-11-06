import type { Message } from '@ag-ui/core';

// Message IDs survive thread replay even when metadata does not.
export const scheduledTaskMessagePrefix = 'nexbot:scheduled_task:';

export function isScheduledTaskMessage(
  message: Pick<Message, 'id' | 'role' | 'metadata'>,
): boolean {
  if (message.role !== 'user') return false;
  if (message.id.startsWith(scheduledTaskMessagePrefix)) return true;
  const metadata = message.metadata;
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    'nexbotSource' in metadata &&
    metadata.nexbotSource === 'scheduled_task'
  );
}
