-- Adds: SSO config (docs/02-decisions.md #11), SSO identity linkage on
-- users, and CharMap storage on documents (needed for reverse-mapping,
-- packages/contracts/src/ir.ts CharMapRun).

CREATE TABLE IF NOT EXISTS sso_config (
  id                      VARCHAR(16)  NOT NULL PRIMARY KEY, -- fixed 'default'; singleton row, org-wide setting
  provider_name           VARCHAR(64)  NOT NULL,
  authorization_endpoint  VARCHAR(512) NOT NULL,
  token_endpoint          VARCHAR(512) NOT NULL,
  userinfo_endpoint       VARCHAR(512) NOT NULL,
  client_id               VARCHAR(255) NOT NULL DEFAULT '',
  client_secret           VARCHAR(255) NULL, -- optional (confidential-client flow); never echoed back to clients as plaintext
  scopes                  VARCHAR(255) NULL,
  updated_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

-- client_id intentionally left blank here — the server seeds it from
-- MIRPASS_CLIENT_ID on boot if this row's client_id is still blank, so a
-- fresh checkout works from .env alone, but once the admin panel edits this
-- row, that becomes the source of truth (docs/02-decisions.md #11).
INSERT IGNORE INTO sso_config
  (id, provider_name, authorization_endpoint, token_endpoint, userinfo_endpoint, client_id, scopes)
VALUES
  ('default', 'mirpass', 'https://api.pass.mirpri.com/oauth2/authorize',
   'https://api.pass.mirpri.com/oauth2/token', 'https://api.pass.mirpri.com/userinfo', '', '');

ALTER TABLE users
  ADD COLUMN sso_sub VARCHAR(255) NULL AFTER email,
  ADD UNIQUE KEY uq_users_sso_sub (sso_sub);

ALTER TABLE documents
  ADD COLUMN char_map LONGTEXT NULL AFTER normalized_text;
