-- Lens definitions move from code into the database so curators can edit
-- org lenses and members can create personal ones (docs/02-decisions.md #4,
-- #6). The four presets in apps/server/src/lenses/presets.ts are seeded on
-- boot when missing. Editing a lens bumps its version; old annotations keep
-- the agent_version they were produced with (agent annotations are
-- immutable).
CREATE TABLE IF NOT EXISTS lenses (
  id                 VARCHAR(64)   NOT NULL PRIMARY KEY,
  owner_id           CHAR(36)      NULL, -- NULL = org lens; otherwise the personal lens's owner
  name               VARCHAR(120)  NOT NULL,
  description        VARCHAR(500)  NOT NULL DEFAULT '',
  version            VARCHAR(32)   NOT NULL,
  kind               VARCHAR(20)   NOT NULL DEFAULT 'model',
  scope              VARCHAR(16)   NOT NULL DEFAULT 'all',
  instruction        TEXT          NOT NULL,
  max_annotations    INT           NOT NULL,
  execution_context  VARCHAR(20)   NOT NULL, -- org-server | personal-client
  strict_scope       TINYINT(1)    NOT NULL DEFAULT 0,
  share_runs_with_org TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at         DATETIME(3)   NULL,
  KEY idx_lenses_owner_id (owner_id),
  CONSTRAINT fk_lenses_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;
