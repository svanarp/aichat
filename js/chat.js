/* ═══════════════════════════════════════════════
   chat.js — Chat CRUD, message operations
   ═══════════════════════════════════════════════ */

const ChatManager = (() => {
  'use strict';

  /* ── State ── */
  let currentChat = null;       // the full chat object in memory
  let streamingChat = null;     // holds the chat being actively streamed (preserved across switches)
  let sending = false;          // guards against double-send on rapid Enter / click
  let abortFn = null;           // to cancel streaming
  let listeners = [];

  function onChange(fn) {
    listeners.push(fn);
  }

  const EVENTS = {
    UPDATE: 'update',
    PIN: 'pin',
    RENAME: 'rename',
    MODEL: 'model'
  };

  function notify(type = EVENTS.UPDATE) {
    listeners.forEach(fn => {
      try { fn(type); } catch (err) { console.error('[ChatManager] notify listener error:', err); }
    });
  }

  const THINKING_MODE_PROMPT = 'Use deliberate reasoning before answering. If helpful, include a concise reasoning summary inside <think>...</think>, then provide the final answer clearly.';

  function buildApiMessages(chat, settings) {
    const apiMessages = chat.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const systemParts = [];
    if (settings.systemPrompt) systemParts.push(settings.systemPrompt);
    if (settings.thinkingMode) systemParts.push(THINKING_MODE_PROMPT);
    if (systemParts.length) {
      apiMessages.unshift({ role: 'system', content: systemParts.join('\n\n') });
    }

    return apiMessages;
  }

  /* ── Create a new chat ── */
  async function createChat(model) {
    const chat = {
      id: Utils.generateId(),
      title: 'New Chat',
      model: model || '',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {}
    };
    currentChat = chat;
    notify();
    return chat;
  }

  /* ── Load an existing chat ── */
  async function loadChat(id) {
    // If switching away from a streaming chat, save its current state first,
    // then abort the stream (avoids race where abort triggers onDone → stale save)
    if (currentChat && currentChat.id !== id && streamingChat) {
      const chatToSave = streamingChat;
      try {
        await Store.saveChat(chatToSave);
      } catch (err) {
        console.error('[ChatManager] Failed to save streaming chat before switch:', err);
      }
      abortStreaming();
    }
    // If the requested chat is the one being streamed, use the in-memory copy
    if (streamingChat && streamingChat.id === id) {
      currentChat = streamingChat;
      notify();
      return currentChat;
    }
    const chat = await Store.getChat(id);
    if (chat) {
      currentChat = chat;
      notify();
    }
    return chat;
  }

  /* ── Get current chat (immutable snapshot for UI) ── */
  function getCurrentChat() {
    return currentChat ? Utils.deepClone(currentChat) : null;
  }

  /* ── Add a user message and trigger API call ── */
  async function sendMessage(content) {
    if (!currentChat || !content.trim()) return;
    if (streamingChat?.id === currentChat.id) return;
    if (sending) return;
    sending = true;

    const config = Store.loadConfig();
    if (!config.endpoint || !config.model) {
      sending = false;
      UI.showToast('Please configure an API endpoint first.', 'error');
      return;
    }

    const snapshot = Utils.deepClone(currentChat);

    // Update title on first message
    if (currentChat.messages.length === 0) {
      currentChat.title = content.slice(0, 60) + (content.length > 60 ? '…' : '');
    }

    const userMsg = {
      id: Utils.generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now()
    };
    currentChat.messages.push(userMsg);
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      sending = false;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save message — changes discarded', 'error');
      return;
    }
    notify();

    // Prepare messages for API
    const settings = currentChat.settings || {};
    const apiMessages = buildApiMessages(currentChat, settings);
    await _sendApiRequest(apiMessages);
  }

  /* ── Edit a user message and resend ── */
  async function editAndResend(msgId, newContent) {
    if (!currentChat || !msgId || !newContent.trim()) return;
    if (streamingChat?.id === currentChat.id) return;
    if (sending) return;
    sending = true;

    const msgIndex = currentChat.messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) { sending = false; return; }
    if (currentChat.messages[msgIndex].role !== 'user') { sending = false; return; }

    const snapshot = Utils.deepClone(currentChat);

    // Replace the message content
    currentChat.messages[msgIndex].content = newContent.trim();
    currentChat.messages[msgIndex].timestamp = Date.now();

    // Remove all messages after this one
    currentChat.messages = currentChat.messages.slice(0, msgIndex + 1);

    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      sending = false;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save edits — changes discarded', 'error');
      return;
    }
    notify();

    // Now send the updated conversation to the API
    await _sendFromCurrent();
  }

  /* ── Shared: send messages to the API and handle streaming ── */
  async function _sendApiRequest(apiMessages) {
    if (!currentChat) { sending = false; return; }
    const config = Store.loadConfig();
    const settings = currentChat.settings || {};

    const assistantMsg = {
      id: Utils.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };
    currentChat.messages.push(assistantMsg);

    // Abort any existing orphaned stream before starting a new one
    if (abortFn) {
      abortFn.abort();
      abortFn = null;
    }

    streamingChat = currentChat;
    // Render synchronously so the DOM element exists for updateStreamingMessage
    // before the first chunk arrives (avoids rAF race condition).
    UI.renderMessages(currentChat);
    notify();

    let streamStartTime = Date.now();
    let chunkCount = 0;
    let lastPersistTime = 0;
    const activeChat = streamingChat;

    const streamGuard = setTimeout(() => {
      if (streamingChat) {
        console.warn('[ChatManager] Stream guard triggered — forcing reset after timeout');
        sending = false;
        streamingChat = null;
        abortFn = null;
        notify();
      }
    }, 120000);

    abortFn = Api.sendChat({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: currentChat.model || config.model,
      messages: apiMessages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      reasoning_effort: settings.reasoningEffort,
      timeout: 30000,
      onToken: ({ content, reasoning, totalContent, totalReasoning }) => {
        if (totalContent) assistantMsg.content = totalContent;
        if (totalReasoning) assistantMsg.reasoningContent = totalReasoning;
        chunkCount++;
        const elapsed = (Date.now() - streamStartTime) / 1000;
        const speed = elapsed > 0 ? (chunkCount / elapsed).toFixed(1) : '0.0';
        assistantMsg.streamSpeed = speed;
        UI.updateStreamingMessage(assistantMsg.id, totalContent, totalReasoning, { tokens: chunkCount, speed });
        // Periodic checkpoint so a page close mid-stream keeps most of the reply
        const now = Date.now();
        if (now - lastPersistTime > 5000) {
          lastPersistTime = now;
          Store.saveChat(activeChat).catch(err => console.error('[ChatManager] Failed to persist stream checkpoint:', err));
        }
      },
      onDone: ({ content, reasoning, usage }, aborted) => {
        clearTimeout(streamGuard);
        if (aborted && !assistantMsg.content && !assistantMsg.reasoningContent) {
          activeChat.messages = activeChat.messages.filter(m => m.id !== assistantMsg.id);
        }
        sending = false;
        abortFn = null;
        streamingChat = null;
        assistantMsg.timestamp = Date.now();
        if (usage) {
          assistantMsg.promptTokens = usage.prompt_tokens || 0;
          assistantMsg.completionTokens = usage.completion_tokens || 0;
          activeChat.totalPromptTokens = (activeChat.totalPromptTokens || 0) + (usage.prompt_tokens || 0);
          activeChat.totalCompletionTokens = (activeChat.totalCompletionTokens || 0) + (usage.completion_tokens || 0);
        }
        // Flush any last pending streamed chunk synchronously so the DOM
        // matches before the final render runs.
        if (assistantMsg.content || assistantMsg.reasoningContent) {
          UI.finalizeStreamingMessage();
        }
        Store.saveChat(activeChat).catch(err => {
          console.error('[ChatManager] Failed to save streamed response:', err);
          UI.showToast('Failed to save streamed response', 'error');
        });
        // Enhance the finished message (code copy buttons, syntax highlighting,
        // mermaid/chart rendering) — the fast append path skips re-enhancement.
        if (assistantMsg.content || assistantMsg.reasoningContent) {
          const doneEl = document.querySelector(`.message[data-msg-id="${Utils.escapeCss(assistantMsg.id)}"]`);
          if (doneEl) {
            requestAnimationFrame(() => UI.enhanceRenderedContent(doneEl));
          }
        }
        UI.updateUsageStats();
        notify();
      },
      onError: (errMsg) => {
        clearTimeout(streamGuard);
        sending = false;
        abortFn = null;
        streamingChat = null;
        // Preserve any content already streamed; append the error rather than
        // discarding a partially-completed response.
        assistantMsg.content = assistantMsg.content
          ? assistantMsg.content + `\n\n*Error: ${errMsg}*`
          : `*Error: ${errMsg}*`;
        Store.saveChat(activeChat).catch(err => {
          console.error('[ChatManager] Failed to save error state:', err);
        });
        UI.updateUsageStats();
        notify();
        UI.showToast(`API error: ${errMsg}`, 'error');
      }
    });
  }

  /* ── Internal: send the current message list to the API ── */
  async function _sendFromCurrent() {
    if (!currentChat) { sending = false; return; }
    const config = Store.loadConfig();
    if (!config.endpoint || !config.model) {
      sending = false;
      UI.showToast('Please configure an API endpoint first.', 'error');
      return;
    }
    const settings = currentChat.settings || {};
    const apiMessages = buildApiMessages(currentChat, settings);
    await _sendApiRequest(apiMessages);
  }

  /* ── Toggle pin state on a message ── */
  async function togglePin(msgId) {
    if (!currentChat) return;
    const snapshot = Utils.deepClone(currentChat);
    const msg = currentChat.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.pinned = !msg.pinned;
    try {
      await Store.saveChat(currentChat, { skipTimestamp: true });
    } catch (err) {
      currentChat = snapshot;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save pin state', 'error');
      return;
    }
    UI.togglePinInDOM(msgId);
    notify(EVENTS.PIN);
  }

  /* ── Delete a chat by ID (not necessarily the current one) ── */
  async function deleteChatById(id) {
    await Store.deleteChat(id);
    if (currentChat && currentChat.id === id) {
      currentChat = null;
    }
    notify();
  }

  /* ── Rename current chat ── */
  async function renameCurrentChat(newTitle) {
    if (!currentChat || !newTitle.trim()) return;
    const oldTitle = currentChat.title;
    currentChat.title = newTitle.trim();
    try {
      await Store.renameChat(currentChat.id, newTitle.trim());
    } catch (err) {
      currentChat.title = oldTitle;
      console.error('[ChatManager] Rename failed, reverted:', err);
      UI.showToast('Failed to rename chat', 'error');
      return;
    }
    notify(EVENTS.RENAME);
  }

  /* ── Rename a chat by ID ── */
  async function renameChatById(id, newTitle) {
    if (!id || !newTitle.trim()) return;
    const title = newTitle.trim();
    const oldTitle = currentChat && currentChat.id === id ? currentChat.title : null;
    if (currentChat && currentChat.id === id) {
      currentChat.title = title;
    }
    try {
      await Store.renameChat(id, title);
    } catch (err) {
      if (oldTitle !== null) {
        currentChat.title = oldTitle;
      }
      console.error('[ChatManager] Rename failed, reverted:', err);
      UI.showToast('Failed to rename chat', 'error');
      notify(EVENTS.RENAME);
      return;
    }
    notify(EVENTS.RENAME);
  }

  /* ── Stop streaming ── */
  function stopGeneration() {
    if (abortFn) {
      abortFn.abort();
      abortFn = null;
    }
  }

  function abortStreaming() {
    if (abortFn) {
      abortFn.abort();
      abortFn = null;
    }
    streamingChat = null;
  }

  function isCurrentlyStreaming(chatId) {
    return streamingChat !== null && (!chatId || streamingChat.id === chatId);
  }

  /* ── Delete current chat ── */
  async function deleteCurrentChat() {
    if (!currentChat) return;
    await Store.deleteChat(currentChat.id);
    currentChat = null;
    notify();
  }

  /* ── Clear messages in current chat ── */
  async function clearMessages() {
    if (!currentChat) return;
    const snapshot = Utils.deepClone(currentChat);
    currentChat.messages = [];
    currentChat.updatedAt = Date.now();
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to clear messages', 'error');
      return;
    }
    notify();
  }

  /* ── Regenerate a specific assistant message ── */
  async function regenerateResponse(msgId) {
    if (!currentChat) return;
    if (streamingChat?.id === currentChat.id) return;
    if (sending) return;
    sending = true;

    const msgIndex = currentChat.messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) { sending = false; return; }
    if (currentChat.messages[msgIndex].role !== 'assistant') { sending = false; return; }

    const snapshot = Utils.deepClone(currentChat);
    // Remove this assistant message and all messages after it
    currentChat.messages = currentChat.messages.slice(0, msgIndex);
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      sending = false;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save before regeneration', 'error');
      return;
    }
    notify();

    // Resend the conversation
    await _sendFromCurrent();
  }

  /* ── Update settings for current chat (also saves to Store) ── */
  async function updateSettings(settings) {
    if (!currentChat) return;
    const snapshot = Utils.deepClone(currentChat);
    currentChat.settings = Object.assign({}, currentChat.settings, settings);
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save settings', 'error');
      return;
    }
    notify();
  }

  /* ── Fork a conversation at a specific message ── */
  async function forkChat(msgId) {
    if (!currentChat) return;
    const msgIndex = currentChat.messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;

    const newChat = {
      id: Utils.generateId(),
      title: currentChat.title + ' (fork)',
      model: currentChat.model,
      messages: currentChat.messages.slice(0, msgIndex + 1).map(m => Utils.deepClone(m)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: Utils.deepClone(currentChat.settings || {})
    };
    await Store.saveChat(newChat);
    currentChat = newChat;
    notify();
  }

  /* ── Tag management (delegates to Store) ── */
  async function addTagToChat(chatId, tag) {
    await Store.addTag(chatId, tag);
  }

  async function removeTagFromChat(chatId, tag) {
    await Store.removeTag(chatId, tag);
  }

  /* ── Update chat model on the live chat object and persist ── */
  async function setChatModel(model) {
    if (!currentChat) return;
    const snapshot = Utils.deepClone(currentChat);
    currentChat.model = model;
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      currentChat = snapshot;
      console.error('[ChatManager] Save failed, reverted:', err);
      UI.showToast('Failed to save model change', 'error');
      return;
    }
    notify(EVENTS.MODEL);
  }

  /* ── Persist the current in-memory chat (best-effort, e.g. on unload) ── */
  async function persistCurrentState() {
    if (!currentChat || !currentChat.messages || currentChat.messages.length === 0) return;
    try {
      await Store.saveChat(currentChat);
    } catch (err) {
      console.error('[ChatManager] Failed to persist current state:', err);
    }
  }

    return {
    createChat, loadChat, getCurrentChat, sendMessage, editAndResend, regenerateResponse, togglePin, deleteChatById, renameCurrentChat, renameChatById, forkChat,
    stopGeneration, abortStreaming,
    deleteCurrentChat, clearMessages, updateSettings, isCurrentlyStreaming, onChange,
    addTagToChat, removeTagFromChat, setChatModel, persistCurrentState
  };
})();

// Explicit global (rather than relying on classic-script implicit scope sharing).
window.ChatManager = ChatManager;
