-- ==============================================================================
-- Migrasi: 20260920000002_public_active_companies_rpc.sql
-- RPC Helper untuk mengambil daftar entitas pabrik aktif bagi halaman login (anon & authenticated)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_public_active_companies()
RETURNS TABLE (
  id uuid,
  code text,
  name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id, code, name
  FROM public.company
  WHERE is_active = true
  ORDER BY name ASC;
$$;

-- Berikan izin eksekusi kepada anon (sebelum login) dan authenticated (sesudah login)
GRANT EXECUTE ON FUNCTION public.get_public_active_companies() TO anon, authenticated;
