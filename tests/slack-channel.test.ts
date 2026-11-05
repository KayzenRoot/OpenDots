import { afterEach, expect, it, vi } from 'vitest';
import {
  reportChannelFailure,
  safeFailure,
  slackActorId,
  slackConversation,
  slackOperation,
  slackPrompt,
  type SlackEventEnvelope,
} from '../src/server/slack-channel.js';
const config = { slackTeam: 'team', slackUsers: ['person'] };
const envelope: SlackEventEnvelope = {
  type: 'event_callback',
  event_id: 'Ev1',
  team_id: 'team',
  event: {
    type: 'app_mention',
    user: 'person',
    text: '<@U0BOT> Help',
    ts: '100.1',
    channel: 'C1',
  },
};
it('requires an explicit Slack tenant and user allowlist for the acting human', () => {
  expect(slackActorId(envelope, config)).toBe('person');
  expect(slackActorId({ ...envelope, team_id: 'other' }, config)).toBeNull();
  expect(
    slackActorId(
      { ...envelope, event: { ...envelope.event, user: 'other' } },
      config,
    ),
  ).toBeNull();
  expect(
    slackActorId(
      { ...envelope, event: { ...envelope.event, user: undefined } },
      config,
    ),
  ).toBeNull();
});
it('ignores nonhuman actors and the app’s own bot user without side effects', () => {
  for (const patch of [
    { bot_id: 'B1' },
    { subtype: 'bot_message' },
    { user: 'BOTUSER' },
  ] as const)
    expect(
      slackActorId(
        { ...envelope, event: { ...envelope.event, ...patch } },
        config,
        'BOTUSER',
      ),
    ).toBeNull();
});
it('defaults an absent operation to created and rejects edits and deletions', () => {
  const event = envelope.event!;
  expect(slackOperation(event)).toBe('created');
  expect(slackOperation({ ...event, subtype: 'thread_broadcast' })).toBe(
    'created',
  );
  expect(slackOperation({ ...event, subtype: 'message_changed' })).toBe(
    'updated',
  );
  expect(slackOperation({ ...event, edited: { user: 'person' } })).toBe(
    'updated',
  );
  expect(slackOperation({ ...event, subtype: 'message_deleted' })).toBe(
    'deleted',
  );
});
it('keys a conversation by the Slack thread and strips the bot mention', () => {
  expect(slackConversation(envelope.event!)).toEqual({
    channel: 'C1',
    threadTs: '100.1',
  });
  expect(slackConversation({ ...envelope.event!, thread_ts: '99.0' })).toEqual({
    channel: 'C1',
    threadTs: '99.0',
  });
  expect(slackConversation({ type: 'app_mention' })).toBeNull();
  expect(slackPrompt(envelope.event!)).toBe('Help');
});
it('sanitises provider failures and never echoes provider text', () => {
  expect(safeFailure(new Error('SECRET provider details'))).toBe('Error');
  expect(safeFailure(new TypeError('SECRET'))).toBe('TypeError');
  expect(safeFailure(Object.assign(new Error('SECRET'), { status: 429 }))).toBe(
    'Error (HTTP 429)',
  );
  expect(safeFailure(Object.assign(new Error('SECRET'), { status: 99 }))).toBe(
    'Error',
  );
  expect(safeFailure('SECRET')).toBe('Error');
});
it('reports channel failures through console.error without secrets', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  reportChannelFailure('Slack notice failed', ['Error']);
  expect(spy).toHaveBeenCalledWith('Slack notice failed: Error');
});
afterEach(() => vi.restoreAllMocks());
