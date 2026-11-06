import { describe, expect, it } from 'vitest';
import {
  dotModelApiFromEnv,
  isReasoningModel,
  modelOptionsFor,
  resolveModelApi,
} from '../src/server/model-api.js';

describe('DOT_MODEL_API', () => {
  it.each(['', '  ', undefined])('defaults to auto (%s)', (value) => {
    expect(dotModelApiFromEnv({ DOT_MODEL_API: value })).toBe('auto');
  });

  it('accepts the three documented values with surrounding whitespace', () => {
    expect(dotModelApiFromEnv({ DOT_MODEL_API: ' auto ' })).toBe('auto');
    expect(dotModelApiFromEnv({ DOT_MODEL_API: 'chat-completions' })).toBe(
      'chat-completions',
    );
    expect(dotModelApiFromEnv({ DOT_MODEL_API: 'responses' })).toBe(
      'responses',
    );
  });

  it('rejects an unknown value without echoing it', () => {
    expect(() => dotModelApiFromEnv({ DOT_MODEL_API: 'response' })).toThrow(
      /DOT_MODEL_API/,
    );
  });
});

describe('automatic model API selection', () => {
  it.each(['o1', 'o3-mini', 'o4-mini', 'gpt-6.1-sol', 'deepseek-v4.1-flash'])(
    'routes %s through Responses',
    (model) => {
      expect(isReasoningModel(model)).toBe(true);
      expect(resolveModelApi(model)).toBe('responses');
    },
  );

  it.each(['gpt-4o', 'gpt-5.4-mini', 'gpt-6mini', 'custom-model'])(
    'leaves %s on Chat Completions',
    (model) => {
      expect(isReasoningModel(model)).toBe(false);
      expect(resolveModelApi(model)).toBe('chat-completions');
    },
  );

  it('lets an explicit setting override automatic selection', () => {
    expect(resolveModelApi('gpt-6.1-sol', 'chat-completions')).toBe(
      'chat-completions',
    );
    expect(resolveModelApi('gpt-4o', 'responses')).toBe('responses');
  });
});

describe('model options', () => {
  it('keeps the existing Chat Completions budget and adds nothing else', () => {
    expect(modelOptionsFor('chat-completions')).toEqual({
      max_completion_tokens: 2200,
    });
  });

  it('uses the Responses budget, stateless storage and encrypted reasoning', () => {
    expect(modelOptionsFor('responses')).toEqual({
      max_output_tokens: 2200,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
  });
});
