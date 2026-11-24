import type { FetchLike } from '../api/lib/fetch-like';

export type CapturedCall = {
  url: string;
  headers: Headers;
  body: Record<string, unknown> | null;
};

/** Fake provider HTTP: records each call and answers with `respond(url)`. */
export function stubFetch(
  respond: (
    url: string,
    call: CapturedCall,
  ) => { status?: number; body: unknown },
): { fetch: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const raw = typeof init?.body === 'string' ? init.body : null;
    const call = {
      url,
      headers: new Headers(init?.headers),
      body: raw ? JSON.parse(raw) : null,
    };
    calls.push(call);
    const { status = 200, body } = respond(url, call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, calls };
}

/** Minimal OpenAI Responses API body. */
export const openaiResponse = (text: string, model = 'gpt-test') => ({
  id: 'resp_1',
  object: 'response',
  created_at: 1_700_000_000,
  status: 'completed',
  model,
  incomplete_details: null,
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
  usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
});

export const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`http://127.0.0.1:6113${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
