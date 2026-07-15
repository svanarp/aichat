/* ═══════════════════════════════════════════════
   export.js — Export, import, and backup
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  function exportChatJSON() {
    const chat = ChatManager.getCurrentChat();
    if (!chat) { UI.showToast('No chat to export', 'error'); return; }
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${chat.title.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    UI.showToast('Exported as JSON', 'success');
  }

  function exportChatMarkdown() {
    const chat = ChatManager.getCurrentChat();
    if (!chat) { UI.showToast('No chat to export', 'error'); return; }
    let md = `# ${chat.title}\n\n`;
    md += `- **Model:** ${chat.model || 'Unknown'}\n`;
    md += `- **Date:** ${new Date(chat.createdAt).toLocaleString()}\n`;
    md += `- **Messages:** ${chat.messages.length}\n\n---\n\n`;
    for (const msg of chat.messages) {
      const role = msg.role === 'user' ? '**You**' : '**AI**';
      md += `${role}:\n${msg.content}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, `${chat.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`);
    UI.showToast('Exported as Markdown', 'success');
  }

  function exportChatHTML() {
    const chat = ChatManager.getCurrentChat();
    if (!chat) { UI.showToast('No chat to export', 'error'); return; }
    const messagesHtml = chat.messages.map(m => {
      const role = m.role === 'user' ? 'You' : 'AI';
      const safeContent = Utils.escapeHtml(m.content || '').replace(/\n/g, '<br>');
      return `<div style="margin-bottom:16px;padding:12px 16px;border-left:3px solid ${m.role === 'user' ? '#7c9eb2' : '#d4a5b0'};background:${m.role === 'user' ? '#e8f4f8' : '#f8f0f2'};border-radius:4px;"><strong style="font-size:0.85rem;color:#555;">${role}</strong><div style="margin-top:4px;line-height:1.6;">${safeContent}</div></div>`;
    }).join('\n');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${Utils.escapeHtml(chat.title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6;}h1{border-bottom:1px solid #ddd;padding-bottom:8px;}</style></head><body><h1>${Utils.escapeHtml(chat.title)}</h1><p style="color:#888;font-size:0.85rem;">Exported from Chai on ${new Date().toLocaleString()}</p>${messagesHtml}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${chat.title.replace(/[^a-zA-Z0-9]/g, '_')}.html`);
    UI.showToast('Exported as HTML', 'success');
  }

  function importChat() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.messages || !Array.isArray(data.messages) || !data.messages.length) {
          throw new Error('Invalid chat format: missing or empty messages array');
        }
        for (const msg of data.messages) {
          if (!msg.role || !['user', 'assistant'].includes(msg.role)) {
            throw new Error('Invalid chat format: each message must have a valid role (user/assistant)');
          }
          if (typeof msg.content !== 'string') {
            throw new Error('Invalid chat format: each message must have string content');
          }
        }
        data.id = data.id || Utils.generateId();
        data.title = data.title || 'Imported Chat';
        data.createdAt = data.createdAt || Date.now();
        data.updatedAt = Date.now();
        for (const msg of data.messages) {
          delete msg.streamSpeed;
        }
        await Store.saveChat(data);
        UI.showToast('Chat imported successfully', 'success');
        await ChatManager.loadChat(data.id);
      } catch (err) {
        UI.showToast(`Import failed: ${err.message}`, 'error');
      }
    });
    input.click();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function backupAllData() {
    UI.showConfirm(
      'The backup file will include your provider profiles, including any saved API keys, in plain text. Only share this file with people you trust. Continue?',
      () => _downloadBackup()
    );
  }

  async function _downloadBackup() {
    try {
      const [chats, profiles, customRoles, usage, hiddenDefaults, folders, collapsedFolders] = await Promise.all([
        Store.getAllChatsFull(),
        Promise.resolve(Store.loadProfiles()),
        Promise.resolve(Store.loadCustomRoles()),
        Promise.resolve(Store.loadUsage()),
        Promise.resolve(Store.loadHiddenDefaults()),
        Promise.resolve(Store.loadFolders()),
        Promise.resolve(Store.loadCollapsedFolders())
      ]);
      const backup = {
        version: 3,
        exportedAt: new Date().toISOString(),
        chats,
        folders,
        collapsedFolders,
        profiles,
        activeProfileId: Store.getActiveProfileId(),
        customRoles,
        usage,
        hiddenDefaults,
        theme: localStorage.getItem('chai-theme') || 'default',
        mode: localStorage.getItem('chai-mode') || 'light'
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `aichat-backup-${new Date().toISOString().slice(0, 10)}.json`);
      UI.showToast('Backup downloaded', 'success');
    } catch (err) {
      UI.showToast('Backup failed: ' + err.message, 'error');
    }
  }

  async function restoreAllData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version || !data.chats) {
          throw new Error('Invalid backup file: missing version or chats');
        }

        UI.showConfirm(
          'This will overwrite ALL existing chats, profiles, personas, and settings. Are you sure?',
          async () => {
            try {
              if (data.profiles) {
                Store.saveProfiles(data.profiles);
                if (data.activeProfileId) {
                  Store.setActiveProfileId(data.activeProfileId);
                }
              }
              if (data.customRoles) {
                Store.saveCustomRoles(data.customRoles);
              }
              if (data.hiddenDefaults) {
                localStorage.setItem('chai-hidden-defaults', JSON.stringify(data.hiddenDefaults));
              }
              if (data.usage) {
                Store.saveUsage(data.usage);
              }
              Store.saveFolders(Array.isArray(data.folders) ? data.folders : []);
              if (data.collapsedFolders) {
                Store.saveCollapsedFolders(Array.isArray(data.collapsedFolders) ? data.collapsedFolders : []);
              }
              if (data.theme) {
                UI.setTheme(data.theme);
                if (data.mode) UI.setMode(data.mode);
              }
              if (data.chats) {
                await Store.replaceAllChats(data.chats);
              }

              UI.showToast('Restore complete! Reloading…', 'success');
              setTimeout(() => location.reload(), 1500);
            } catch (err) {
              UI.showToast('Restore failed: ' + err.message, 'error');
            }
          }
        );
      } catch (err) {
        UI.showToast('Restore failed: ' + err.message, 'error');
      }
    });
    input.click();
  }

  Object.assign(UI, {
    exportChatJSON,
    exportChatMarkdown,
    exportChatHTML,
    importChat,
    downloadBlob,
    backupAllData,
    restoreAllData
  });
})();
