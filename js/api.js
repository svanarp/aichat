/* ═══════════════════════════════════════════════
   api.js — OpenAI-compatible API client (streaming)
   ═══════════════════════════════════════════════ */

const Api = (() => {
  'use strict';

  /* ── Send a chat completion with streaming ──
     Returns an object { abort() } so caller can cancel.
     Calls onToken(content) for each chunk, onDone(fullContent) when complete.
  */
  function sendChat({ endpoint, apiKey, model, messages, temperature, max_tokens, reasoning_effort, onToken, onDone, onError, signal, timeout = 30000 }) {
    const url = endpoint.replace(/\/+$/, '') + '/chat/completions';

    // Warn if messages exceed a reasonable size (truncated responses waste tokens)
    const totalChars = (messages || []).reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
    if (totalChars > 200000) {
      console.warn(`[API] Large request body: ~${(totalChars / 1024).toFixed(0)}KB of message content`);
    }

    const abortController = new AbortController();
    const combinedSignal = signal
      ? combineSignals(abortController.signal, signal)
      : abortController.signal;

    let retries = 0;
    const maxRetries = 3;

    function attempt() {
      (async () => {
        let timeoutId = null;
        let accumulatedContent = '';
        let accumulatedReasoning = '';
        // Count consumed tokens (including partial/aborted streams).
        function recordUsage() {
          const tokens = Math.ceil((accumulatedContent.length + accumulatedReasoning.length) / 4);
          if (tokens > 0) Store.addUsage(tokens);
        }
        try {
          const requestBody = {
            model,
            messages,
            stream: true
          };
          if (temperature != null) requestBody.temperature = temperature;
          if (max_tokens != null) requestBody.max_tokens = max_tokens;
          if (reasoning_effort != null) requestBody.reasoning_effort = reasoning_effort;

          // Set up timeout
          if (timeout && timeout > 0) {
            timeoutId = setTimeout(() => {
              abortController.abort();
            }, timeout);
          }

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(requestBody),
            signal: combinedSignal
          });

          // Clear timeout if we got a response
          if (timeoutId) clearTimeout(timeoutId);

          if (!response.ok) {
            let errMsg = `HTTP ${response.status}`;
            try {
              const errBody = await response.json();
              errMsg = errBody.error?.message || errMsg;
            } catch (_) { console.warn('[API] Failed to parse error response'); }

            if ((response.status >= 500 || response.status === 429) && retries < maxRetries) {
              retries++;
              const delay = Math.min(1000 * Math.pow(2, retries) + Math.random() * 1000, 10000);
              await new Promise(r => setTimeout(r, delay));
              attempt();
              return;
            }
            throw new Error(errMsg);
          }

          if (!response.body) {
            // Non-streaming fallback: read entire response as JSON
            const fallbackData = await response.json();
            const choice = fallbackData.choices?.[0];
            onToken({
              content: choice?.message?.content || '',
              reasoning: choice?.message?.reasoning_content || '',
              totalContent: choice?.message?.content || '',
              totalReasoning: choice?.message?.reasoning_content || ''
            });
            onDone({
              content: choice?.message?.content || '',
              reasoning: choice?.message?.reasoning_content || '',
              usage: fallbackData.usage || null
            });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let usageData = null;
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

                  try {
                    const parsed = JSON.parse(data);
                    const choice = parsed.choices?.[0]?.delta;
                    const contentDelta = choice?.content;
                    const reasoningDelta = choice?.reasoning_content;
                    if (parsed.usage) usageData = parsed.usage;
                    if (contentDelta) accumulatedContent += contentDelta;
                    if (reasoningDelta) accumulatedReasoning += reasoningDelta;
                    if (contentDelta || reasoningDelta) {
                      onToken({
                        content: contentDelta || '',
                        reasoning: reasoningDelta || '',
                        totalContent: accumulatedContent,
                        totalReasoning: accumulatedReasoning
                      });
                    }
                  } catch (_) { console.warn('[API] Failed to parse streaming chunk'); }
                }
              }

          if (buffer.trim().startsWith('data: ')) {
            const data = buffer.trim().slice(6);
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                const choice = parsed.choices?.[0]?.delta;
                const contentDelta = choice?.content;
                const reasoningDelta = choice?.reasoning_content;
                if (parsed.usage) usageData = parsed.usage;
                if (contentDelta) accumulatedContent += contentDelta;
                if (reasoningDelta) accumulatedReasoning += reasoningDelta;
                if (contentDelta || reasoningDelta) {
                  onToken({
                    content: contentDelta || '',
                    reasoning: reasoningDelta || '',
                    totalContent: accumulatedContent,
                    totalReasoning: accumulatedReasoning
                  });
                }
              } catch (_) { console.warn('[API] Failed to parse SSE line'); }
            }
          }

          recordUsage();

          onDone({
            content: accumulatedContent,
            reasoning: accumulatedReasoning,
            usage: usageData
          });
        } catch (err) {
          // Clear timeout on error as well
          if (timeoutId) clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            recordUsage();
            onDone({ content: '', reasoning: '', usage: null }, true);
            return;
          }
          // Only retry when nothing has been streamed yet. Restarting after
          // partial output would silently overwrite content already shown.
          const hasPartial = accumulatedContent.length > 0 || accumulatedReasoning.length > 0;
          if (!hasPartial && retries < maxRetries) {
            retries++;
            const delay = Math.min(1000 * Math.pow(2, retries) + Math.random() * 1000, 10000);
            await new Promise(r => setTimeout(r, delay));
            attempt();
            return;
          }
          recordUsage();
          onError(err.message || 'Unknown error');
        }
      })();
    }

    attempt();

    return { abort: () => abortController.abort() };
  }

  /* ── Test connection (non-streaming) ── */
  async function testConnection({ endpoint, apiKey, model }) {
    const url = endpoint.replace(/\/+$/, '') + '/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        max_tokens: 2,
        stream: false
      })
    });
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { const e = await response.json(); msg = e.error?.message || msg; } catch (_) { console.warn('[API] Failed to parse verify error'); }
      throw new Error(msg);
    }
    return true;
  }

  function combineSignals(...signals) {
    const controller = new AbortController();
    const cleanup = () => {
      for (const s of signals) {
        s.removeEventListener('abort', cleanup);
      }
    };
    for (const s of signals) {
      if (s.aborted) { controller.abort(); return controller.signal; }
      s.addEventListener('abort', cleanup, { once: true });
    }
    controller.signal.addEventListener('abort', cleanup, { once: true });
    return controller.signal;
  }

  /* ── Fetch available models from endpoint ── */
  async function fetchModels({ endpoint, apiKey }) {
    const url = endpoint.replace(/\/+$/, '') + '/models';
    const response = await fetch(url, {
      headers: {
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      }
    });
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { const e = await response.json(); msg = e.error?.message || msg; } catch (_) { console.warn('[API] Failed to parse fetchModels error'); }
      throw new Error(msg);
    }
    const data = await response.json();
    // OpenAI returns { data: [{ id: 'gpt-4', ... }] }
    // Ollama returns { models: [{ name: 'llama3', ... }] }
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id).filter(Boolean);
    }
    if (data.models && Array.isArray(data.models)) {
      return data.models.map(m => m.name || m.model).filter(Boolean);
    }
    throw new Error('Unrecognized models response format');
  }

  return { sendChat, testConnection, fetchModels };
})();

// Explicit global (rather than relying on classic-script implicit scope sharing).
window.Api = Api;