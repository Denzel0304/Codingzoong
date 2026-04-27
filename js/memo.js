// ============================================================
// memo.js — 메모 탭 관리
// - 제목, 메모 내용, 태그 저장
// - 클라이언트사이드 검색 (제목/내용/태그)
// - 클릭 시 편집 모달
// ============================================================
const Memo = (() => {
  let _editingId   = null;
  let _searchQuery = '';

  // ── 목록 렌더링 ───────────────────────────────────────────────
  function render() {
    const items = AppState.getMemos();
    const q     = _searchQuery.toLowerCase();

    const filtered = q
      ? items.filter(m =>
          m.title.toLowerCase().includes(q) ||
          m.memo.toLowerCase().includes(q) ||
          (m.tags || []).some(t => t.toLowerCase().includes(q))
        )
      : items;

    const sorted = [...filtered].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const listEl = document.getElementById('memo-list');
    listEl.innerHTML = '';

    if (!sorted.length) {
      listEl.innerHTML = '<div class="empty-state">저장된 메모가 없습니다.<br>+ 버튼으로 추가해 보세요.</div>';
      return;
    }

    sorted.forEach(item => {
      const el      = document.createElement('div');
      el.className  = 'memo-card';
      el.dataset.id = item.id;

      el.innerHTML = `
        <div class="memo-card-head">
          <span class="memo-card-title">${UI.escHtml(item.title)}</span>
          <button class="btn-del-item memo-del-btn" title="삭제">✕</button>
        </div>
        ${item.memo
          ? `<div class="memo-card-body">${UI.escHtml(item.memo.slice(0, 120))}${item.memo.length > 120 ? '…' : ''}</div>`
          : ''}
        <div class="memo-card-foot">
          <div class="memo-tags">${UI.renderTags(item.tags)}</div>
          <span class="memo-card-date">${UI.formatDateShort(item.updated_at)}</span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('memo-del-btn')) openEdit(item.id);
      });
      el.querySelector('.memo-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });

      listEl.appendChild(el);
    });
  }

  // ── 편집 모달 열기 ────────────────────────────────────────────
  function openEdit(id) {
    _editingId = id || null;
    const item = id ? AppState.getById(id) : null;

    document.getElementById('memo-modal-head').textContent =
      id ? '메모 편집' : '새 메모 추가';
    document.getElementById('memo-input-title').value = item?.title || '';
    document.getElementById('memo-input-memo').value  = item?.memo  || '';
    document.getElementById('memo-input-tags').value  = UI.tagsToString(item?.tags);

    UI.openModal(document.getElementById('memo-modal'));
    setTimeout(() => document.getElementById('memo-input-title').focus(), 80);
  }

  // ── 저장 ─────────────────────────────────────────────────────
  async function save() {
    const title = document.getElementById('memo-input-title').value.trim();
    if (!title) { UI.toast('제목을 입력하세요', 'warn'); return; }

    const memo    = document.getElementById('memo-input-memo').value.trim();
    const tags    = UI.parseTags(document.getElementById('memo-input-tags').value);
    const payload = { type: 'memo', title, memo, tags };

    if (!_editingId) {
      const existing = AppState.getMemos();
      const minOrd   = existing.length ? Math.min(...existing.map(i => i.sort_order)) : 0;
      payload.sort_order = minOrd - 1;
    }

    try {
      let result;
      if (_editingId) {
        result = await DB.update(_editingId, payload);
        AppState.updateItem(result);
      } else {
        result = await DB.insert(payload);
        AppState.addItem(result);
      }
      UI.closeModal(document.getElementById('memo-modal'));
      render();
      UI.toast(_editingId ? '저장되었습니다' : '추가되었습니다', 'success');
    } catch (e) {
      UI.toast('저장 실패: ' + e.message, 'error');
    }
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function deleteItem(id) {
    const ok = await UI.confirm('이 메모를 삭제할까요?\n되돌릴 수 없습니다.', '삭제', '취소');
    if (!ok) return;
    try {
      await DB.remove(id);
      AppState.removeItem(id);
      render();
      UI.toast('삭제되었습니다', 'success');
    } catch (e) {
      UI.toast('삭제 실패: ' + e.message, 'error');
    }
  }

  // ── 검색 ─────────────────────────────────────────────────────
  function search(query) {
    _searchQuery = query;
    render();
  }

  return { render, openEdit, save, deleteItem, search };
})();
