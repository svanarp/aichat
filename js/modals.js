/* ═══════════════════════════════════════════════
   modals.js — Modal dialogs (config, confirm, roles)
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  let configModalEl = null;
  let _prevFocus = null;

  /* ── Build profile list HTML (expandable items) ── */
  function buildProfileListHtml() {
    const profiles = Store.loadProfiles();
    const activeId = Store.getActiveProfileId();
    let html = '<div class="profile-list">';
    if (profiles.length === 0) {
      html += '<p style="color:var(--color-text-muted);text-align:center;padding:16px;">No profiles configured</p>';
    } else {
      for (const p of profiles) {
        const isActive = p.id === activeId;
        html += `
          <div class="profile-item${isActive ? ' active' : ''}" data-profile-id="${Utils.escapeHtml(p.id)}">
            <div class="profile-header" tabindex="0" role="button" data-action="toggle-profile">
              <span class="expand-indicator">▶</span>
              <div class="profile-info">
                <div class="profile-name">${Utils.escapeHtml(p.name || 'Unnamed')}${isActive ? ' <span class="active-badge">(active)</span>' : ''}</div>
                <div class="profile-detail">${Utils.escapeHtml(p.model)} · ${Utils.escapeHtml(p.endpoint)}</div>
              </div>
              <div class="profile-actions">
                <button class="btn-ghost" data-action="activate-profile" data-profile-id="${Utils.escapeHtml(p.id)}" title="Set active" style="font-size:0.8rem;padding:3px 6px;">✓</button>
                <button class="btn-ghost" data-action="delete-profile" data-profile-id="${Utils.escapeHtml(p.id)}" title="Delete" style="font-size:0.8rem;padding:3px 6px;">🗑️</button>
              </div>
            </div>
            <div class="profile-expanded" style="display:none;">
              <div class="form-group">
                <label>Name</label>
                <input type="text" class="pe-name" value="${Utils.escapeHtml(p.name || '')}" placeholder="My Profile" />
              </div>
              <div class="form-group">
                <label>Endpoint</label>
                <input type="url" class="pe-endpoint" value="${Utils.escapeHtml(p.endpoint || '')}" placeholder="https://api.openai.com/v1" />
              </div>
              <div class="form-group">
                <label>API Key</label>
                <input type="password" class="pe-key" value="${Utils.escapeHtml(p.apiKey || '')}" />
                <div class="hint">Saved locally. Use a limited-scope key.</div>
              </div>
              <div class="form-group">
                <label>Model</label>
                <div class="model-select-row">
                  <input type="text" class="pe-model" value="${Utils.escapeHtml(p.model || '')}" placeholder="gpt-4, llama3, etc." list="models-${Utils.escapeHtml(p.id)}" />
                  <datalist id="models-${Utils.escapeHtml(p.id)}"></datalist>
                  <button class="btn btn-secondary" data-action="pe-fetch-models" data-profile-id="${Utils.escapeHtml(p.id)}" style="font-size:0.78rem;padding:6px 10px;">↻ Fetch</button>
                </div>
              </div>
              <div class="inline-actions">
                <button class="btn btn-primary" data-action="save-profile-inline" data-profile-id="${Utils.escapeHtml(p.id)}" style="flex:1;">Save</button>
                <button class="btn btn-secondary" data-action="test-connection-inline" data-profile-id="${Utils.escapeHtml(p.id)}" style="font-size:0.82rem;">Test</button>
                <span class="inline-result"></span>
              </div>
            </div>
          </div>`;
      }
    }
    html += '</div>';
    return html;
  }

  /* ── Collapse all expanded profiles ── */
  function collapseAllProfiles() {
    document.querySelectorAll('.profile-expanded[style*="display: block"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.profile-header.expanded').forEach(el => {
      el.classList.remove('expanded');
    });
  }

  function trapFocus(overlay) {
    const focusable = overlay.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    overlay.addEventListener('keydown', function trap(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    setTimeout(() => first.focus(), 50);
  }

  function openConfigModal() {
    _prevFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Manage Profiles');

    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <h2>Provider Profiles</h2>
          <button class="modal-close" data-action="close-config" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${buildProfileListHtml()}
          <hr>
          <button class="btn btn-secondary" id="btn-add-profile" style="width:100%;padding:8px;font-size:0.85rem;">＋ Add Profile</button>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="close-config">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    configModalEl = overlay;
    trapFocus(overlay);

    /* ── Toggle profile expand ── */
    overlay.addEventListener('click', (e) => {
      const header = e.target.closest('[data-action="toggle-profile"]');
      if (!header) return;
      const item = header.closest('.profile-item');
      if (!item) return;
      // Ignore clicks on buttons inside the header
      if (e.target.closest('.btn-ghost')) return;
      const expanded = item.querySelector('.profile-expanded');
      const isNowVisible = expanded.style.display !== 'none';
      collapseAllProfiles();
      if (!isNowVisible) {
        expanded.style.display = 'block';
        header.classList.add('expanded');
      }
    });

    /* ── Close ── */
    overlay.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'close-config' || e.target === overlay) {
        closeConfigModal();
      }
    });

    /* ── Activate profile ── */
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="activate-profile"]');
      if (!btn) return;
      const pid = btn.dataset.profileId;
      if (!pid) return;
      e.stopPropagation();
      Store.setActiveProfileId(pid);
      const activeProfile = Store.getActiveProfile();
      ChatManager.setChatModel('');
      UI.renderHeader('');
      UI.showToast('Profile activated: ' + (activeProfile ? activeProfile.name : ''), 'success');
      refreshProfileList(overlay);
    });

    /* ── Delete profile ── */
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="delete-profile"]');
      if (!btn) return;
      e.stopPropagation();
      const pid = btn.dataset.profileId;
      const all = Store.loadProfiles();
      const idx = all.findIndex(p => p.id === pid);
      if (idx === -1) return;
      all.splice(idx, 1);
      const wasActive = pid === Store.getActiveProfileId();
      await Store.saveProfiles(all);
      if (wasActive) {
        if (all.length > 0) {
          Store.setActiveProfileId(all[0].id);
        } else {
          Store.setActiveProfileId(null);
        }
      }
      const profile = Store.getActiveProfile();
      const model = profile ? (profile.model || '') : '';
      if (wasActive) {
        ChatManager.setChatModel(model);
      }
      UI.renderHeader(model);
      UI.showToast('Profile deleted', 'info');
      refreshProfileList(overlay);
    });

    /* ── Save profile inline ── */
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="save-profile-inline"]');
      if (!btn) return;
      const pid = btn.dataset.profileId;
      const item = btn.closest('.profile-item');
      if (!item || !pid) return;
      const name = item.querySelector('.pe-name').value.trim();
      const endpoint = item.querySelector('.pe-endpoint').value.trim();
      const apiKey = item.querySelector('.pe-key').value.trim();
      const model = item.querySelector('.pe-model').value.trim();

      if (!endpoint) {
        UI.showToast('Endpoint is required', 'error');
        item.querySelector('.pe-endpoint').focus();
        return;
      }
      if (!model) {
        UI.showToast('Model name is required', 'error');
        item.querySelector('.pe-model').focus();
        return;
      }

      const all = Store.loadProfiles();
      const p = all.find(pr => pr.id === pid);
      if (p) {
        p.name = name || 'Unnamed';
        p.endpoint = endpoint;
        p.apiKey = apiKey;
        p.model = model;
        await Store.saveProfiles(all);
      }
      const profile = Store.getActiveProfile();
      UI.renderHeader(profile ? profile.model : '');
      UI.showToast('Profile updated', 'success');
      // Collapse and refresh
      collapseAllProfiles();
      refreshProfileList(overlay);
    });

    /* ── Test connection inline ── */
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="test-connection-inline"]');
      if (!btn) return;
      const item = btn.closest('.profile-item');
      if (!item) return;
      const resultEl = item.querySelector('.inline-result');
      btn.disabled = true;
      btn.textContent = 'Testing…';
      resultEl.textContent = '';
      resultEl.style.color = '';
      try {
        const endpoint = item.querySelector('.pe-endpoint').value.trim();
        const apiKey = item.querySelector('.pe-key').value.trim();
        const model = item.querySelector('.pe-model').value.trim();
        await Api.testConnection({ endpoint, apiKey, model });
        resultEl.textContent = '✓ OK';
        resultEl.style.color = 'var(--color-success)';
      } catch (err) {
        resultEl.textContent = '✗ ' + err.message;
        resultEl.style.color = 'var(--color-danger)';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test';
      }
    });

    /* ── Fetch models inline ── */
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="pe-fetch-models"]');
      if (!btn) return;
      const item = btn.closest('.profile-item');
      if (!item) return;
      const endpoint = item.querySelector('.pe-endpoint').value.trim();
      const apiKey = item.querySelector('.pe-key').value.trim();
      const modelInput = item.querySelector('.pe-model');
      const datalist = item.querySelector('datalist');

      if (!endpoint) {
        UI.showToast('Please enter an endpoint first', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = '↻ Fetching…';
      try {
        const models = await Api.fetchModels({ endpoint, apiKey });
        models.sort((a, b) => a.localeCompare(b));
        if (datalist) datalist.innerHTML = models.map(m => `<option value="${Utils.escapeHtml(m)}">`).join('');
        modelInput.placeholder = 'Type or pick a model…';
        UI.showToast(`Loaded ${models.length} models`, 'success');
      } catch (err) {
        UI.showToast('Fetch failed: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '↻ Fetch';
      }
    });

    /* ── Add profile ── */
    document.getElementById('btn-add-profile').addEventListener('click', async () => {
      const newProfile = {
        id: Utils.generateId(),
        name: 'New Profile',
        endpoint: '',
        apiKey: '',
        model: '',
        createdAt: Date.now()
      };
      const all = Store.loadProfiles();
      all.push(newProfile);
      await Store.saveProfiles(all);
      Store.setActiveProfileId(newProfile.id);
      ChatManager.setChatModel(newProfile.model || '');
      refreshProfileList(overlay);
      // Auto-expand the new profile
      requestAnimationFrame(() => {
        const item = overlay.querySelector(`.profile-item[data-profile-id="${newProfile.id}"]`);
        if (item) {
          const expanded = item.querySelector('.profile-expanded');
          const header = item.querySelector('.profile-header');
          if (expanded && header) {
            collapseAllProfiles();
            expanded.style.display = 'block';
            header.classList.add('expanded');
            item.querySelector('.pe-name')?.focus();
          }
        }
      });
    });

    /* ── Enter key in inline fields saves the profile ── */
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest('.profile-expanded input:not([type="hidden"])');
        if (input) {
          e.preventDefault();
          const saveBtn = input.closest('.profile-item')?.querySelector('[data-action="save-profile-inline"]');
          if (saveBtn) saveBtn.click();
        }
      }
    });
  }

  function refreshProfileList(overlay) {
    const listEl = overlay.querySelector('.profile-list');
    if (!listEl) return;
    const temp = document.createElement('div');
    temp.innerHTML = buildProfileListHtml();
    listEl.replaceWith(temp.firstElementChild);
  }

  function closeConfigModal() {
    if (configModalEl) {
      configModalEl.remove();
      configModalEl = null;
    }
    if (_prevFocus) {
      _prevFocus.focus();
      _prevFocus = null;
    }
  }

  /* ── Save profile from dedicated form (kept for backward compat, calls inline logic) ── */
  function saveProfileForm() {
    const editId = document.getElementById('profile-editor-id')?.value;
    if (!editId) return;
    const saveBtn = document.querySelector(`[data-action="save-profile-inline"][data-profile-id="${editId}"]`);
    if (saveBtn) saveBtn.click();
  }

  /* ── Inline profile helpers (kept for backward compat) ── */
  function resetProfileEditor() { collapseAllProfiles(); }

  function showConfirm(message, onConfirm) {
    _prevFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-dialog';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-body">
          <p>${Utils.escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn btn-danger" data-action="confirm">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    trapFocus(overlay);

    function closeModal() {
      overlay.remove();
      if (_prevFocus) _prevFocus.focus();
    }

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'cancel' || e.target === overlay) {
        closeModal();
      }
      if (action === 'confirm') {
        closeModal();
        if (onConfirm) onConfirm();
      }
    });
  }

  function showPrompt(message, defaultValue, onSubmit, opts) {
    _prevFocus = document.activeElement;
    const options = Object.assign({
      title: 'Input',
      confirmText: 'Save',
      cancelText: 'Cancel',
      placeholder: ''
    }, opts || {});
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-dialog';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <h2>${Utils.escapeHtml(options.title)}</h2>
        </div>
        <div class="modal-body">
          <p>${Utils.escapeHtml(message)}</p>
          <input
            type="text"
            id="modal-prompt-input"
            value="${Utils.escapeHtml(defaultValue || '')}"
            placeholder="${Utils.escapeHtml(options.placeholder || '')}"
            style="width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg);color:var(--color-text);outline:none;"
          >
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">${Utils.escapeHtml(options.cancelText)}</button>
          <button class="btn btn-primary" data-action="submit">${Utils.escapeHtml(options.confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    trapFocus(overlay);

    const input = overlay.querySelector('#modal-prompt-input');
    const close = () => {
      overlay.remove();
      if (_prevFocus) _prevFocus.focus();
    };
    const submit = () => {
      const value = input ? input.value : '';
      close();
      if (onSubmit) onSubmit(value);
    };

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'cancel' || e.target === overlay) close();
      if (action === 'submit') submit();
    });

    if (input) {
      setTimeout(() => { input.focus(); input.select(); }, 50);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════
     Persona Manager (same pattern — expandable)
     ═══════════════════════════════════════════════ */

  /* ── Build persona list HTML (expandable items) ── */
  function buildPersonaListHtml() {
    const roles = UI.getAllRoles();
    let html = '<div class="profile-list" data-type="persona">';
    if (roles.length === 0) {
      html += '<p style="color:var(--color-text-muted);text-align:center;padding:16px;">No personas configured</p>';
    } else {
      for (const r of roles) {
        const badge = r.isDefault
          ? '<span class="default-badge">default</span>'
          : '';
        const preview = (r.prompt || '').substring(0, 80);
        const ellipsis = r.prompt && r.prompt.length > 80 ? '…' : '';
        html += `
          <div class="profile-item" data-role-id="${Utils.escapeHtml(r.id)}">
            <div class="profile-header" tabindex="0" role="button" data-action="toggle-persona">
              <span class="expand-indicator">▶</span>
              <div class="profile-info">
                <div class="profile-name">${Utils.escapeHtml(r.name)}${badge}</div>
                <div class="profile-detail">${Utils.escapeHtml(preview)}${ellipsis}</div>
              </div>
              <div class="profile-actions">
                <button class="btn-ghost" data-action="delete-persona" data-role-id="${Utils.escapeHtml(r.id)}" data-role-name="${Utils.escapeHtml(r.name)}" data-is-default="${r.isDefault || ''}" style="font-size:0.8rem;padding:3px 6px;" title="Delete">🗑️</button>
              </div>
            </div>
            <div class="profile-expanded" style="display:none;">
              <div class="form-group">
                <label>Name</label>
                <input type="text" class="pe-name" value="${Utils.escapeHtml(r.name || '')}" placeholder="Persona name" />
              </div>
              <div class="form-group">
                <label>System Prompt</label>
                <textarea class="pe-prompt" rows="4" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg);color:var(--color-text);outline:none;resize:vertical;font-family:inherit;font-size:0.85rem;">${Utils.escapeHtml(r.prompt || '')}</textarea>
              </div>
              <div class="inline-actions" style="margin-top:6px;">
                <button class="btn btn-primary" data-action="save-persona-inline" data-role-id="${Utils.escapeHtml(r.id)}" style="flex:1;">Save</button>
              </div>
            </div>
          </div>`;
      }
    }
    html += '</div>';
    return html;
  }

  function resetPersonaEditor() {
    document.querySelectorAll('.profile-expanded[style*="display: block"]').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.profile-header.expanded').forEach(el => {
      el.classList.remove('expanded');
    });
  }

  function refreshPersonaList(overlay) {
    const listEl = overlay.querySelector('.profile-list[data-type="persona"]');
    if (!listEl) return;
    const temp = document.createElement('div');
    temp.innerHTML = buildPersonaListHtml();
    listEl.replaceWith(temp.firstElementChild);
  }

  function openRoleManagerModal() {
    _prevFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Persona Manager');

    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <h2>Persona Manager</h2>
          <button class="modal-close" data-action="close-persona" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${buildPersonaListHtml()}
          <hr>
          <button class="btn btn-secondary" id="btn-add-persona" style="width:100%;padding:8px;font-size:0.85rem;">＋ Add Persona</button>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="close-persona">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    trapFocus(overlay);

    /* ── Close ── */
    overlay.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'close-persona' || e.target === overlay) {
        overlay.remove();
        if (_prevFocus) { _prevFocus.focus(); _prevFocus = null; }
      }
    });

    /* ── Toggle persona expand ── */
    overlay.addEventListener('click', (e) => {
      const header = e.target.closest('[data-action="toggle-persona"]');
      if (!header) return;
      if (e.target.closest('.btn-ghost')) return;
      const item = header.closest('.profile-item');
      if (!item) return;
      const expanded = item.querySelector('.profile-expanded');
      const isNowVisible = expanded.style.display !== 'none';
      resetPersonaEditor();
      if (!isNowVisible) {
        expanded.style.display = 'block';
        header.classList.add('expanded');
      }
    });

    /* ── Delete persona ── */
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="delete-persona"]');
      if (!btn) return;
      const roleId = btn.dataset.roleId;
      const roleName = btn.dataset.roleName;
      const isDefault = btn.dataset.isDefault === 'true';
      if (isDefault) {
        Store.addHiddenDefault(roleName);
        UI.showToast('Default persona hidden (reappears on reload)', 'info');
      } else {
        Store.deleteCustomRole(roleId);
        UI.showToast('Custom persona deleted', 'info');
      }
      refreshPersonaList(overlay);
      UI.populateRoleSelect();
    });

    /* ── Save persona inline ── */
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="save-persona-inline"]');
      if (!btn) return;
      const roleId = btn.dataset.roleId;
      const item = btn.closest('.profile-item');
      if (!item) return;
      const name = item.querySelector('.pe-name').value.trim();
      const prompt = item.querySelector('.pe-prompt').value.trim();

      if (!name) {
        UI.showToast('Persona name is required', 'error');
        return;
      }

      const allCustom = Store.loadCustomRoles();
      const existing = allCustom.find(r => r.id === roleId);
      if (existing) {
        existing.name = name;
        existing.systemPrompt = prompt;
      } else {
        // Editing a default persona — create a custom one with the same id
        const byName = allCustom.find(r => r.name.toLowerCase() === name.toLowerCase());
        if (byName) {
          byName.systemPrompt = prompt;
        } else {
          allCustom.push({ id: roleId, name, systemPrompt: prompt });
        }
      }
      Store.saveCustomRoles(allCustom);
      UI.showToast('Persona saved', 'success');
      refreshPersonaList(overlay);
      UI.populateRoleSelect();
    });

    /* ── Add persona ── */
    document.getElementById('btn-add-persona').addEventListener('click', () => {
      const newRole = { id: Utils.generateId(), name: 'New Persona', systemPrompt: '' };
      const all = Store.loadCustomRoles();
      all.push(newRole);
      Store.saveCustomRoles(all);
      refreshPersonaList(overlay);
      UI.populateRoleSelect();
      requestAnimationFrame(() => {
        const item = overlay.querySelector(`.profile-item[data-role-id="${newRole.id}"]`);
        if (item) {
          const expanded = item.querySelector('.profile-expanded');
          const header = item.querySelector('.profile-header');
          if (expanded && header) {
            resetPersonaEditor();
            expanded.style.display = 'block';
            header.classList.add('expanded');
            item.querySelector('.pe-name')?.focus();
          }
        }
      });
    });

    /* ── Enter key in inline name fields saves persona ── */
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest('.profile-expanded input:not([type="hidden"])');
        if (input) {
          e.preventDefault();
          const saveBtn = input.closest('.profile-item')?.querySelector('[data-action="save-persona-inline"]');
          if (saveBtn) saveBtn.click();
        }
      }
    });
  }

  Object.assign(UI, {
    openConfigModal,
    closeConfigModal,
    saveProfileForm,
    buildProfileListHtml,
    resetProfileEditor,
    buildPersonaListHtml,
    resetPersonaEditor,
    showConfirm,
    showPrompt,
    openRoleManagerModal
  });
})();
