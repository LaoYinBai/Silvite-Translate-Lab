export function relayTranslation(upstreamBody, identity, upstreamController, cleanup, invalidTranslation) {
  const encoder = new TextEncoder();
  let reader;
  let cancelled = false;
  const cancelRead = () => { void reader?.cancel(upstreamController.signal.reason).catch(() => undefined); };
  return new ReadableStream({
    async start(controller) {
      reader = upstreamBody.getReader();
      const emit = (event) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...identity, ...event })}\n\n`));
      };
      const decoder = new TextDecoder();
      let buffer = '';
      let data = [];
      let translation = '';
      let completed = false;
      const failure = (code) => Object.assign(new Error(code), { code });
      const dispatch = () => {
        if (!data.length || completed) { data = []; return; }
        const raw = data.join('\n');
        data = [];
        if (raw === '[DONE]') { completed = true; return; }
        let payload;
        try { payload = JSON.parse(raw); } catch { throw failure('INVALID_UPSTREAM_RESPONSE'); }
        if (payload?.error) throw failure('TRANSLATION_UPSTREAM_ERROR');
        const choice = payload?.choices?.[0];
        const content = choice?.delta?.content ?? choice?.message?.content;
        const delta = typeof content === 'string' ? content : Array.isArray(content)
          ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('') : '';
        if (delta) {
          translation += delta;
          if (translation.length > 12_000 || invalidTranslation(translation)) throw failure('INVALID_TRANSLATION');
          emit({ type: 'delta', delta, offset: translation.length });
        }
        if (choice?.finish_reason != null) {
          if (choice.finish_reason !== 'stop') throw failure('TRANSLATION_TRUNCATED');
          completed = true;
        }
      };
      const line = (value) => {
        if (!value) dispatch();
        else if (value.startsWith('data:')) {
          const field = value.slice(5);
          data.push(field.startsWith(' ') ? field.slice(1) : field);
        }
      };
      const consume = (flush = false) => {
        while (!completed) {
          const match = /[\r\n]/.exec(buffer);
          if (!match) break;
          const index = match.index;
          if (!flush && buffer[index] === '\r' && index === buffer.length - 1) break;
          const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
          line(buffer.slice(0, index));
          buffer = buffer.slice(index + length);
        }
        if (buffer.length > 65_536 || data.join('\n').length > 65_536) throw failure('INVALID_UPSTREAM_RESPONSE');
        if (flush && !completed) { if (buffer) line(buffer); buffer = ''; dispatch(); }
      };
      upstreamController.signal.addEventListener('abort', cancelRead, { once: true });
      try {
        emit({ type: 'start' });
        while (!completed) {
          if (upstreamController.signal.aborted) throw failure('TRANSLATION_STREAM_INTERRUPTED');
          const { value, done } = await reader.read();
          if (done) { buffer += decoder.decode(); consume(true); break; }
          buffer += decoder.decode(value, { stream: true });
          consume();
        }
        if (upstreamController.signal.aborted || !completed) throw failure('TRANSLATION_STREAM_INTERRUPTED');
        if (!translation.trim() || invalidTranslation(translation)) throw failure('INVALID_TRANSLATION');
        emit({ type: 'final', text: translation.trim() });
      } catch (error) {
        if (!cancelled) emit({ type: 'error', code: error?.code || 'TRANSLATION_STREAM_INTERRUPTED',
          message: '实时翻译未正常完成，原文已保留，可重试。' });
      } finally {
        upstreamController.signal.removeEventListener('abort', cancelRead);
        cleanup();
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        if (!cancelled) controller.close();
      }
    },
    cancel(reason) {
      cancelled = true;
      upstreamController.abort(reason);
      cleanup();
      return reader?.cancel(reason).catch(() => undefined);
    },
  });
}
