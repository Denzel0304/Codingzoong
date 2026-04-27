// ============================================================
// projects.js — 진행중 / 완료 / 구현전 탭 관리
//
// 기능:
// - 항목 목록 렌더링 (진행률 %, 드래그 정렬, 삭제)
// - 편집 모달 (제목, 메모, 체크리스트)
// - 체크리스트 토글 시 즉시 저장 (debounce 800ms)
// - 100% → 완료탭 이동 / 완료탭에서 해제 → 진행중 이동 (확인 모달)
// ============================================================
const Projects = (() => {
  let _editingId      = null;   // null = 신규
  let _currentStatus  = 'in_progress';
  let _checklist      = [];     // 편집 모달의 임시 체크리스트
  let _saveTimer      = null;   // 체크 디바운스 타이머
  let _pendingStatus  = null;   // 저장 시 변경할 status

  // ── 진행률 계산 ───────────────────────────────────────────────
  function calcProgress(checklist) {
    if (!checklist || checklist.length === 0) return 0;
    const done = checklist.filter(c => c.checked).length;
    return Math.round((done / checklist.length) * 100);
  }

  // ── 목록 렌더링 ───────────────────────────────────────────────
  function render(status) {
    _currentStatus = status;
    const items  = AppState.getProjects(status);
    const listEl = document.getElementById('project-list');
    listEl.innerHTML = '';

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state">아직 항목이 없습니다.<br>+ 버튼으로 추가해 보세요.</div>';
      return;
    }

    const sorted = [...items].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    sorted.forEach(item => {
      const pct        = calcProgress(item.checklist);
      const isComplete = (status === 'completed');
      const el         = document.createElement('div');
      el.className     = 'sortable-item project-card';
      el.dataset.id    = item.id;

      el.innerHTML = `
        <div class="drag-handle" title="길게 눌러 순서 변경">
          <span class="drag-icon"><span></span></span>
        </div>
        <div class="project-body" role="button" tabindex="0">
          <div class="project-title-row">
            ${isComplete ? '<span class="trophy-icon">🏆</span>' : ''}
            <span class="project-title">${UI.escHtml(item.title)}</span>
          </div>
          ${isComplete && item.completed_at
            ? `<div class="project-done-date">완료: ${UI.formatDateShort(item.completed_at)}</div>`
            : ''}
          <div class="progress-row">
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="progress-pct">${pct}%</span>
          </div>
          ${item.memo
            ? `<div class="project-memo">${UI.escHtml(item.memo.slice(0, 80))}${item.memo.length > 80 ? '…' : ''}</div>`
            : ''}
          ${item.checklist && item.checklist.length
            ? `<div class="project-checklist-summary">${item.checklist.filter(c=>c.checked).length} / ${item.checklist.length} 완료</div>`
            : ''}
        </div>
        <button class="btn-del-item" title="삭제">✕</button>
      `;

      // 클릭 → 편집
      el.querySelector('.project-body').addEventListener('click', () => openEdit(item.id));
      el.querySelector('.project-body').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') openEdit(item.id);
      });

      // 삭제
      el.querySelector('.btn-del-item').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });

      listEl.appendChild(el);
    });

    // 드래그 정렬 초기화
    UI.makeDraggable(listEl, async (newOrder) => {
      newOrder.forEach(({ id, sort_order }) => {
        const it = AppState.getById(id);
        if (it) it.sort_order = sort_order;
      });
      await DB.updateSortOrders(newOrder);
    });
  }

  // ── 편집 모달 열기 ────────────────────────────────────────────
  function openEdit(id) {
    _editingId     = id || null;
    _pendingStatus = null;
    const item     = id ? AppState.getById(id) : null;

    _checklist = item ? JSON.parse(JSON.stringify(item.checklist || [])) : [];

    document.getElementById('proj-modal-head').textContent =
      id ? '항목 편집' : '새 항목 추가';
    document.getElementById('proj-input-title').value = item?.title || '';
    document.getElementById('proj-input-memo').value  = item?.memo  || '';

    renderChecklist();
    UI.openModal(document.getElementById('proj-modal'));
    document.getElementById('proj-input-title').focus();
  }

  // ── 체크리스트 렌더링 ─────────────────────────────────────────
  function renderChecklist() {
    const listEl   = document.getElementById('checklist-items');
    listEl.innerHTML = '';

    const unchecked = _checklist.filter(c => !c.checked);
    const checked   = _checklist.filter(c =>  c.checked);

    unchecked.forEach(c => listEl.appendChild(_makeCheckItem(c)));

    if (checked.length > 0) {
      const divEl = document.createElement('div');
      divEl.className = 'checklist-divider';
      divEl.innerHTML = '<span class="divider-icon">⭐</span><span>완료된 항목</span>';
      listEl.appendChild(divEl);
      checked.forEach(c => listEl.appendChild(_makeCheckItem(c)));
    }

    _updateProgressDisplay();
  }

  function _makeCheckItem(c) {
    const el = document.createElement('div');
    el.className = `checklist-item${c.checked ? ' checklist-item--done' : ''}`;
    el.dataset.cid = c.id;
    el.innerHTML = `
      <label class="check-label">
        <input type="checkbox" class="check-input" ${c.checked ? 'checked' : ''} data-cid="${c.id}">
        <span class="check-box"></span>
        <span class="check-text">${UI.escHtml(c.text)}</span>
      </label>
      ${c.checked && c.completed_at
        ? `<span class="check-time">${UI.formatDate(c.completed_at)}</span>`
        : ''}
      <button class="check-del-btn" data-cid="${c.id}" title="항목 삭제">✕</button>
    `;

    el.querySelector('.check-input').addEventListener('change', (e) => {
      toggleCheck(c.id, e.target.checked);
    });
    el.querySelector('.check-del-btn').addEventListener('click', () => {
      removeCheck(c.id);
    });

    return el;
  }

  function _updateProgressDisplay() {
    const pct = calcProgress(_checklist);
    document.getElementById('modal-prog-fill').style.width = pct + '%';
    document.getElementById('modal-prog-pct').textContent  = pct + '%';
  }

  // ── 체크리스트 토글 ───────────────────────────────────────────
  async function toggleCheck(cid, checked) {
    const c = _checklist.find(x => x.id === cid);
    if (!c) return;

    c.checked      = checked;
    c.completed_at = checked ? new Date().toISOString() : null;
    renderChecklist();

    if (!_editingId) return; // 신규 작성 중엔 DB 저장 안 함

    const item = AppState.getById(_editingId);
    const pct  = calcProgress(_checklist);

    // ✅ 진행중 → 100% → 완료 탭 이동
    if (pct === 100 && item?.status === 'in_progress') {
      const ok = await UI.confirm(
        '코드가 모두 완성되어\n완료 탭으로 이동합니다.',
        '이동', '취소'
      );
      if (ok) {
        _pendingStatus = 'completed';
        await _flushSave({ status: 'completed', completed_at: new Date().toISOString() });
        UI.closeModal(document.getElementById('proj-modal'));
        App.updateCounts();
        App.switchTab('completed');
        return;
      }
    }

    // ✅ 완료탭에서 체크 해제 → 진행중 이동
    if (!checked && item?.status === 'completed') {
      const ok = await UI.confirm(
        '진행 중 탭으로 이동하여\n코드를 추가합니다.',
        '이동', '취소'
      );
      if (ok) {
        _pendingStatus = 'in_progress';
        await _flushSave({ status: 'in_progress', completed_at: null });
        UI.closeModal(document.getElementById('proj-modal'));
        App.updateCounts();
        App.switchTab('in_progress');
        return;
      }
    }

    // 일반: debounce로 자동저장
    _scheduleCheckSave();
  }

  function _scheduleCheckSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _flushSave({}).catch(err => {
        UI.toast('체크리스트 저장 실패: ' + err.message, 'error');
      });
    }, 800);
  }

  async function _flushSave(extra = {}) {
    if (!_editingId) return;
    const updated = await DB.update(_editingId, { checklist: _checklist, ...extra });
    AppState.updateItem(updated);
    render(AppState.getById(_editingId)?.status || _currentStatus);
    App.updateCounts();
  }

  // ── 체크리스트 항목 추가 ─────────────────────────────────────
  function addCheck() {
    const input = document.getElementById('checklist-new-input');
    const text  = input.value.trim();
    if (!text) { UI.toast('항목 내용을 입력하세요', 'warn'); return; }

    _checklist.push({
      id:           UI.genId(),
      text,
      checked:      false,
      completed_at: null,
    });
    input.value = '';
    renderChecklist();
    input.focus();

    // 완료탭에서 새 항목 추가 → 진행중 이동 경고 (저장 시 처리)
    if (_editingId) {
      const item = AppState.getById(_editingId);
      if (item?.status === 'completed') {
        UI.toast('저장 시 진행 중 탭으로 이동됩니다', 'info');
      }
    }
  }

  // ── 체크리스트 항목 삭제 ─────────────────────────────────────
  function removeCheck(cid) {
    _checklist = _checklist.filter(c => c.id !== cid);
    renderChecklist();
  }

  // ── 저장 ─────────────────────────────────────────────────────
  async function save() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }

    const title = document.getElementById('proj-input-title').value.trim();
    if (!title) { UI.toast('제목을 입력하세요', 'warn'); return; }

    const memo = document.getElementById('proj-input-memo').value.trim();
    const pct  = calcProgress(_checklist);

    let status       = _currentStatus;
    let completed_at = _editingId ? AppState.getById(_editingId)?.completed_at : null;

    // 완료탭 편집 중, 체크리스트 변경으로 100% 미만이 된 경우
    if (_editingId) {
      const item = AppState.getById(_editingId);
      if (item?.status === 'completed' && pct < 100) {
        const ok = await UI.confirm(
          '진행 중 탭으로 이동하여\n코드를 추가합니다.',
          '이동', '취소'
        );
        if (ok) {
          status       = 'in_progress';
          completed_at = null;
        }
      }
      // 완료탭에서 새 체크리스트 항목 추가(100% 아님)
      if (item?.status === 'completed' && _checklist.some(c => !c.checked)) {
        if (status === 'completed') {
          const ok = await UI.confirm(
            '진행 중 탭으로 이동하여\n코드를 추가합니다.',
            '이동', '취소'
          );
          if (ok) {
            status       = 'in_progress';
            completed_at = null;
          }
        }
      }
    }

    // 신규 진행중 → 100% → 완료로 넣는 경우
    if (pct === 100 && status === 'in_progress') {
      const ok = await UI.confirm(
        '코드가 모두 완성되어\n완료 탭으로 이동합니다.',
        '이동', '취소'
      );
      if (ok) {
        status       = 'completed';
        completed_at = new Date().toISOString();
      }
    }

    const payload = { title, memo, checklist: _checklist, status };
    if (status === 'completed' && !completed_at) {
      payload.completed_at = new Date().toISOString();
    } else if (status !== 'completed') {
      payload.completed_at = null;
    } else {
      payload.completed_at = completed_at;
    }

    if (!_editingId) {
      // 신규: 현재 목록 최상단에 표시 (sort_order = min - 1)
      const existing = AppState.getProjects(status);
      const minOrd   = existing.length ? Math.min(...existing.map(i => i.sort_order)) : 0;
      payload.sort_order = minOrd - 1;
      payload.type       = 'project';
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

      UI.closeModal(document.getElementById('proj-modal'));
      render(status);
      App.updateCounts();
      UI.toast(_editingId ? '저장되었습니다' : '추가되었습니다', 'success');

      // 탭 이동
      if (status !== _currentStatus) {
        App.switchTab(status);
      }
    } catch (e) {
      UI.toast('저장 실패: ' + e.message, 'error');
    }
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function deleteItem(id) {
    const ok = await UI.confirm('이 항목을 삭제할까요?\n되돌릴 수 없습니다.', '삭제', '취소');
    if (!ok) return;
    try {
      await DB.remove(id);
      AppState.removeItem(id);
      render(_currentStatus);
      App.updateCounts();
      UI.toast('삭제되었습니다', 'success');
    } catch (e) {
      UI.toast('삭제 실패: ' + e.message, 'error');
    }
  }

  return { render, openEdit, toggleCheck, addCheck, removeCheck, save, deleteItem };
})();
