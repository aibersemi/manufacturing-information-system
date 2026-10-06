BEGIN;

-- Membutuhkan migration workspace_isolation dari repository platform Supabase.
DO $$
DECLARE t record; f record;
BEGIN
  IF to_regprocedure('tenant_private.has_workspace_access(text)') IS NULL THEN
    RAISE EXCEPTION 'Terapkan migration workspace_isolation pada platform Supabase dahulu.';
  END IF;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mis_workspace_boundary ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY mis_workspace_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT tenant_private.has_workspace_access(''mis''))) WITH CHECK ((SELECT tenant_private.has_workspace_access(''mis'')))', t.relname);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.signature);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_company_data(uuid, uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

DROP POLICY IF EXISTS mis_assignment_target ON public.user_company_assignment;
CREATE POLICY mis_assignment_target ON public.user_company_assignment
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_private.is_mis_user(user_id)) WITH CHECK (tenant_private.is_mis_user(user_id));

CREATE OR REPLACE FUNCTION public.get_public_active_companies()
RETURNS TABLE(id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.code, c.name FROM public.company c
  WHERE c.is_active AND tenant_private.has_workspace_access('mis')
    AND c.id IN (SELECT public.get_user_company_ids((SELECT auth.uid())))
  ORDER BY c.name;
$$;
REVOKE ALL ON FUNCTION public.get_public_active_companies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_active_companies() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_available_system_users()
RETURNS TABLE(user_id uuid, email text, full_name text, username text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT tenant_private.has_workspace_access('mis') OR NOT EXISTS (
    SELECT 1 FROM public.user_company_assignment uca
    WHERE uca.user_id = (SELECT auth.uid()) AND 'owner' = ANY(uca.roles) AND uca.is_active
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Owner MIS yang dapat melihat daftar pengguna.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT au.id, au.email::text,
    COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'username', split_part(au.email, '@', 1))::text,
    COALESCE(au.raw_user_meta_data->>'username', split_part(au.email, '@', 1))::text
  FROM auth.users au WHERE tenant_private.is_mis_user(au.id) ORDER BY au.email;
END;
$$;
REVOKE ALL ON FUNCTION public.list_available_system_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_available_system_users() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
