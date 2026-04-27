// ============================================================
// code.js — 코드 탭 관리
//
// - 코드 저장: 제목, 메모, 태그, 코드 내용
// - 언어 자동 감지: highlight.js highlightAuto()
// - 코드 에디터: 탭 입력 지원, 모노스페이스 스타일
// - 검색: 제목/메모/태그/코드내용 클라이언트사이드 검색
// - 복사: clipboard API로 순수 텍스트 복사
// ============================================================
const Code = (() => {
  let _editingId   = null;
  let _searchQuery = '';
  let _previewMode = false; // false = 편집, true = 하이라이트 미리보기

  // ── 목록 렌더링 ───────────────────────────────────────────────
  function render() {
    const items = AppState.getCodes();
    const q     = _searchQuery.toLowerCase();

    const filtered = q
      ? items.filter(c =>
          c.title.toLowerCase().includes(q) ||
          c.memo.toLowerCase().includes(q) ||
          c.code_content.toLowerCase().includes(q) ||
          (c.tags || []).some(t => t.toLowerCase().includes(q))
        )
      : items;

    const sorted = [...filtered].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const listEl = document.getElementById('code-list');
    listEl.innerHTML = '';

    if (!sorted.length) {
      listEl.innerHTML = '<div class="empty-state">저장된 코드가 없습니다.<br>+ 버튼으로 추가해 보세요.</div>';
      return;
    }

    sorted.forEach(item => {
      const lang    = item.language || '';
      const preview = _getCodePreview(item.code_content);
      const el      = document.createElement('div');
      el.className  = 'code-card';
      el.dataset.id = item.id;

      el.innerHTML = `
        <div class="code-card-head">
          <span class="code-card-title">${UI.escHtml(item.title)}</span>
          ${lang ? `<span class="lang-badge lang-badge--${_langClass(lang)}">${UI.escHtml(lang)}</span>` : ''}
          <button class="btn-del-item code-del-btn" title="삭제">✕</button>
        </div>
        ${item.memo ? `<div class="code-card-memo">${UI.escHtml(item.memo.slice(0, 60))}${item.memo.length > 60 ? '…' : ''}</div>` : ''}
        <pre class="code-card-preview"><code>${UI.escHtml(preview)}</code></pre>
        <div class="code-card-foot">
          ${UI.renderTags(item.tags)}
          <span class="code-card-date">${UI.formatDateShort(item.updated_at)}</span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('code-del-btn')) openEdit(item.id);
      });
      el.querySelector('.code-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });

      listEl.appendChild(el);
    });
  }

  function _getCodePreview(code) {
    if (!code) return '';
    return code.split('\n').slice(0, 4).join('\n');
  }

  function _langClass(lang) {
    return (lang || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // ── 편집 모달 열기 ────────────────────────────────────────────
  function openEdit(id) {
    _editingId   = id || null;
    _previewMode = false;
    const item   = id ? AppState.getById(id) : null;

    document.getElementById('code-modal-head').textContent =
      id ? '코드 편집' : '새 코드 추가';
    document.getElementById('code-input-title').value    = item?.title        || '';
    document.getElementById('code-input-memo').value     = item?.memo         || '';
    document.getElementById('code-input-tags').value     = UI.tagsToString(item?.tags);
    document.getElementById('code-input-code').value     = item?.code_content || '';
    document.getElementById('code-lang-badge').textContent =
      item?.language ? item.language : '자동 감지됨';

    // 미리보기 초기화
    _showEditor(true);

    UI.openModal(document.getElementById('code-modal'));
    setTimeout(() => document.getElementById('code-input-title').focus(), 80);
  }

  // ── 에디터/미리보기 전환 ─────────────────────────────────────
  function _showEditor(editorMode) {
    _previewMode = !editorMode;
    document.getElementById('code-editor-area').style.display   = editorMode ? 'block' : 'none';
    document.getElementById('code-preview-area').style.display  = editorMode ? 'none'  : 'block';
    document.getElementById('code-toggle-btn').textContent      = editorMode ? '👁 미리보기' : '✏️ 편집';
  }

  function togglePreview() {
    if (!_previewMode) {
      // 에디터 → 미리보기
      const raw  = document.getElementById('code-input-code').value;
      const result = typeof hljs !== 'undefined' && raw.trim()
        ? hljs.highlightAuto(raw)
        : { value: UI.escHtml(raw), language: '' };

      document.getElementById('code-preview-code').innerHTML = result.value;
      document.getElementById('code-lang-badge').textContent = result.language || '감지 안됨';
      _showEditor(false);
    } else {
      _showEditor(true);
      document.getElementById('code-input-code').focus();
    }
  }

  // ── 코드 에디터 초기화 (탭 키 지원) ─────────────────────────
  function setupCodeEditor() {
    const ta = document.getElementById('code-input-code');
    if (!ta) return;

    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s   = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value  = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = s + 2;
    });
  }

  // ── 코드 복사 ─────────────────────────────────────────────────
  function copyCode() {
    const code = document.getElementById('code-input-code').value;
    if (!code) { UI.toast('복사할 코드가 없습니다', 'warn'); return; }
    navigator.clipboard.writeText(code)
      .then(() => UI.toast('코드가 클립보드에 복사되었습니다', 'success'))
      .catch(() => UI.toast('복사 실패 (브라우저 권한 확인)', 'error'));
  }

  // ── 저장 ─────────────────────────────────────────────────────
  async function save() {
    const title = document.getElementById('code-input-title').value.trim();
    if (!title) { UI.toast('제목을 입력하세요', 'warn'); return; }

    const memo         = document.getElementById('code-input-memo').value.trim();
    const tags         = UI.parseTags(document.getElementById('code-input-tags').value);
    const code_content = document.getElementById('code-input-code').value;

    // 언어 자동 감지
    let language = '';
    if (code_content.trim() && typeof hljs !== 'undefined') {
      const r = hljs.highlightAuto(code_content);
      language = r.language || '';
    }

    const payload = { type: 'code', title, memo, tags, code_content, language };

    if (!_editingId) {
      const existing = AppState.getCodes();
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
      UI.closeModal(document.getElementById('code-modal'));
      render();
      UI.toast(_editingId ? '저장되었습니다' : '추가되었습니다', 'success');
    } catch (e) {
      UI.toast('저장 실패: ' + e.message, 'error');
    }
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function deleteItem(id) {
    const ok = await UI.confirm('이 코드를 삭제할까요?\n되돌릴 수 없습니다.', '삭제', '취소');
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

  return { render, openEdit, setupCodeEditor, togglePreview, copyCode, save, deleteItem, search };
})();
