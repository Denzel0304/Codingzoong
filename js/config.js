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

const SUPABASE_URL  = 'https://ikhzervuzodzklimerxn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlraHplcnZ1em9kemtsaW1lcnhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTIzMzIsImV4cCI6MjA5Mjg4ODMzMn0.Ltjjmd3iMtR8Y4D_Akspt3blAdsq4dHjif-3ky-L3a4';
const TABLE_NAME    = 'zcoding';
