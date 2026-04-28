// ============================================================
// app.js — 메인 앱 (AppState + App 초기화 + 탭 라우팅 + Realtime)
//
// [수정 핵심]
// 1. onSignedIn → localStorage 캐시 즉시 렌더 (화면 빠름)
//    → 백그라운드로 서버 동기화 (로딩 스피너 없음)
// 2. visibilitychange → 탭 복귀 시 5분 미경과면 재로드 안 함
//    → 불필요한 "불러오는 중…" 제거
// 3. Realtime CLOSED/SUBSCRIBED 반복은 토큰 갱신 정상 동작
//    → 앱 레벨에서 별도 처리 불필요 (auth.js에서 _isSignedIn 플래그로 제어)
// 4. 네트워크 복구 → 대기열 자동 flush (db.js 처리)
// ============================================================

// ── 앱 전역 상태 캐시 ─────────────────────────────────────────
const AppState = (() => {
  let _items = [];

  function init(items)   { _items = Array.isArray(items) ? items : []; }
  function getAll()      { return _items; }
  function getById(id)   { return _items.find(x => x.id === id) ?? null; }

  function getProjects(status) {
    return _items.filter(x => x.type === 'project' && x.status === status);
  }
  function getCodes()  { return _items.filter(x => x.type === 'code'); }
  function getMemos()  { return _items.filter(x => x.type === 'memo'); }

  function addItem(item) {
    if (!_items.find(x => x.id === item.id)) _items.unshift(item);
  }
  function updateItem(item) {
    const idx = _items.findIndex(x => x.id === item.id);
    if (idx >= 0) _items[idx] = item;
    else          _items.unshift(item);
  }
  function removeItem(id) { _items = _items.filter(x => x.id !== id); }

  return { init, getAll, getById, getProjects, getCodes, getMemos, addItem, updateItem, removeItem };
})();

