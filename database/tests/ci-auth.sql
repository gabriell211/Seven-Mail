-- Test-only substitute for Neon Auth. Never deploy.
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('seven_mail_ci.user_id', true), '')
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.user_id() TO authenticated;
