// ============================================================
// projects.js — 수정중 / 완료 / 아이디어 탭 관리
// ============================================================
const Projects = (() => {
  let _editingId      = null;
  let _currentStatus  = 'in_progress';
  let _checklist      = [];
  let _saveTimer      = null;
  let _pendingStatus  = null;
  let _isDragging     = false;

  function calcProgress(checklist) {
    if (!checklist || checklist.length === 0) return 0;
    const done = checklist.filter(c => c.checked).length;
    return Math.round((done / checklist.length) * 100);
  }

  // ── 목록 렌더링 ───────────────────────────────────────────────
  function render(status) {
    if (_isDragging) { console.log('[Projects] 드래그 중 — render 건너뜀'); return; }
    _currentStatus = status;
    const items  = AppState.getProjects(status);
    const listEl = document.getElementById('project-list');
    listEl.innerHTML = '';

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state">아직 항목이 없습니다.<br>+ 버튼으로 추가해 보세요.</div>';
      return;
    }

    // ── 수정중 탭 정렬 ────────────────────────────────────────
    // 진행중(1%~99%) 항목: 완료도 높은 순 → 상단 그룹
    // 나머지(0%): 오래된 것이 위, 최신이 아래 (created_at 오름차순)
    // 드래그 sort_order는 같은 그룹 내에서만 유효
    let sorted;
    if (status === 'in_progress') {
      const inProgress = items
        .filter(i => calcProgress(i.checklist) > 0)
        .sort((a, b) => calcProgress(b.checklist) - calcProgress(a.checklist));

      const notStarted = items
        .filter(i => calcProgress(i.checklist) === 0)
        .sort((a, b) => {
          // sort_order가 다르면 sort_order 우선 (드래그 결과 반영)
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          // 같으면 오래된 것이 위, 최신이 아래
          return new Date(a.created_at) - new Date(b.created_at);
        });

      sorted = [...inProgress, ...notStarted];
    } else {
      // 완료/아이디어: sort_order 우선, 같으면 최신 아래
      sorted = [...items].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return new Date(a.created_at) - new Date(b.created_at);
      });
    }

    const isComplete = (status === 'completed');

    sorted.forEach(item => {
      const pct = calcProgress(item.checklist);
      const el  = document.createElement('div');
      el.className  = 'sortable-item project-card';
      el.dataset.id = item.id;

      // ── 수정중 탭: 진행 세로 띠 색상 ──
      // 0%: 없음, 1~33%: 회색, 34~66%: 황토색, 67~99%: 빨간색, 100%: 완료탭으로 이동됨
      let progressStripe = '';
      if (status === 'in_progress' && pct > 0 && pct < 100) {
        let stripeClass = '';
        if (pct <= 33)       stripeClass = 'stripe--gray';
        else if (pct <= 66)  stripeClass = 'stripe--amber';
        else                 stripeClass = 'stripe--red';
        progressStripe = `<div class="progress-stripe ${stripeClass}"></div>`;
      }

      const actionBtn = isComplete
        ? `<button class="btn-del-item" title="삭제">✕</button>`
        : `<button class="btn-more" title="더보기">⋮</button>`;

      el.innerHTML = `
        ${progressStripe}
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
            ? `<div class="project-memo">${UI.escHtml(item.memo.slice(0,80))}${item.memo.length>80?'…':''}</div>`
            : ''}
          ${item.checklist && item.checklist.length
            ? `<div class="project-checklist-summary">${item.checklist.filter(c=>c.checked).length} / ${item.checklist.length} 완료</div>`
            : ''}
        </div>
        ${actionBtn}
      `;

      el.querySelector('.project-body').addEventListener('click', () => openEdit(item.id));
      el.querySelector('.project-body').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') openEdit(item.id);
      });

      if (isComplete) {
        el.querySelector('.btn-del-item').addEventListener('click', (e) => {
          e.stopPropagation(); deleteItem(item.id);
        });
      } else {
        el.querySelector('.btn-more').addEventListener('click', (e) => {
          e.stopPropagation(); _openMoreMenu(e.currentTarget, item, status);
        });
      }

      listEl.appendChild(el);
    });

    // 드래그: 수정중 탭에서는 진행중 그룹(pct>0) 내 정렬이 항상 완료도 순이므로
    // 드래그 후 sort_order 저장은 하되, render 시 정렬 기준이 우선 적용됨
    UI.makeDraggable(listEl,
      async (newOrder) => {
        newOrder.forEach(({ id, sort_order }) => {
          const it = AppState.getById(id); if (it) it.sort_order = sort_order;
        });
        await DB.updateSortOrders(newOrder);
      },
      () => { _isDragging = true; },
      () => { _isDragging = false; }
    );
  }

  // ── 점3개 메뉴 ────────────────────────────────────────────────
  function _openMoreMenu(btnEl, item, status) {
    _closeMoreMenu();
    const moveLabel  = status === 'in_progress' ? '💡 아이디어로 이동' : '🛠️ 수정중으로 이동';
    const moveTarget = status === 'in_progress' ? 'pending' : 'in_progress';
    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.innerHTML = `
      <button class="more-menu-item" data-action="move">${moveLabel}</button>
      <button class="more-menu-item more-menu-item--danger" data-action="delete">✕ 삭제</button>
    `;
    const rect = btnEl.getBoundingClientRect();
    menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;right:${window.innerWidth-rect.right}px`;
    document.body.appendChild(menu);
    menu.querySelector('[data-action="move"]').addEventListener('click', (e) => {
      e.stopPropagation(); _closeMoreMenu(); moveItem(item.id, moveTarget);
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation(); _closeMoreMenu(); deleteItem(item.id);
    });
    setTimeout(() => document.addEventListener('click', _closeMoreMenu, { once: true }), 0);
  }

  function _closeMoreMenu() {
    document.querySelectorAll('.more-menu').forEach(m => m.remove());
  }

  async function moveItem(id, targetStatus) {
    const item = AppState.getById(id); if (!item) return;
    const labelMap = { in_progress: '수정중', pending: '아이디어' };
    const ok = await UI.confirm(`"${item.title}"\n${labelMap[targetStatus]} 탭으로 이동할까요?`, '이동', '취소');
    if (!ok) return;
    try {
      const result = await DB.update(id, { status: targetStatus });
      AppState.updateItem(result);
      render(_currentStatus);
      App.updateCounts();
      UI.toast(`${labelMap[targetStatus]}으로 이동했습니다`, 'success');
    } catch (e) { UI.toast('이동 실패: ' + e.message, 'error'); }
  }

  // ── 미저장 편집 취소 (뒤로가기 / 닫기 버튼 시 호출) ─────────
  // 자동저장 타이머를 취소하여 미저장 체크리스트 변경이 AppState에 반영되지 않도록 함
  function cancelEdit() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  }

  // ── 편집 모달 열기 ────────────────────────────────────────────
  function openEdit(id) {
    _editingId     = id || null;
    _pendingStatus = null;
    const item     = id ? AppState.getById(id) : null;
    _checklist = item ? JSON.parse(JSON.stringify(item.checklist || [])) : [];

    // 신규 추가(+ 버튼) → 항상 아이디어 탭으로 전환 후 모달 오픈
    if (!id && _currentStatus !== 'pending') {
      App.switchTab('pending');
      setTimeout(() => {
        document.getElementById('proj-modal-head').textContent = '새 아이디어 추가';
        document.getElementById('proj-input-title').value = '';
        document.getElementById('proj-input-memo').value  = '';
        document.getElementById('checklist-new-input').value = ''; // 이전 미저장 입력 초기화
        UI.setupMemoFeatures(document.getElementById('proj-input-memo'));
        renderChecklist();
        UI.openModal(document.getElementById('proj-modal'));
        setTimeout(() => document.getElementById('proj-input-title').focus(), 80);
      }, 50);
      return;
    }

    document.getElementById('proj-modal-head').textContent = id ? '항목 편집' : '새 아이디어 추가';
    document.getElementById('proj-input-title').value = item?.title || '';
    document.getElementById('proj-input-memo').value  = item?.memo  || '';
    document.getElementById('checklist-new-input').value = ''; // 이전 미저장 입력 초기화

    UI.setupMemoFeatures(document.getElementById('proj-input-memo'));
    renderChecklist();
    UI.openModal(document.getElementById('proj-modal'));

    // 신규 추가일 때만 제목 포커스
    if (!id) {
      setTimeout(() => document.getElementById('proj-input-title').focus(), 80);
    }
  }

  // ── 체크리스트 렌더링 ─────────────────────────────────────────
  function renderChecklist() {
    const listEl = document.getElementById('checklist-items');
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
    _setupChecklistDrag(listEl);
  }

  // ── 체크리스트 내부 드래그 ────────────────────────────────────
  function _setupChecklistDrag(listEl) {
    if (listEl._checkDragAbort) listEl._checkDragAbort.abort();
    const ac  = new AbortController();
    listEl._checkDragAbort = ac;
    const sig = ac.signal;

    let dragging  = null;
    let indicator = null;
    let startY    = 0;
    let moved     = false;

    const cy = (e) => e.touches ? e.touches[0].clientY : e.clientY;

    function getUncheckedItems() {
      return Array.from(listEl.querySelectorAll(':scope > .checklist-item:not(.checklist-item--done)'));
    }

    function ensureIndicator() {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'check-drop-indicator';
      }
      return indicator;
    }

    function removeIndicator() {
      if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator = null;
    }

    function placeIndicator(y) {
      const ind = ensureIndicator();
      let before = null;
      for (const item of getUncheckedItems()) {
        if (item === dragging) continue;
        const r = item.getBoundingClientRect();
        if (y < r.top + r.height * 0.5) { before = item; break; }
      }
      if (ind.parentNode) ind.parentNode.removeChild(ind);
      if (before) {
        listEl.insertBefore(ind, before);
      } else {
        const divider = listEl.querySelector('.checklist-divider');
        divider ? listEl.insertBefore(ind, divider) : listEl.appendChild(ind);
      }
    }

    function onStart(e) {
      const handle = e.target.closest('.check-drag-handle');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = handle.closest('.checklist-item');
      if (!dragging || dragging.classList.contains('checklist-item--done')) { dragging = null; return; }
      startY = cy(e);
      moved  = false;
      dragging.classList.add('check-dragging');
      document.body.style.userSelect = 'none';
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const y = cy(e);
      if (Math.abs(y - startY) > 3) moved = true;
      if (moved) placeIndicator(y);
    }

    function onEnd() {
      if (!dragging) return;
      if (moved && indicator && indicator.parentNode) listEl.insertBefore(dragging, indicator);
      removeIndicator();
      dragging.classList.remove('check-dragging');
      document.body.style.userSelect = '';

      if (moved) {
        const newOrder = getUncheckedItems().map(el => el.dataset.cid);
        const unchecked = newOrder.map(cid => _checklist.find(c => c.id === cid)).filter(Boolean);
        const checked   = _checklist.filter(c => c.checked);
        _checklist = [...unchecked, ...checked];
        _updateProgressDisplay();
      }

      dragging = null;
      moved    = false;
    }

    const opt = { signal: sig };
    listEl.addEventListener('mousedown',   onStart, opt);
    listEl.addEventListener('touchstart',  onStart, { ...opt, passive: false });
    document.addEventListener('mousemove', (e) => { if (dragging) onMove(e); }, opt);
    document.addEventListener('mouseup',   ()  => { if (dragging) onEnd();  }, opt);
    listEl.addEventListener('touchmove',   onMove, { ...opt, passive: false });
    listEl.addEventListener('touchend',    onEnd,  opt);
    listEl.addEventListener('touchcancel', () => {
      if (!dragging) return;
      removeIndicator();
      dragging.classList.remove('check-dragging');
      document.body.style.userSelect = '';
      dragging = null; moved = false;
    }, opt);
  }

  function _makeCheckItem(c) {
    const el = document.createElement('div');
    el.className = `checklist-item${c.checked ? ' checklist-item--done' : ''}`;
    el.dataset.cid = c.id;

    // check-text는 label 밖에 위치 → 글자 클릭이 체크박스 토글을 유발하지 않음
    el.innerHTML = `
      ${!c.checked ? `<div class="check-drag-handle" title="드래그로 순서 변경">
        <span class="check-drag-icon"><span></span></span>
      </div>` : '<div class="check-drag-placeholder"></div>'}
      <label class="check-label">
        <input type="checkbox" class="check-input" ${c.checked ? 'checked' : ''} data-cid="${c.id}">
        <span class="check-box"></span>
      </label>
      <span class="check-text" data-cid="${c.id}" title="클릭하여 편집"></span>
      ${c.checked && c.completed_at
        ? `<span class="check-time">${UI.formatDate(c.completed_at)}</span>`
        : ''}
      <button class="check-del-btn" data-cid="${c.id}" title="항목 삭제">✕</button>
    `;

    // textContent로 설정 — XSS 방지 및 이모지 등 특수문자 보존
    el.querySelector('.check-text').textContent = c.text;

    // ── 체크박스 토글 ─────────────────────────────────────────
    el.querySelector('.check-input').addEventListener('change', (e) => {
      toggleCheck(c.id, e.target.checked);
    });

    // ── 글자 클릭 → 인라인 편집 (체크 토글 없음) ─────────────
    const textSpan = el.querySelector('.check-text');
    textSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      textSpan.contentEditable = 'true';
      textSpan.classList.add('check-text--editing');
      textSpan.focus();
      // 커서를 텍스트 끝으로 이동
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(textSpan);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    textSpan.addEventListener('blur', () => {
      textSpan.contentEditable = 'false';
      textSpan.classList.remove('check-text--editing');
      const newText = textSpan.textContent.trim();
      if (!newText) {
        // 내용이 비면 원래 텍스트로 복원
        textSpan.textContent = c.text;
        return;
      }
      if (newText !== c.text) {
        c.text = newText;
        if (_editingId) _scheduleCheckSave();
      }
    });

    textSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        textSpan.blur();
      }
      if (e.key === 'Escape') {
        textSpan.textContent = c.text; // 변경사항 폐기
        textSpan.blur();
      }
    });

    // ── 삭제 버튼 ────────────────────────────────────────────
    el.querySelector('.check-del-btn').addEventListener('click', (e) => {
      e.stopPropagation(); removeCheck(c.id);
    });

    return el;
  }

  function _updateProgressDisplay() {
    const pct = calcProgress(_checklist);
    document.getElementById('modal-prog-fill').style.width = pct + '%';
    document.getElementById('modal-prog-pct').textContent  = pct + '%';
  }

  // ── 체크 토글 ─────────────────────────────────────────────────
  async function toggleCheck(cid, checked) {
    const c = _checklist.find(x => x.id === cid);
    if (!c) return;
    c.checked = checked;
    c.completed_at = checked ? new Date().toISOString() : null;
    renderChecklist();
    if (!_editingId) return;

    const item = AppState.getById(_editingId);
    const pct  = calcProgress(_checklist);

    if (pct === 100 && item?.status === 'in_progress') {
      // Fix 5: 취소 없음 — 모든 항목 완료 시 무조건 완료 탭으로 이동
      await UI.alertModal('모든 항목을 완료했습니다!\n완료 탭으로 이동합니다.', '확인');
      await _flushSave({ status: 'completed', completed_at: new Date().toISOString() });
      UI.closeModal(document.getElementById('proj-modal'));
      App.updateCounts(); App.switchTab('completed'); return;
    }

    if (!checked && item?.status === 'completed') {
      // Fix 4: 취소 없음 — 완료 탭에서 체크 해제 시 무조건 수정중 탭으로 이동
      await UI.alertModal('완료를 취소하고\n수정중 탭으로 이동합니다.', '확인');
      await _flushSave({ status: 'in_progress', completed_at: null });
      UI.closeModal(document.getElementById('proj-modal'));
      App.updateCounts(); App.switchTab('in_progress'); return;
    }

    _scheduleCheckSave();
  }

  function _scheduleCheckSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _flushSave({}).catch(err => UI.toast('저장 실패: ' + err.message, 'error'));
    }, 800);
  }

  async function _flushSave(extra = {}) {
    if (!_editingId) return;
    const updated = await DB.update(_editingId, { checklist: _checklist, ...extra });
    AppState.updateItem(updated);
    render(AppState.getById(_editingId)?.status || _currentStatus);
    App.updateCounts();
  }

  // ── 체크리스트 추가 ───────────────────────────────────────────
  function addCheck() {
    const input = document.getElementById('checklist-new-input');
    const text  = input.value.trim();
    if (!text) { UI.toast('항목 내용을 입력하세요', 'warn'); return; }
    _checklist.push({ id: UI.genId(), text, checked: false, completed_at: null });
    input.value = '';
    renderChecklist();

    // 스크롤: 새로 추가된 항목(마지막 unchecked)이 보이도록
    const items = document.querySelectorAll('#checklist-items .checklist-item:not(.checklist-item--done)');
    if (items.length) items[items.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    input.focus();
    if (_editingId) {
      const item = AppState.getById(_editingId);
      if (item?.status === 'completed') UI.toast('저장 시 수정중 탭으로 이동됩니다', 'info');
    }
  }

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

    if (_editingId) {
      const item = AppState.getById(_editingId);
      if (item?.status === 'completed' && (pct < 100 || _checklist.some(c => !c.checked))) {
        // Fix 4: 취소 없음 — 완료 항목에서 미완료 체크리스트 있으면 무조건 수정중으로 이동
        await UI.alertModal('완료를 취소하고\n수정중 탭으로 이동합니다.', '확인');
        status = 'in_progress'; completed_at = null;
      }
    }

    if (pct === 100 && status === 'in_progress') {
      // Fix 5: 취소 없음 — 모든 항목 완료 시 무조건 완료 탭으로 이동
      await UI.alertModal('모든 항목을 완료했습니다!\n완료 탭으로 이동합니다.', '확인');
      status = 'completed'; completed_at = new Date().toISOString();
    }

    const payload = { title, memo, checklist: _checklist, status };
    if (status === 'completed' && !completed_at) payload.completed_at = new Date().toISOString();
    else if (status !== 'completed') payload.completed_at = null;
    else payload.completed_at = completed_at;

    if (!_editingId) {
      const existing = AppState.getProjects(status);
      // 수정중 탭 0% 항목은 최신이 아래 → sort_order를 최댓값+1로
      // 완료/아이디어는 기존대로 최상단(min-1)
      let newSortOrder;
      if (status === 'in_progress') {
        const maxOrd = existing.length ? Math.max(...existing.map(i => i.sort_order)) : 0;
        newSortOrder = maxOrd + 1;
      } else {
        const minOrd = existing.length ? Math.min(...existing.map(i => i.sort_order)) : 0;
        newSortOrder = minOrd - 1;
      }
      payload.sort_order = newSortOrder;
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
      if (status !== _currentStatus) App.switchTab(status);
    } catch (e) { UI.toast('저장 실패: ' + e.message, 'error'); }
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
    } catch (e) { UI.toast('삭제 실패: ' + e.message, 'error'); }
  }

  return { render, openEdit, cancelEdit, toggleCheck, addCheck, removeCheck, save, deleteItem, moveItem };
})();
