-- ==============================================================================
-- Migrasi: 20260913000002_settings_functions.sql
-- Penambahan RPC helper untuk Settings & User Access Management
-- ==============================================================================

-- 1. Helper function untuk mengambil user assignments beserta email & metadata profil
CREATE OR REPLACE FUNCTION public.get_company_users_with_profiles(p_company_id uuid)
RETURNS TABLE (
  company_id uuid,
  user_id uuid,
  email text,
  full_name text,
  username text,
  roles text[],
  is_active boolean,
  version integer,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Validasi otorisasi: pengguna yang memanggil harus anggota company aktif atau owner
  IF NOT EXISTS (
    SELECT 1 FROM public.user_company_assignment
    WHERE company_id = p_company_id
      AND user_id = (SELECT auth.uid())
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda bukan anggota aktif dari perusahaan ini.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uca.company_id,
    uca.user_id,
    au.email::text,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS full_name,
    COALESCE(
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS username,
    uca.roles,
    uca.is_active,
    uca.version,
    uca.created_at,
    uca.updated_at
  FROM public.user_company_assignment uca
  JOIN auth.users au ON uca.user_id = au.id
  WHERE uca.company_id = p_company_id
  ORDER BY uca.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_users_with_profiles(uuid) TO authenticated;

-- 2. Helper function untuk mengambil daftar seluruh user terdaftar (untuk form penugasan)
CREATE OR REPLACE FUNCTION public.list_available_system_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Hanya authenticated users yang memiliki role owner di setidaknya 1 company
  IF NOT EXISTS (
    SELECT 1 FROM public.user_company_assignment
    WHERE user_id = (SELECT auth.uid())
      AND 'owner' = ANY(roles)
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Owner yang dapat melihat daftar pengguna sistem.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    au.id AS user_id,
    au.email::text,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS full_name,
    COALESCE(
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS username
  FROM auth.users au
  ORDER BY au.email ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_available_system_users() TO authenticated;
