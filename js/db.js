// ============================================================
// db.js — 데이터베이스 모듈 (Supabase REST + Realtime)
//
// - 모든 쿼리는 인증된 클라이언트를 통해 실행
// - RLS가 user_id를 자동 검증하지만, .eq('user_id', _userId) 이중 보호
// - Realtime: postgres_changes 구독으로 멀티디바이스 동기화
// ============================================================
const DB = (() => {
  let _client  = null;
  let _channel = null;
  let _userId  = null;

  // ── 초기화 ────────────────────────────────────────────────────
  function init(client, userId) {
    _client = client;
    _userId = userId;
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

  // ── 전체 로드 (앱 시작 시 1회) ────────────────────────────────
  async function loadAll() {
    const { data, error } = await tbl()
      .select('*')
      .eq('user_id', _userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    guard(error);
    return data || [];
  }

  // ── 단건 삽입 ─────────────────────────────────────────────────
  async function insert(row) {
    const { data, error } = await tbl()
      .insert({ ...row, user_id: _userId })
      .select()
      .single();
    guard(error);
    return data;
  }

  // ── 단건 수정 ─────────────────────────────────────────────────
  async function update(id, changes) {
    const { data, error } = await tbl()
      .update(changes)
      .eq('id', id)
      .eq('user_id', _userId)   // RLS 이중 보호
      .select()
      .single();
    guard(error);
    return data;
  }

  // ── 단건 삭제 ─────────────────────────────────────────────────
  async function remove(id) {
    const { error } = await tbl()
      .delete()
      .eq('id', id)
      .eq('user_id', _userId);
    guard(error);
  }

  // ── sort_order 일괄 업데이트 (드래그 후) ──────────────────────
  // items: [{id, sort_order}, ...]
  async function updateSortOrders(items) {
    if (!items || !items.length) return;
    await Promise.all(
      items.map(({ id, sort_order }) =>
        tbl()
          .update({ sort_order })
          .eq('id', id)
          .eq('user_id', _userId)
      )
    );
  }

  // ── Realtime 구독 ─────────────────────────────────────────────
  function subscribeToChanges(callback) {
    if (_channel) {
      _client.removeChannel(_channel);
      _channel = null;
    }

    _channel = _client
      .channel('zcoding-realtime')
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  TABLE_NAME,
          filter: `user_id=eq.${_userId}`,
        },
        (payload) => {
          console.log('[Realtime]', payload.eventType, payload);
          callback(payload);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] 구독 상태:', status);
      });
  }

  function unsubscribe() {
    if (_channel) {
      _client.removeChannel(_channel);
      _channel = null;
    }
  }

  return { init, loadAll, insert, update, remove, updateSortOrders, subscribeToChanges, unsubscribe };
})();
