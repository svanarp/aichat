/* ═══════════════════════════════════════════════
   app.js — Application bootstrap & event wiring
   ═══════════════════════════════════════════════ */

const App = (() => {
  'use strict';

  /* ── State ── */
  let currentChatId = null;
  let currentSort = 'updatedAt-desc';
  const LEGACY_DRAFT_KEY = 'chai-draft';

  /* ── Initialize ── */
  async function init() {
    // Initialize mermaid (startOnLoad: false so we control when to render)
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ startOnLoad: false, theme: 'default' });
    }

    // Remove loading spinner
    const spinner = document.querySelector('.loading-spinner');
    if (spinner) spinner.remove();

    // Initialize crypto for API key encryption
    await Store.initCrypto();

    // Run one-time legacy migrations before loading config/chats
    await Store.migrateLegacyConfig();
    await Store.migrateLegacyChatStorage();

    // Render the initial state
    const config = Store.loadConfig();
    UI.renderHeader(config.model);

    // Load chat list
    await refreshSidebar();

    // Subscribe to chat state changes (BEFORE loading a chat so notify() fires)
    let renderPending = false;
    ChatManager.onChange((eventType) => {
      if (eventType === 'pin') {
        // DOM already toggled by the delegate click handler
        return;
      }
      if (eventType === 'rename') {
        refreshSidebar();
        return;
      }
      if (eventType === 'model') {
        const chat = ChatManager.getCurrentChat();
        UI.renderHeader(chat ? chat.model : '');
        refreshSidebar();
        return;
      }
      // Batch full renders to avoid cascading from rapid sequential saves
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        renderPending = false;
        const chat = ChatManager.getCurrentChat();
        if (chat) {
          UI.renderMessages(chat);
          currentChatId = chat.id;
          UI.renderHeader(chat.model || Store.loadConfig().model);
          UI.renderRightSidebar();
        } else {
          UI.renderEmpty();
          currentChatId = null;
        }
        refreshSidebar();
        updateSendButton();
      });
    });

    // Wire up events before loading data
    wireEvents();

    // Initialize right sidebar
    UI.initRightSidebar();

    // Initialize in-chat search
    UI.initChatSearch();

    // Init scroll-to-bottom button
    UI.initScrollBottomBtn();

    // Always start with a fresh chat — reuse an existing empty one if available
    const chats = await Store.listChats();
    const existingEmpty = chats.find(c => c.preview === '');
    if (existingEmpty) {
      await ChatManager.loadChat(existingEmpty.id);
      currentChatId = existingEmpty.id;
    } else {
      await startNewChat();
    }

    restoreDraft();
  }

  /* ── Start a new chat ── */
  async function startNewChat() {
    const config = Store.loadConfig();
    const chat = await ChatManager.createChat(config.model);
    currentChatId = chat.id;
    restoreDraft();
    document.getElementById('message-input').focus();
  }

  /* ── Refresh sidebar (serialized to prevent interleaving) ── */
  let _sidebarPromise = Promise.resolve();
  async function refreshSidebar() {
    const parts = currentSort.split('-');
    const sortBy = parts[0];
    const sortDir = parts[1];
    const next = (async () => {
      await _sidebarPromise;
      const chats = await Store.listChats({ sortBy, sortDir });
      UI.renderSidebar(chats, currentChatId);
    })();
    _sidebarPromise = next.catch(() => {});
    return next;
  }

  /* ── Wire DOM events ── */
  function wireEvents() {
    // New chat button
    document.getElementById('new-chat-btn').addEventListener('click', async () => {
      // Save draft
      saveDraft();
      await startNewChat();
    });

    // Sidebar chat list (delegated)
    document.getElementById('chat-list').addEventListener('click', async (e) => {
      // Delete button
      const delBtn = e.target.closest('.chat-delete-btn');
      if (delBtn) {
        const chatId = delBtn.dataset.chatId;
        if (!chatId) return;
        e.stopPropagation();
        UI.showConfirm('Delete this conversation?', async () => {
          const wasActive = chatId === currentChatId;
          await ChatManager.deleteChatById(chatId);
          if (wasActive) {
            // Switch to next available chat or create new
            const remaining = await Store.listChats();
            if (remaining.length > 0) {
              await ChatManager.loadChat(remaining[0].id);
              currentChatId = remaining[0].id;
              restoreDraft();
            } else {
              await startNewChat();
            }
          }
        });
        return;
      }

      // Select chat
      const item = e.target.closest('.chat-list-item');
      if (!item) return;
      const chatId = item.dataset.chatId;
      if (!chatId || chatId === currentChatId) return;
      saveDraft();
      await ChatManager.loadChat(chatId);
      currentChatId = chatId;
      restoreDraft();
    });

    // Keyboard navigation for chat list (arrow keys)
    document.getElementById('chat-list').addEventListener('keydown', (e) => {
      const items = [...document.querySelectorAll('#chat-list .chat-list-item')];
      if (items.length === 0) return;
      const focused = document.activeElement;
      const currentIdx = items.indexOf(focused);
      if (currentIdx === -1) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[(currentIdx + 1) % items.length];
        next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[(currentIdx - 1 + items.length) % items.length];
        prev.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focused.click();
      }
    });

    // Double-click chat title to rename inline
    document.getElementById('chat-list').addEventListener('dblclick', (e) => {
      const titleEl = e.target.closest('.chat-title');
      if (!titleEl) return;
      const item = titleEl.closest('.chat-list-item');
      if (!item) return;
      const chatId = item.dataset.chatId;
      const currentName = titleEl.textContent;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'chat-rename-input';
      input.value = currentName;
      input.setAttribute('aria-label', 'Rename chat');
      titleEl.replaceWith(input);
      input.focus();
      input.select();

      function finishRename() {
        const newName = input.value.trim() || currentName;
        const newTitleEl = document.createElement('div');
        newTitleEl.className = 'chat-title';
        newTitleEl.textContent = newName;
        input.replaceWith(newTitleEl);
        if (newName !== currentName) {
          ChatManager.renameChatById(chatId, newName);
        }
      }

      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); input.value = currentName; input.blur(); }
      });
    });

    // Enable search and wire up
    const searchInput = document.querySelector('#sidebar-search input');
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = 'Search conversations…';
      searchInput.addEventListener('input', Utils.debounce(async (e) => {
        try {
          const q = e.target.value.trim();
          if (!q) {
            await refreshSidebar();
            return;
          }
          const results = await Store.searchChats(q);
          UI.renderSidebar(results, currentChatId);
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 300));
    }

    // Sort dropdown
    document.getElementById('sort-select').addEventListener('change', async (e) => {
      currentSort = e.target.value;
      await refreshSidebar();
    });

    // Folder: add new
    document.getElementById('chat-list').addEventListener('click', (e) => {
      const addBtn = e.target.closest('#add-folder-btn');
      if (!addBtn) return;
      e.stopPropagation();
      UI.showPrompt('Folder name', '', async (name) => {
        if (name && name.trim()) {
          Store.addFolder(name.trim());
          await refreshSidebar();
        }
      }, { title: 'Create Folder', confirmText: 'Create', placeholder: 'e.g. Work, Research' });
    });

    // Folder: rename
    document.getElementById('chat-list').addEventListener('click', (e) => {
      const renameBtn = e.target.closest('.chat-folder-rename-btn');
      if (!renameBtn) return;
      e.stopPropagation();
      const header = renameBtn.closest('.chat-folder-header');
      if (!header) return;
      const folderEl = header.closest('.chat-folder');
      if (!folderEl) return;
      const fid = folderEl.dataset.folderId;
      const nameEl = header.querySelector('.chat-folder-name');
      if (!fid || !nameEl) return;
      UI.showPrompt('Rename folder', nameEl.textContent || '', async (name) => {
        if (name && name.trim() && name.trim() !== nameEl.textContent) {
          Store.renameFolder(fid, name.trim());
          await refreshSidebar();
        }
      }, { title: 'Rename Folder', confirmText: 'Save' });
    });

    // Folder: delete
    document.getElementById('chat-list').addEventListener('click', (e) => {
      const delBtn = e.target.closest('.chat-folder-delete-btn');
      if (!delBtn) return;
      e.stopPropagation();
      const folderEl = delBtn.closest('.chat-folder');
      if (!folderEl) return;
      const fid = folderEl.dataset.folderId;
      if (!fid) return;
      UI.showConfirm('Delete this folder? Chats will be moved to Uncategorized.', async () => {
        await Store.deleteFolder(fid);
        await refreshSidebar();
      });
    });

    // Folder: toggle collapse
    document.getElementById('chat-list').addEventListener('click', (e) => {
      const header = e.target.closest('.chat-folder-header');
      if (!header) return;
      // Ignore clicks on buttons inside the header
      if (e.target.closest('.chat-folder-rename-btn, .chat-folder-delete-btn, .chat-folder-add-btn')) return;
      const folderEl = header.closest('.chat-folder');
      if (!folderEl) return;
      const folderId = folderEl.dataset.folderId;
      const collapsed = Store.toggleFolderCollapsed(folderId);
      folderEl.classList.toggle('collapsed', collapsed);
    });

    // Drag-and-drop for chat folder assignment
    document.getElementById('chat-list').addEventListener('dragstart', (e) => {
      const item = e.target.closest('.chat-list-item');
      if (!item) return;
      e.dataTransfer.setData('text/plain', item.dataset.chatId);
      e.dataTransfer.effectAllowed = 'move';
    });
    document.getElementById('chat-list').addEventListener('dragover', (e) => {
      const folderEl = e.target.closest('.chat-folder');
      if (!folderEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      folderEl.classList.add('drag-over');
    });
    document.getElementById('chat-list').addEventListener('dragleave', (e) => {
      const folderEl = e.target.closest('.chat-folder');
      if (!folderEl) return;
      if (folderEl.contains(e.relatedTarget)) return;
      folderEl.classList.remove('drag-over');
    });
    document.getElementById('chat-list').addEventListener('drop', async (e) => {
      const folderEl = e.target.closest('.chat-folder');
      if (!folderEl) return;
      e.preventDefault();
      folderEl.classList.remove('drag-over');
      const chatId = e.dataTransfer.getData('text/plain');
      if (!chatId) return;
      const folderId = folderEl ? folderEl.dataset.folderId : '';
      if (folderId === Store.UNCATEGORIZED_FOLDER_ID) {
        await Store.setChatFolder(chatId, null);
      } else if (folderId) {
        await Store.setChatFolder(chatId, folderId);
      }
      await refreshSidebar();
    });

    // Sidebar toggle (collapse/expand on desktop, overlay on mobile)
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      const collapsedTitle = document.getElementById('sidebar-title-collapsed');
      const isNarrow = window.innerWidth <= 1024;

      if (isNarrow) {
        sidebar.classList.remove('collapsed');
        sidebar.classList.toggle('open');
      } else {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        collapsedTitle.classList.toggle('hidden', !isCollapsed);
        try {
          localStorage.setItem('chai-sidebar-collapsed', isCollapsed ? '1' : '0');
        } catch (err) {
          console.error('[App] Failed to save sidebar state:', err);
        }
      }
    }

    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

    // Restore sidebar collapse state
    if (localStorage.getItem('chai-sidebar-collapsed') === '1') {
      const sidebar = document.getElementById('sidebar');
      if (window.innerWidth > 1024) {
        sidebar.classList.add('collapsed');
        document.getElementById('sidebar-title-collapsed').classList.remove('hidden');
      }
      sidebar.classList.remove('open');
    }

    // Search sidebar button
    document.getElementById('search-sidebar-btn').addEventListener('click', () => {
      const searchInput = document.querySelector('#sidebar-search input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    });

    // Click on app title to refresh current UI state
    document.getElementById('sidebar-title-collapsed').addEventListener('click', async () => {
      await refreshSidebar();
      UI.renderRightSidebar();
    });
    document.querySelector('#sidebar-header h1').addEventListener('click', async () => {
      await refreshSidebar();
      UI.renderRightSidebar();
    });



    // Send message
    document.getElementById('send-btn').addEventListener('click', handleSend);
    document.getElementById('message-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-resize textarea and stats (merged below)

    // Copy conversation button
    document.getElementById('copy-chat-btn').addEventListener('click', () => {
      UI.copyConversationToClipboard();
    });

    // Message actions (delegated — edit, copy, pin)
    document.getElementById('chat-messages').addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.msg-action-btn');
      if (!actionBtn) return;
      const msgEl = actionBtn.closest('.message');
      if (!msgEl) return;
      const msgId = msgEl.dataset.msgId;
      const action = actionBtn.dataset.action;

      if (action === 'edit') {
        UI.enterEditMode(msgId);
      } else if (action === 'copy') {
        UI.copyMessageToClipboard(msgId);
      } else if (action === 'pin') {
        ChatManager.togglePin(msgId);
      } else if (action === 'regenerate') {
        ChatManager.regenerateResponse(msgId);
      } else if (action === 'fork') {
        ChatManager.forkChat(msgId);
      }
    });

    // Edit save/cancel (delegated — buttons inside edit mode)
    document.getElementById('chat-messages').addEventListener('click', (e) => {
      const saveBtn = e.target.closest('.btn-edit-save');
      const cancelBtn = e.target.closest('.btn-edit-cancel');
      if (saveBtn) {
        const msgId = saveBtn.dataset.editId;
        UI.saveEdit(msgId);
      } else if (cancelBtn) {
        const msgId = cancelBtn.dataset.editId;
        UI.cancelEdit(msgId);
      }
    });

    // Input stats update
    document.getElementById('message-input').addEventListener('input', (e) => {
      UI.autoResizeTextarea(e.target);
      autoSaveDraft();
      UI.updateInputStats(e.target.value);
    });

    // Clear conversation button
    document.getElementById('clear-btn').addEventListener('click', () => {
      const chat = ChatManager.getCurrentChat();
      if (!chat || chat.messages.length === 0) return;
      UI.showConfirm('Clear all messages in this conversation?', async () => {
        await ChatManager.clearMessages();
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+N or Cmd+N: new chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        document.getElementById('new-chat-btn').click();
      }
      // Ctrl+, or Cmd+, : open config
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        UI.openConfigModal();
      }
      // Escape: close any open modal overlay, then chat search
      if (e.key === 'Escape') {
        const overlays = document.querySelectorAll('.modal-overlay');
        if (overlays.length > 0) {
          e.preventDefault();
          overlays[overlays.length - 1].remove();
          return;
        }
        const searchBar = document.getElementById('chat-search-bar');
        if (searchBar && !searchBar.classList.contains('hidden')) {
          e.preventDefault();
          UI.closeChatSearch();
        }
      }
      // Ctrl+F or Cmd+F: in-chat search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const bar = document.getElementById('chat-search-bar');
        const input = document.getElementById('chat-search-input');
        if (bar) {
          bar.classList.remove('hidden');
          if (input) { input.focus(); input.select(); }
        }
      }
      // Ctrl+Shift+F or Cmd+Shift+F: focus sidebar search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        const searchInput = document.querySelector('#sidebar-search input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
      // / (slash): focus message input when not already focused
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement !== document.getElementById('message-input')) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          document.getElementById('message-input').focus();
        }
      }
    });

    // Handle draft auto-save on page unload
    window.addEventListener('beforeunload', () => {
      saveDraft();
      ChatManager.stopGeneration();
    });

    // Disable CSS transitions during window resize to prevent layout thrashing
    let _resizeTimer;
    window.addEventListener('resize', () => {
      document.body.classList.add('is-resizing');
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => document.body.classList.remove('is-resizing'), 150);
    });
  }

  /* ── Update send button text based on streaming state ── */
  function updateSendButton() {
    const btn = document.getElementById('send-btn');
    if (ChatManager.isCurrentlyStreaming(currentChatId)) {
      btn.innerHTML = '<span>Stop</span> ■';
      btn.style.background = 'var(--color-danger)';
    } else {
      btn.innerHTML = '<span>Send</span> ➤';
      btn.style.background = '';
    }
  }

  /* ── Send message handler ── */
  async function handleSend() {
    if (ChatManager.isCurrentlyStreaming(currentChatId)) {
      // If streaming, stop instead
      ChatManager.stopGeneration();
      updateSendButton();
      return;
    }

    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    // Ensure we have a current chat before sending
    if (!currentChatId) {
      await startNewChat();
    }

    await ChatManager.sendMessage(text);

    input.value = '';
    UI.autoResizeTextarea(input);
    UI.updateInputStats('');
    clearDraft();
  }

  /* ── Draft management ── */
  let draftTimer = null;

  function autoSaveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  function saveDraft() {
    if (!currentChatId) return;
    const val = document.getElementById('message-input').value;
    const key = getDraftKey(currentChatId);
    try {
      if (val) {
        localStorage.setItem(key, val);
      } else {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.error('[App] Failed to save draft:', err);
    }
  }

  function restoreDraft() {
    const input = document.getElementById('message-input');
    if (!input) return;

    let draft = currentChatId ? localStorage.getItem(getDraftKey(currentChatId)) : '';
    const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!draft && legacyDraft && currentChatId) {
      draft = legacyDraft;
      try {
        localStorage.setItem(getDraftKey(currentChatId), legacyDraft);
        localStorage.removeItem(LEGACY_DRAFT_KEY);
      } catch (err) {
        console.error('[App] Failed to migrate legacy draft:', err);
      }
    }

    input.value = draft || '';
    UI.autoResizeTextarea(input);
    UI.updateInputStats(input.value);
  }

  function clearDraft() {
    if (currentChatId) {
      localStorage.removeItem(getDraftKey(currentChatId));
    }
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  }

  function getDraftKey(chatId) {
    return `chai-draft:${chatId}`;
  }

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', init);

  return { init };
})();

// Explicit global (rather than relying on classic-script implicit scope sharing).
window.App = App;
