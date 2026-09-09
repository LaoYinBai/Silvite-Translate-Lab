// Shared test helpers for the /api/translate SSE handler tests.

// Builds a fake MiMo SSE response carrying the given content as stream
// deltas. Optional per-call behavior for retry scenarios.
export function mimoSseResponse(content, { finishReason = 'stop' } = {}) {
  const parts = [];
  if (content) {
    parts.push(JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }));
  }
  parts.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] }));
  parts.push('[DONE]');
  const text = parts.map((p) => `data: ${p}\n\n`).join('');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Parses the SSE response body into application events (data: JSON lines).
export async function readSseEvents(response) {
  const text = await response.text();
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    events.push(JSON.parse(payload));
  }
  return events;
}

export function finalEventOf(events) {
  return events.find((e) => e.type === 'final')?.result;
}

// Each request gets its own source IP so the module-level rate limiter
// cannot leak between tests (retries multiply the call count).
let requestIpCounter = 0;

export function makeRequest(body, extraHeaders = {}) {
  const ip = extraHeaders['x-forwarded-for'] || `test-ip-${++requestIpCounter}`;
  return new Request('http://localhost:3001/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...extraHeaders },
    body: JSON.stringify(body),
  });
}
