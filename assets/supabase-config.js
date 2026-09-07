// Configuration publique du projet Supabase.
// La cle "anon" est faite pour vivre dans le navigateur : les ecritures sont
// bloquees par les policies RLS (voir db/schema.sql). La cle "service_role"
// ne doit JAMAIS apparaitre ici : elle reste dans scripts/.env.local.
window.SUPABASE_URL = "https://ejphfsneygykmhtysdlk.supabase.co";
window.SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqcGhmc25leWd5a21odHlzZGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTY1NzMsImV4cCI6MjEwNDMzMjU3M30.pNGuumC_xFfnJHjAEqqBRbSCDAeM97e7GUEMYhBLzTA";
window.SUPABASE_PHOTO_BUCKET = "photos";
