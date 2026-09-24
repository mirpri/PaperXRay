-- Schema mirrors packages/contracts/src/{ir,annotation}.ts.
-- Engine/charset per docs/02-decisions.md #12.

CREATE TABLE IF NOT EXISTS documents (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  content_hash  CHAR(64)      NOT NULL, -- sha256 of raw PDF bytes; document identity (docs/02-decisions.md #2)
  page_count    INT           NOT NULL,
  normalized_text LONGTEXT    NOT NULL,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_documents_content_hash (content_hash)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nodes (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  doc_id      CHAR(36)    NOT NULL,
  type        VARCHAR(16) NOT NULL, -- section | paragraph | equation | figure | table | caption
  parent_id   CHAR(36)    NULL,
  `order`     INT         NOT NULL,
  char_start  INT         NOT NULL,
  char_end    INT         NOT NULL,
  page_hint   INT         NOT NULL,
  KEY idx_nodes_doc_id (doc_id),
  CONSTRAINT fk_nodes_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  display_name  VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'member', -- admin | curator | member (docs/02-decisions.md #4)
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS human_annotations (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  doc_id      CHAR(36)     NOT NULL,
  author_id   CHAR(36)     NOT NULL,
  anchor      LONGTEXT     NOT NULL, -- JSON (MariaDB JSON is just LONGTEXT, docs/02-decisions.md #12)
  body        LONGTEXT     NOT NULL,
  visibility  VARCHAR(8)   NOT NULL DEFAULT 'org', -- private | org
  version     INT          NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  KEY idx_human_annotations_doc_id (doc_id),
  CONSTRAINT fk_human_annotations_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_human_annotations_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agent_annotations (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  doc_id         CHAR(36)     NOT NULL,
  agent_id       VARCHAR(64)  NOT NULL,
  agent_version  VARCHAR(32)  NOT NULL,
  run_id         CHAR(36)     NOT NULL,
  anchor         LONGTEXT     NOT NULL, -- JSON
  evidence_span  LONGTEXT     NOT NULL, -- JSON CharRange; required, server-verified (docs/02-decisions.md #6)
  comment        LONGTEXT     NOT NULL,
  severity       VARCHAR(8)   NOT NULL, -- info | low | medium | high
  confidence     FLOAT        NOT NULL,
  visibility     VARCHAR(8)   NOT NULL DEFAULT 'org',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- no updated_at/deleted_at: immutable, see docs/01 "agent 层与人类层分离"
  KEY idx_agent_annotations_doc_id (doc_id),
  KEY idx_agent_annotations_run_id (run_id),
  CONSTRAINT fk_agent_annotations_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;