// ── 메인 앱 ───────────────────────────────────────────────────
const App = (() => {
  let _supabase   = null;
  let _currentTab = 'home';
  let _initialized = false; // onSignedIn 중복 실행 방지용 (auth.js와 이중 보호)

  // ── 초기화 ───────────────────────────────────────────────────
  async function init() {
    if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
      document.getElementById('config-warning').style.display = 'block';
      return;
    }

    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession:     true,   // 세션 localStorage 유지 (자동 로그인)
        autoRefreshToken:   true,   // 토큰 자동 갱신
        detectSessionInUrl: false,  // 소셜 로그인 미사용
      },
    });

    Auth.init(_supabase);
    DB.setupNetworkListener(); // 온/오프라인 감지
    _bindEvents();
    Code.setupCodeEditor();
    _setupVisibilityChange(); // 탭 복귀 감지
  }

  // ── 로그인 성공 ──────────────────────────────────────────────
  // auth.js의 _isSignedIn 플래그로 1차 보호, _initialized로 2차 보호
  async function onSignedIn(user) {
    if (_initialized) return;
    _initialized = true;

    DB.init(_supabase, user.id);
    _showScreen('app');

    // 1. localStorage 캐시로 즉시 렌더 (스피너 없음)
    const items = await DB.loadAll((serverItems) => {
      // 2. 백그라운드 서버 동기화 완료 → AppState 갱신 및 현재 뷰 리렌더
      AppState.init(serverItems);
      updateCounts();
      _rerenderCurrentTab();
      console.log('[App] 서버 동기화 완료 —', serverItems.length, '건');
    });

    AppState.init(items);
    updateCounts();
    switchTab('home');

    // 3. Realtime 구독 (다른 기기 변경 수신용)
    DB.subscribeToChanges(_handleRealtime);
  }

  // ── 로그아웃 ─────────────────────────────────────────────────
  function onSignedOut() {
    _initialized = false;
    DB.unsubscribe();
    AppState.init([]);
    _showScreen('login');
    document.getElementById('login-pw').value = '';
  }

  // ── visibilitychange: 탭 복귀 시 스마트 동기화 ───────────────
  function _setupVisibilityChange() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;           // 탭 숨김 시 무시
      if (!_initialized) return;            // 로그인 전 무시

      console.log('[App] 탭 복귀 — 동기화 체크');
      // 5분 미경과 → 재로드 없음 (불필요한 "불러오는 중…" 제거)
      const updated = await DB.syncIfStale((serverItems) => {
        AppState.init(serverItems);
        updateCounts();
        _rerenderCurrentTab();
        console.log('[App] 탭 복귀 동기화 완료');
      });

      if (!updated) {
        console.log('[App] 탭 복귀 — 캐시 신선함, 재렌더 생략');
      }
    });
  }

  // ── 화면 전환 ────────────────────────────────────────────────
  function _showScreen(name) {
    document.getElementById('screen-login').style.display = name === 'login' ? 'flex' : 'none';
    document.getElementById('screen-app').style.display   = name === 'app'   ? 'flex' : 'none';
  }

  // loader는 더 이상 사용하지 않지만 HTML 호환성을 위해 유지
  function _showLoader(show) {
    const el = document.getElementById('app-loader');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  // ── 탭 전환 ──────────────────────────────────────────────────
  function switchTab(tab) {
    _currentTab = tab;

    document.querySelectorAll('.view').forEach(el => el.classList.remove('view--active'));
    const viewMap = {
      home:        'view-home',
      in_progress: 'view-projects',
      completed:   'view-projects',
      pending:     'view-projects',
      code:        'view-code',
      memo:        'view-memo',
    };
    const viewEl = document.getElementById(viewMap[tab] || 'view-home');
    if (viewEl) viewEl.classList.add('view--active');

    document.querySelectorAll('.tab-btn').forEach(el => {
      el.classList.toggle('tab-btn--active', el.dataset.tab === tab);
    });

    const showFab = ['in_progress','pending','code','memo'].includes(tab); // completed 제외
    document.getElementById('fab-add').style.display = showFab ? 'flex' : 'none';

    document.getElementById('search-bar-code').style.display = tab === 'code' ? 'flex' : 'none';
    document.getElementById('search-bar-memo').style.display = tab === 'memo' ? 'flex' : 'none';

    const projTitleEl = document.getElementById('project-view-title');
    if (projTitleEl) {
      const titleMap = { in_progress: '⚙️ 수정중', completed: '🏆 완료', pending: '💡 아이디어' };
      projTitleEl.textContent = titleMap[tab] || '';
      projTitleEl.style.display = titleMap[tab] ? 'block' : 'none';
    }

    _rerenderCurrentTab();
  }

  // ── 현재 탭 리렌더 (내부 헬퍼) ───────────────────────────────
  function _rerenderCurrentTab() {
    if (['in_progress','completed','pending'].includes(_currentTab)) {
      Projects.render(_currentTab);
    } else if (_currentTab === 'code') {
      Code.render();
    } else if (_currentTab === 'memo') {
      Memo.render();
    }
  }

  // ── 홈 카운트 업데이트 ───────────────────────────────────────
  function updateCounts() {
    const ip = AppState.getProjects('in_progress').length;
    const cp = AppState.getProjects('completed').length;
    const pd = AppState.getProjects('pending').length;

    _setBadge('badge-inprogress', ip);
    _setBadge('badge-completed',  cp);
    _setBadge('badge-pending',    pd);
  }

  function _setBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  }

  // ── Realtime 처리 ─────────────────────────────────────────────
  // 다른 기기에서의 변경사항만 처리
  // (내 기기 변경은 insert/update/remove 호출 시 이미 AppState 반영됨)
  function _handleRealtime(payload) {
    const { eventType, new: newRow, old: oldRow } = payload;

    // 내 기기에서 발생한 임시 ID 항목은 이미 처리됨 → 무시
    if (newRow?.id?.startsWith('tmp_')) return;

    if (eventType === 'INSERT') {
      // 이미 존재하는 항목이면 무시 (내 기기 삽입의 Realtime echo)
      if (AppState.getById(newRow.id)) return;
      AppState.addItem(newRow);
    } else if (eventType === 'UPDATE') {
      AppState.updateItem(newRow);
    } else if (eventType === 'DELETE') {
      AppState.removeItem(oldRow.id);
    }

    updateCounts();
    _rerenderCurrentTab();
  }

  // ── 이벤트 바인딩 ────────────────────────────────────────────
  function _bindEvents() {

    // 로그인 폼
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pw    = document.getElementById('login-pw').value;
      const btn   = document.getElementById('login-btn');
      const err   = document.getElementById('login-error');

      const LOCK_KEY     = 'login_lock';
      const ATTEMPT_KEY  = 'login_attempts';
      const MAX_ATTEMPTS = 5;
      const LOCK_MINUTES = 10;

      const lockUntil = parseInt(localStorage.getItem(LOCK_KEY) || '0', 10);
      if (lockUntil && Date.now() < lockUntil) {
        const remaining = Math.ceil((lockUntil - Date.now()) / 60000);
        err.textContent = `로그인 ${MAX_ATTEMPTS}회 실패. ${remaining}분 후 다시 시도하세요.`;
        return;
      }

      btn.disabled    = true;
      btn.textContent = '로그인 중…';
      err.textContent = '';

      try {
        await Auth.login(email, pw);
        localStorage.removeItem(LOCK_KEY);
        localStorage.removeItem(ATTEMPT_KEY);
      } catch (ex) {
        const attempts = parseInt(localStorage.getItem(ATTEMPT_KEY) || '0', 10) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          localStorage.setItem(LOCK_KEY, String(Date.now() + LOCK_MINUTES * 60 * 1000));
          localStorage.setItem(ATTEMPT_KEY, '0');
          err.textContent = `비밀번호 ${MAX_ATTEMPTS}회 오류. ${LOCK_MINUTES}분간 로그인이 잠깁니다.`;
        } else {
          localStorage.setItem(ATTEMPT_KEY, String(attempts));
          err.textContent = `이메일 또는 비밀번호가 틀렸습니다. (${attempts}/${MAX_ATTEMPTS})`;
        }
        btn.disabled    = false;
        btn.textContent = '로그인';
      }
    });

    // 홈 버튼
    document.getElementById('btn-home').addEventListener('click', () => switchTab('home'));

    // 설정 드로어
    const drawer  = document.getElementById('settings-drawer');
    const overlay = document.getElementById('drawer-overlay');

    function openDrawer() {
      drawer.classList.add('drawer--open');
      overlay.classList.add('drawer--open');
      document.body.classList.add('no-scroll');
      history.pushState({ drawer: true }, '');
    }

    function closeDrawer() {
      drawer.classList.remove('drawer--open');
      overlay.classList.remove('drawer--open');
      document.body.classList.remove('no-scroll');
    }

    window.addEventListener('popstate', () => {
      if (drawer.classList.contains('drawer--open')) closeDrawer();
    });

    document.getElementById('btn-settings').addEventListener('click', openDrawer);
    document.getElementById('drawer-close').addEventListener('click', () => {
      closeDrawer();
      if (history.state && history.state.drawer) history.back();
    });
    overlay.addEventListener('click', () => {
      closeDrawer();
      if (history.state && history.state.drawer) history.back();
    });

    // 홈 원형 클릭 → 탭 이동
    ['badge-inprogress','badge-completed','badge-pending'].forEach(badgeId => {
      const tabMap = { 'badge-inprogress': 'in_progress', 'badge-completed': 'completed', 'badge-pending': 'pending' };
      const ring = document.getElementById(badgeId)?.closest('.circle-ring');
      if (ring) {
        ring.style.cursor = 'pointer';
        ring.addEventListener('click', () => switchTab(tabMap[badgeId]));
      }
    });

    // 로그아웃
    document.getElementById('btn-logout').addEventListener('click', async () => {
      closeDrawer();
      const ok = await UI.confirm('로그아웃 하시겠습니까?');
      if (ok) {
        try { await Auth.logout(); }
        catch (e) { UI.toast('로그아웃 실패: ' + e.message, 'error'); }
      }
    });

    // 하단 탭
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 앱 로고 → 홈
    document.getElementById('app-logo').addEventListener('click', () => switchTab('home'));

    // FAB (+)
    document.getElementById('fab-add').addEventListener('click', () => {
      if (['in_progress','completed','pending'].includes(_currentTab)) {
        Projects.openEdit(null);
      } else if (_currentTab === 'code') {
        Code.openEdit(null);
      } else if (_currentTab === 'memo') {
        Memo.openEdit(null);
      }
    });

    // 프로젝트 모달
    document.getElementById('proj-save-btn').addEventListener('click',  () => Projects.save());
    document.getElementById('proj-close-btn').addEventListener('click', () => UI.closeModal(document.getElementById('proj-modal')));
    document.getElementById('proj-modal').addEventListener('click', (e) => {
      if (e.target.id === 'proj-modal') UI.closeModal(e.target);
    });

    document.getElementById('checklist-add-btn').addEventListener('click', () => Projects.addCheck());
    document.getElementById('checklist-new-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); Projects.addCheck(); }
    });

    // 코드 모달
    document.getElementById('code-save-btn').addEventListener('click',   () => Code.save());
    document.getElementById('code-close-btn').addEventListener('click',  () => UI.closeModal(document.getElementById('code-modal')));
    document.getElementById('code-toggle-btn').addEventListener('click', () => Code.togglePreview());
    document.getElementById('code-copy-btn').addEventListener('click',   () => Code.copyCode());
    document.getElementById('code-modal').addEventListener('click', (e) => {
      if (e.target.id === 'code-modal') UI.closeModal(e.target);
    });

    document.getElementById('code-search-input').addEventListener('input', (e) => {
      Code.search(e.target.value);
    });

    // 메모 모달
    document.getElementById('memo-save-btn').addEventListener('click',  () => Memo.save());
    document.getElementById('memo-close-btn').addEventListener('click', () => UI.closeModal(document.getElementById('memo-modal')));
    document.getElementById('memo-modal').addEventListener('click', (e) => {
      if (e.target.id === 'memo-modal') UI.closeModal(e.target);
    });

    document.getElementById('memo-search-input').addEventListener('input', (e) => {
      Memo.search(e.target.value);
    });

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      ['proj-modal','code-modal','memo-modal'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.classList.contains('modal--active')) UI.closeModal(el);
      });
    });
  }

  return { init, onSignedIn, onSignedOut, switchTab, updateCounts };
})();

// ── 앱 시작 ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
