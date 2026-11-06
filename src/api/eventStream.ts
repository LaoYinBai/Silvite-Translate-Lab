/** Consume SSE data frames, including CRLF/CR and multi-line frames split across reads. */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => boolean | void,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let stopped = false;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  const line = (value: string) => {
    if (!value) {
      if (data.length) stopped = onData(data.join('\n')) === false;
      data = [];
    } else if (value.startsWith('data:')) {
      const field = value.slice(5);
      data.push(field.startsWith(' ') ? field.slice(1) : field);
    }
  };
  const consume = (flush = false) => {
    while (!stopped) {
      const match = /[\r\n]/.exec(buffer);
      if (!match) break;
      const index = match.index;
      if (!flush && buffer[index] === '\r' && index === buffer.length - 1) break;
      const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, index));
      buffer = buffer.slice(index + length);
    }
    if (buffer.length > 65_536 || data.join('\n').length > 65_536) throw new Error('SSE frame too large');
    if (flush && !stopped) { if (buffer) line(buffer); buffer = ''; line(''); }
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!stopped) {
      if (signal?.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); consume(true); break; }
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    if (signal?.aborted) throw signal.reason;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
