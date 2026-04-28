// ============================================================
// ui.js — UI 유틸리티
// - 토스트 / 확인 모달 / 범용 모달 열기·닫기
// - 날짜 포맷 / 태그 파싱 / XSS 이스케이프
// - 드래그&드롭 (터치 + 마우스 동시 지원)
// ============================================================
const UI = (() => {

  // ── 토스트 ───────────────────────────────────────────────────
  function toast(msg, type = 'info') {
    // 기존 토스트 제거
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `<span>${escHtml(msg)}</span>`;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('toast--show'));
    });

    setTimeout(() => {
      el.classList.remove('toast--show');
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  // ── 확인 모달 (Promise 기반) ─────────────────────────────────
  function confirm(message, confirmText = '확인', cancelText = '취소') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-box">
          <p class="confirm-msg">${escHtml(message).replace(/\n/g, '<br>')}</p>
          <div class="confirm-btns">
            <button class="confirm-cancel">${escHtml(cancelText)}</button>
            <button class="confirm-ok">${escHtml(confirmText)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add('confirm-overlay--show'));
      });

      const close = (val) => {
        overlay.classList.remove('confirm-overlay--show');
        setTimeout(() => overlay.remove(), 250);
        resolve(val);
      };

      overlay.querySelector('.confirm-ok').onclick     = () => close(true);
      overlay.querySelector('.confirm-cancel').onclick = () => close(false);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    });
  }

  // ── 범용 모달 ────────────────────────────────────────────────
  function openModal(el) {
    el.classList.add('modal--active');
    document.body.classList.add('no-scroll');
  }

  function closeModal(el) {
    el.classList.remove('modal--active');
    document.body.classList.remove('no-scroll');
  }

  // ── 날짜 포맷 ────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function formatDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())}`;
  }

  // ── 태그 ─────────────────────────────────────────────────────
  function parseTags(str) {
    if (!str) return [];
    return str.split(',').map(t => t.trim()).filter(Boolean);
  }

  function tagsToString(arr) {
    return (arr || []).join(', ');
  }

  function renderTags(arr) {
    if (!arr || !arr.length) return '';
    return arr.map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
  }

  // ── XSS 방지 ─────────────────────────────────────────────────
  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── 드래그 & 드롭 (터치 + 마우스) ───────────────────────────
  // onDragStart / onDragEnd: 드래그 상태를 외부에서 추적하기 위한 콜백
  // projects.js의 _isDragging 플래그와 연동 — Realtime render() 재호출 차단용
  function makeDraggable(listEl, onReorder, onDragStart, onDragEnd) {
    // 이전 호출의 모든 리스너(listEl + document) 한 번에 제거
    if (listEl._dragAbort) listEl._dragAbort.abort();
    const ac     = new AbortController();
    const sig    = ac.signal;
    listEl._dragAbort = ac;

    let dragging  = null;
    let indicator = null;
    let animFrame = null;

    function clientY(e) {
      return e.touches ? e.touches[0].clientY : e.clientY;
    }

    function getItems() {
      return Array.from(listEl.querySelectorAll(':scope > .sortable-item'));
    }

    function ensureIndicator() {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
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
      for (const item of getItems()) {
        if (item === dragging || item === ind) continue;
        const r = item.getBoundingClientRect();
        if (y < r.top + r.height * 0.5) { before = item; break; }
      }
      if (ind.parentNode) ind.parentNode.removeChild(ind);
      if (before) listEl.insertBefore(ind, before);
      else        listEl.appendChild(ind);
    }

    function onStart(e) {
      if (!e.target.closest('.drag-handle')) return;
      e.preventDefault();
      dragging = e.target.closest('.sortable-item');
      if (!dragging) return;
      dragging.classList.add('dragging');
      listEl.classList.add('list--dragging');
      document.body.style.userSelect = 'none';
      placeIndicator(clientY(e));
      if (typeof onDragStart === 'function') onDragStart(); // ★ 드래그 시작 알림
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const y = clientY(e);
      if (y < 120)                     window.scrollBy(0, -8);
      if (y > window.innerHeight - 80) window.scrollBy(0,  8);
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(() => { if (dragging) placeIndicator(y); });
    }

    function onEnd() {
      if (!dragging) return;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      if (indicator && indicator.parentNode) listEl.insertBefore(dragging, indicator);
      removeIndicator();
      dragging.classList.remove('dragging');
      listEl.classList.remove('list--dragging');
      document.body.style.userSelect = '';
      const newOrder = getItems().map((el, i) => ({ id: el.dataset.id, sort_order: i }));
      if (typeof onDragEnd === 'function') onDragEnd(); // ★ 드래그 종료 알림
      onReorder(newOrder).catch(() => UI.toast('순서 저장 실패', 'error'));
      dragging = null;
    }

    const opt = { signal: sig };
    listEl.addEventListener('dragstart',  (e) => e.preventDefault(), opt);
    listEl.addEventListener('mousedown',  onStart, opt);
    listEl.addEventListener('touchstart', onStart, { ...opt, passive: false });
    listEl.addEventListener('touchmove',  onMove,  { ...opt, passive: false });
    listEl.addEventListener('touchend',   onEnd,   opt);
    // touchcancel: 드래그 중 브라우저가 터치를 취소할 때 — 상태만 정리, 저장 안 함
    listEl.addEventListener('touchcancel', () => {
      if (!dragging) return;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      removeIndicator();
      dragging.classList.remove('dragging');
      listEl.classList.remove('list--dragging');
      document.body.style.userSelect = '';
      if (typeof onDragEnd === 'function') onDragEnd(); // ★
      dragging = null;
    }, opt);
    // contextmenu는 document에서 차단 — listEl만 막으면 브라우저가 먼저 처리
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.drag-handle') || dragging) e.preventDefault();
    }, { signal: sig });
    document.addEventListener('mousemove', (e) => { if (dragging) onMove(e); }, opt);
    document.addEventListener('mouseup',   ()  => { if (dragging) onEnd();   }, opt);
  }

  // ── ID 생성 ──────────────────────────────────────────────────
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── 메모 자동넘버링 + 링크 미리보기 ─────────────────────────
  // textarea에 연결. 한 번만 바인딩 (중복 방지용 플래그).
  function setupMemoFeatures(textarea) {
    if (!textarea || textarea._memoFeaturesReady) return;
    textarea._memoFeaturesReady = true;

    // ── 1. 자동 넘버링 ──────────────────────────────────────────
    // "숫자." 으로 시작하는 줄에서 Enter → 다음 번호 자동 삽입
    // 빈 번호 줄(예: "3. " 만 있을 때)에서 Enter → 번호 줄 제거
    textarea.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;

      const val   = textarea.value;
      const pos   = textarea.selectionStart;
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const line  = val.substring(lineStart, pos);

      // "숫자. " 패턴 (숫자 뒤 점, 그 뒤 공백)
      const m = line.match(/^(\d+)\.\s(.*)$/);
      if (!m) return; // 넘버링 줄 아님 → 기본 Enter

      e.preventDefault();

      const num  = parseInt(m[1], 10);
      const text = m[2];

      if (!text.trim()) {
        // 빈 번호 줄 → 번호 제거 후 빈 줄로
        const before = val.substring(0, lineStart);
        const after  = val.substring(pos);
        textarea.value = before + after;
        textarea.selectionStart = textarea.selectionEnd = lineStart;
      } else {
        // 다음 번호 삽입
        const insert = '\n' + (num + 1) + '. ';
        const before = val.substring(0, pos);
        const after  = val.substring(pos);
        textarea.value = before + insert + after;
        textarea.selectionStart = textarea.selectionEnd = pos + insert.length;
      }

      // 링크 미리보기 갱신
      _updateLinkPreview(textarea);
    });

    // " " (스페이스) 입력 감지: "숫자." 뒤 스페이스 → 넘버링 시작
    textarea.addEventListener('input', () => {
      _updateLinkPreview(textarea);
    });

    // 초기 링크 미리보기
    _updateLinkPreview(textarea);
  }

  // ── 링크 미리보기 (textarea 바로 아래 삽입) ─────────────────
  function _updateLinkPreview(textarea) {
    // 기존 미리보기 제거
    let preview = textarea._linkPreview;
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'memo-link-preview';
      textarea.parentNode.insertBefore(preview, textarea.nextSibling);
      textarea._linkPreview = preview;
    }

    const text = textarea.value;
    // http:// 또는 https:// 로 시작하는 URL 추출 (대소문자 무관)
    const urlRegex = /https?:\/\/[^\s\u3000\u00a0<>"']+/gi;
    const urls = [...new Set(text.match(urlRegex) || [])];

    if (!urls.length) {
      preview.style.display = 'none';
      preview.innerHTML = '';
      return;
    }

    preview.style.display = 'flex';
    preview.innerHTML = urls.map(url => {
      let domain = '';
      try { domain = new URL(url).hostname; } catch { domain = url.slice(0, 30); }
      return `<a class="memo-link-item" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">
        🔗 <span class="memo-link-domain">${escHtml(domain)}</span>
        <span class="memo-link-url">${escHtml(url.length > 50 ? url.slice(0, 50) + '…' : url)}</span>
      </a>`;
    }).join('');
  }

  return {
    toast, confirm,
    openModal, closeModal,
    formatDate, formatDateShort,
    parseTags, tagsToString, renderTags,
    escHtml,
    makeDraggable,
    genId,
    setupMemoFeatures,
  };
})();
