export function responsesCompletion(text: string) {
  const chunks = [
    {
      type: 'response.created',
      response: {
        id: 'response',
        object: 'response',
        status: 'in_progress',
        model: 'custom-model',
      },
    },
    {
      type: 'response.output_text.delta',
      item_id: 'message',
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: 'response.completed',
      response: {
        id: 'response',
        object: 'response',
        status: 'completed',
        model: 'custom-model',
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
      'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

export function completion(
  delta: Record<string, unknown>,
  finishReason = 'stop',
) {
  const chunks = [
    {
      id: 'completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'custom-model',
      choices: [{ index: 0, delta, finish_reason: null }],
    },
    {
      id: 'completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'custom-model',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
      'data: [DONE]\n\n',
    {
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}
