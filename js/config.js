// ============================================================
// config.js — Supabase 연결 설정
//
// ⚠️  아래 두 값을 실제 프로젝트 값으로 교체하세요.
//    Supabase 대시보드 → Settings → API
//
// [보안 설명]
// - SUPABASE_URL / SUPABASE_ANON: GitHub에 공개되어도 안전합니다.
//   anon 키는 RLS + JWT 인증 없이는 데이터에 접근할 수 없습니다.
// - 실제 데이터는 로그인한 사용자의 JWT 토큰이 있어야만 접근 가능.
// - RLS 정책으로 타 사용자 데이터 접근 완전 차단.
// ============================================================

const SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';
const TABLE_NAME    = 'zcoding';
