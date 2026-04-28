// ============================================================
// auth.js — 인증 모듈
//
// [수정 핵심]
// - SIGNED_IN 이벤트가 토큰 갱신마다 반복 발생하는 문제 수정
//   → _isSignedIn 플래그로 최초 1회만 onSignedIn() 호출
// - TOKEN_REFRESHED: 세션만 유지, 풀로드·재구독 없음
// - SIGNED_OUT: 로컬 캐시 및 대기열도 함께 정리
// ============================================================
const Auth = (() => {
  let _client    = null;
  let _isSignedIn = false; // 이미 로그인 처리된 상태인지 추적

  function init(client) {
    _client = client;

    _client.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth]', event, session?.user?.email ?? '비로그인');

      switch (event) {
        case 'INITIAL_SESSION':
          // 페이지 로드 시 기존 세션 확인 — 항상 처리
          if (session) {
            _isSignedIn = true;
            App.onSignedIn(session.user);
          } else {
            _isSignedIn = false;
            App.onSignedOut();
          }
          break;

        case 'SIGNED_IN':
          // 토큰 갱신 후에도 SIGNED_IN이 재발화됨
          // → 이미 로그인 상태면 무시 (풀로드·재구독 방지)
          if (!_isSignedIn) {
            _isSignedIn = true;
            App.onSignedIn(session.user);
          }
          break;

        case 'SIGNED_OUT':
          _isSignedIn = false;
          App.onSignedOut();
          break;

        case 'TOKEN_REFRESHED':
          // SDK 자동 처리 — 앱 레벨 추가 처리 불필요
          // Realtime 채널은 토큰 갱신 후 자동으로 재인증됨
          console.log('[Auth] 토큰 갱신 완료 — 재로드 없음');
          break;

        case 'USER_UPDATED':
          console.log('[Auth] 사용자 정보 업데이트');
          break;
      }
    });
  }

  async function login(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return data;
  }

  async function logout() {
    _isSignedIn = false;
    // scope: 'local' — 이 기기만 로그아웃
    const { error } = await _client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }

  async function getSession() {
    const { data: { session } } = await _client.auth.getSession();
    return session;
  }

  return { init, login, logout, getSession };
})();
