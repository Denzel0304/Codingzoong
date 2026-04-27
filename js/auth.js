// ============================================================
// auth.js — 인증 모듈
//
// - 이메일/비밀번호 로그인 (Supabase Auth)
// - JWT 자동 갱신: Supabase SDK v2가 내부적으로 처리
//   (토큰 만료 전 자동 갱신, 세션 localStorage 유지)
// - 자동 로그인: 이전 세션이 유효하면 INITIAL_SESSION 이벤트로 복원
// - 갱신 gap 방지: SDK의 refreshSession 타이밍이 맞지 않을 경우
//   대비해 SIGNED_OUT 이벤트 감지 시 즉시 재세션 체크
// ============================================================
const Auth = (() => {
  let _client = null;

  function init(client) {
    _client = client;

    _client.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth]', event, session?.user?.email ?? '비로그인');

      switch (event) {
        case 'INITIAL_SESSION':
          // 페이지 로드 시 기존 세션 확인
          if (session) {
            App.onSignedIn(session.user);
          } else {
            App.onSignedOut();
          }
          break;

        case 'SIGNED_IN':
          App.onSignedIn(session.user);
          break;

        case 'SIGNED_OUT':
          App.onSignedOut();
          break;

        case 'TOKEN_REFRESHED':
          // SDK가 자동으로 처리 — 앱 레벨 추가 처리 불필요
          console.log('[Auth] 토큰 갱신 완료');
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
    // scope: 'local' — 이 기기만 로그아웃 (다른 기기 세션 유지)
    // scope: 'global' (기본값) 은 모든 기기 + 모든 앱을 로그아웃시키므로 사용 금지
    const { error } = await _client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }

  async function getSession() {
    const { data: { session } } = await _client.auth.getSession();
    return session;
  }

  return { init, login, logout, getSession };
})();
