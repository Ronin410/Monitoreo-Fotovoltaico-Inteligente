-- Credenciales de integraciones a nivel empresa (GoodWe como "usuario de organización":
-- docs/fabricantes/goodwe-openapi.md). Mismo cifrado y mismas reglas que inverter_credentials:
-- nunca se devuelven por la API y solo las ve su empresa.

CREATE TABLE "company_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "provider" "inverter_brand" NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_integrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "company_integrations_key_version_positive" CHECK ("key_version" >= 1)
);

CREATE UNIQUE INDEX "company_integrations_company_id_provider_key"
  ON "company_integrations"("company_id", "provider");

ALTER TABLE "company_integrations" ADD CONSTRAINT "company_integrations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON company_integrations TO pv_app;

ALTER TABLE company_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_integrations TO pv_app
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());
