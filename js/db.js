// ============================================================
// db.js — 데이터베이스 모듈
//
// [수정 핵심 — 로컬 우선 + 오프라인 대기열]
//
// 1. localStorage를 1차 저장소로 사용
//    - insert/update/delete → 즉시 localStorage 반영
//    - 화면은 localStorage 기준으로 즉시 렌더
//
// 2. Supabase는 백그라운드 동기화
//    - 온라인이면 즉시 전송
//    - 오프라인이면 _queue(대기열)에 적재
//    - 연결 복구 시 대기열 일괄 flush
//
// 3. Realtime 구독
//    - 다른 기기 변경사항 수신용
//    - visibilitychange로 탭 복귀 시 재연결 (풀로드 없음)
//    - 토큰 갱신으로 인한 CLOSED → SUBSCRIBED 정상 동작
//
// 4. 탭 복귀 시 전략
//    - 마지막 동기화로부터 5분 이상 경과했을 때만 증분 fetch
//    - 그 이하면 로컬 캐시 그대로 사용
// ============================================================
const DB = (() => {
  let _client  = null;
  let _channel = null;
  let _userId  = null;

  // 오프라인 대기열: [{op, id, row, resolve, reject}, ...]
  let _queue   = [];
  let _isFlushing = false;

  // 마지막 서버 동기화 시각 (ms)
  let _lastSyncAt = 0;
  const SYNC_STALE_MS = 5 * 60 * 1000; // 5분

  const LS_KEY = () => `zcoding_cache_${_userId}`;
  const Q_KEY  = () => `zcoding_queue_${_userId}`;

  // ── 초기화 ────────────────────────────────────────────────────
  function init(client, userId) {
    _client = client;
    _userId = userId;
    _queue  = _loadQueue(); // 이전 세션 대기열 복원
  }

  // ── 내부 헬퍼 ─────────────────────────────────────────────────
  function tbl() {
    return _client.from(TABLE_NAME);
  }

  function guard(error) {
    if (error) {
      console.error('[DB Error]', error);
      throw new Error(error.message || '데이터베이스 오류');
    }
  }

  // ── localStorage 캐시 ─────────────────────────────────────────
  function _saveCache(items) {
    try {
      localStorage.setItem(LS_KEY(), JSON.stringify(items));
    } catch (e) {
      console.warn('[DB] 캐시 저장 실패 (용량 초과?)', e);
    }
  }

  function _loadCache() {
    try {
      const raw = localStorage.getItem(LS_KEY());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _clearCache() {
    localStorage.removeItem(LS_KEY());
  }

  // ── 대기열 영속화 ─────────────────────────────────────────────
  function _saveQueue() {
    // resolve/reject는 직렬화 불가 → 제외하고 저장
    const serializable = _queue.map(({ op, id, row }) => ({ op, id, row }));
    try {
      localStorage.setItem(Q_KEY(), JSON.stringify(serializable));
    } catch {}
  }

  function _loadQueue() {
    try {
      const raw = localStorage.getItem(Q_KEY());
      if (!raw) return [];
      // 복원된 항목은 resolve/reject 없음 → flush 시 fire-and-forget
      return JSON.parse(raw).map(item => ({ ...item, resolve: null, reject: null }));
    } catch { return []; }
  }

  function _clearQueue() {
    _queue = [];
    localStorage.removeItem(Q_KEY());
  }

  // ── 전체 로드 (앱 시작 시 1회) ────────────────────────────────
  // 1) localStorage 캐시가 있으면 즉시 반환 (화면 빠르게 표시)
  // 2) 백그라운드로 서버 데이터 가져와 캐시 갱신
  async function loadAll(onUpdate) {
    const cached = _loadCache();

    // 로컬 캐시를 먼저 즉시 반환
    const initial = cached || [];

    // 백그라운드로 서버 동기화 (대기열 flush 후)
    _syncFromServer(onUpdate).catch(e => {
      console.warn('[DB] 서버 동기화 실패 (오프라인?)', e.message);
    });

    return initial;
  }

  async function _syncFromServer(onUpdate) {
    await _flushQueue(); // 대기열 먼저 서버에 전송
    const { data, error } = await tbl()
      .select('*')
      .eq('user_id', _userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    guard(error);
    const items = data || [];
    _saveCache(items);
    _lastSyncAt = Date.now();
    if (typeof onUpdate === 'function') onUpdate(items);
  }

  // ── 증분 동기화 (탭 복귀 시) ─────────────────────────────────
  // 5분 이상 경과 시에만 서버에서 최신 데이터를 가져옴
  async function syncIfStale(onUpdate) {
    const elapsed = Date.now() - _lastSyncAt;
    if (elapsed < SYNC_STALE_MS) {
      console.log('[DB] 캐시 신선함 — 재로드 생략', Math.round(elapsed/1000) + 's');
      return false;
    }
    console.log('[DB] 캐시 오래됨 — 증분 동기화 시작');
    await _syncFromServer(onUpdate);
    return true;
  }

  // ── 단건 삽입 ─────────────────────────────────────────────────
  async function insert(row) {
    const tempId = 'tmp_' + UI.genId();
    const tempRow = { ...row, id: tempId, user_id: _userId,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                      sort_order: row.sort_order ?? 0 };

    // 1. 즉시 로컬 반영
    const cached = _loadCache() || [];
    _saveCache([tempRow, ...cached]);

    // 2. 서버 전송 (온라인이면 즉시, 오프라인이면 대기열)
    return _enqueue('INSERT', tempId, { ...row, user_id: _userId }, (serverRow) => {
      // 서버 응답으로 tempId → 실제 id 교체
      const c = _loadCache() || [];
      const idx = c.findIndex(x => x.id === tempId);
      if (idx >= 0) c[idx] = serverRow;
      _saveCache(c);
      AppState.updateItem(serverRow);
      AppState.removeItem(tempId);
      return serverRow;
    }, tempRow);
  }

  // ── 단건 수정 ─────────────────────────────────────────────────
  async function update(id, changes) {
    // 1. 즉시 로컬 반영
    const cached = _loadCache() || [];
    const idx = cached.findIndex(x => x.id === id);
    const merged = idx >= 0
      ? { ...cached[idx], ...changes, updated_at: new Date().toISOString() }
      : null;
    if (merged) { cached[idx] = merged; _saveCache(cached); }

    // 2. 서버 전송
    return _enqueue('UPDATE', id, changes, null, merged);
  }

  // ── 단건 삭제 ─────────────────────────────────────────────────
  async function remove(id) {
    // 1. 즉시 로컬 반영
    const cached = (_loadCache() || []).filter(x => x.id !== id);
    _saveCache(cached);

    // 2. 서버 전송
    return _enqueue('DELETE', id, null, null, null);
  }

  // ── sort_order 일괄 업데이트 ──────────────────────────────────
  async function updateSortOrders(items) {
    if (!items || !items.length) return;

    // 로컬 반영
    const cached = _loadCache() || [];
    items.forEach(({ id, sort_order }) => {
      const it = cached.find(x => x.id === id);
      if (it) it.sort_order = sort_order;
    });
    _saveCache(cached);

    // 서버 전송 (sort_order는 실시간성이 낮으므로 fire-and-forget)
    if (navigator.onLine) {
      Promise.all(
        items.map(({ id, sort_order }) =>
          tbl().update({ sort_order }).eq('id', id).eq('user_id', _userId)
        )
      ).catch(e => console.warn('[DB] sort_order 저장 실패', e));
    } else {
      // 오프라인 시 각 항목을 UPDATE 대기열에 적재
      items.forEach(({ id, sort_order }) => {
        _queue.push({ op: 'UPDATE', id, row: { sort_order }, resolve: null, reject: null });
      });
      _saveQueue();
    }
  }

  // ── 대기열 등록 및 즉시 시도 ─────────────────────────────────
  function _enqueue(op, id, row, transformer, localResult) {
    return new Promise((resolve, reject) => {
      const entry = { op, id, row, resolve, reject, transformer, localResult };
      _queue.push(entry);
      _saveQueue();

      if (navigator.onLine) {
        _flushQueue().catch(() => {});
      } else {
        // 오프라인: 로컬 결과로 즉시 resolve
        console.log('[DB] 오프라인 — 대기열 적재:', op, id);
        _queue = _queue.filter(x => x !== entry);
        _saveQueue();
        resolve(localResult);
      }
    });
  }

  // ── 대기열 flush (순서 보장) ──────────────────────────────────
  async function _flushQueue() {
    if (_isFlushing) return;
    if (!_queue.length) return;
    _isFlushing = true;

    console.log('[DB] 대기열 flush 시작 —', _queue.length, '건');

    // 처리할 항목을 스냅샷 (flush 중 새 항목 추가 허용)
    const pending = [..._queue];
    _queue = _queue.filter(x => !pending.includes(x));
    _saveQueue();

    for (const entry of pending) {
      try {
        let serverRow = null;

        if (entry.op === 'INSERT') {
          const { data, error } = await tbl()
            .insert(entry.row)
            .select()
            .single();
          guard(error);
          serverRow = data;
          if (typeof entry.transformer === 'function') {
            entry.transformer(serverRow);
          }
        } else if (entry.op === 'UPDATE') {
          const { data, error } = await tbl()
            .update(entry.row)
            .eq('id', entry.id)
            .eq('user_id', _userId)
            .select()
            .single();
          guard(error);
          serverRow = data;
        } else if (entry.op === 'DELETE') {
          const { error } = await tbl()
            .delete()
            .eq('id', entry.id)
            .eq('user_id', _userId);
          guard(error);
        }

        if (entry.resolve) entry.resolve(serverRow ?? entry.localResult);
      } catch (e) {
        console.warn('[DB] 대기열 항목 실패 — 재적재:', entry.op, entry.id, e.message);
        // 실패 시 다시 대기열 앞에 삽입
        _queue.unshift({ ...entry });
        _saveQueue();
        if (entry.resolve) entry.resolve(entry.localResult); // 로컬 결과로 우선 resolve
        break; // 이후 항목도 실패 가능성 높으므로 중단
      }
    }

    _isFlushing = false;
    console.log('[DB] 대기열 flush 완료');
  }

  // ── Realtime 구독 ─────────────────────────────────────────────
  function subscribeToChanges(callback) {
    _unsubscribeInternal();

    _channel = _client
      .channel('zcoding-realtime-' + _userId)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  TABLE_NAME,
          filter: `user_id=eq.${_userId}`,
        },
        (payload) => {
          console.log('[Realtime]', payload.eventType);

          // Realtime 수신 → 로컬 캐시도 업데이트
          const cached = _loadCache() || [];
          if (payload.eventType === 'INSERT') {
            if (!cached.find(x => x.id === payload.new.id)) {
              _saveCache([payload.new, ...cached]);
            }
          } else if (payload.eventType === 'UPDATE') {
            const idx = cached.findIndex(x => x.id === payload.new.id);
            if (idx >= 0) cached[idx] = payload.new;
            else cached.unshift(payload.new);
            _saveCache(cached);
          } else if (payload.eventType === 'DELETE') {
            _saveCache(cached.filter(x => x.id !== payload.old.id));
          }

          callback(payload);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] 구독 상태:', status);
        // SUBSCRIBED 상태가 되면 대기열 flush 시도
        if (status === 'SUBSCRIBED') {
          _flushQueue().catch(() => {});
        }
      });
  }

  function _unsubscribeInternal() {
    if (_channel) {
      _client.removeChannel(_channel);
      _channel = null;
    }
  }

  function unsubscribe() {
    _unsubscribeInternal();
    _clearQueue();
    _clearCache();
  }

  // ── 네트워크 복구 감지 ────────────────────────────────────────
  function setupNetworkListener() {
    window.addEventListener('online', () => {
      console.log('[DB] 네트워크 복구 — 대기열 flush');
      UI.toast('인터넷 연결 복구 — 동기화 중…', 'info');
      _flushQueue().then(() => {
        if (_queue.length === 0) UI.toast('동기화 완료', 'success');
      }).catch(() => {});
    });

    window.addEventListener('offline', () => {
      console.log('[DB] 오프라인 전환');
      UI.toast('오프라인 모드 — 로컬에 저장됩니다', 'warn');
    });
  }

  return {
    init,
    loadAll,
    syncIfStale,
    insert, update, remove,
    updateSortOrders,
    subscribeToChanges,
    unsubscribe,
    setupNetworkListener,
  };
})();
