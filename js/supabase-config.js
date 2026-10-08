/*
 * Supabase 連線設定：到 Supabase 後台 Project Settings → API Keys 複製
 *   url：sb_publishable_HbbsnjG0GTwzfRgKyx1Aqg__JUOb24B
 *   key：sb_publishable_HbbsnjG0GTwzfRgKyx1Aqg__JUOb24B 或舊版的 anon public key
 * 這兩個值本來就是公開的（會出現在網頁裡），資料安全靠資料表的 RLS 規則保護，
 * 千萬不要把 secret / service_role key 放在這裡。
 */
window.SANGO_SUPABASE = {
  url: 'https://usoavddhglpbdpwwxium.supabase.co',
  key: 'sb_publishable_HbbsnjG0GTwzfRgKyx1Aqg__JUOb24B'
};
