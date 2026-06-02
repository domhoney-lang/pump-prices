-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "brand" TEXT,
    "address" TEXT,
    "postcode" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "fuelType" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceHistory_stationId_idx" ON "PriceHistory"("stationId");

-- CreateIndex
CREATE INDEX "PriceHistory_fuelType_idx" ON "PriceHistory"("fuelType");

-- CreateIndex
CREATE INDEX "PriceHistory_timestamp_idx" ON "PriceHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PriceHistory_stationId_fuelType_timestamp_key" ON "PriceHistory"("stationId", "fuelType", "timestamp");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase Data API privileges
-- This app uses direct Postgres access through Prisma, so these tables are not
-- intentionally exposed through Supabase REST or GraphQL roles.
DO $$
DECLARE
    data_api_role TEXT;
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

            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."Station" FROM %I', data_api_role);
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."PriceHistory" FROM %I', data_api_role);
        END IF;
    END LOOP;
END $$;
