-- Supabase Data API privileges
--
-- The database is Postgres. Prisma is only the schema/client tool used by this
-- app, and the app reads/writes these tables through a direct Postgres
-- connection. Keep Prisma-managed tables private from Supabase REST/GraphQL
-- roles unless a future feature deliberately opts into Data API exposure.

DO $$
DECLARE
    data_api_role TEXT;
    table_name TEXT;
BEGIN
    FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF to_regrole(data_api_role) IS NOT NULL THEN
            IF to_regrole('postgres') IS NOT NULL THEN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM %I',
                    'postgres',
                    data_api_role
                );
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM %I',
                    'postgres',
                    data_api_role
                );
            END IF;

            FOREACH table_name IN ARRAY ARRAY['Station', 'PriceHistory', 'CurrentPrice']
            LOOP
                IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
                    EXECUTE format(
                        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
                        table_name,
                        data_api_role
                    );
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
