-- Complete current schema for a fresh installation. Edit this file directly.
-- Schema mirrors packages/contracts/src/{ir,annotation}.ts.
-- Engine/charset per docs/02-decisions.md #12.

-- Full text and CharMap are stored in UPLOADS_DIR by content_hash.
CREATE TABLE documents (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  content_hash  CHAR(64)      NOT NULL, -- sha256 of raw PDF bytes; document identity (docs/02-decisions.md #2)
  title VARCHAR(500) NULL,
  page_count    INT           NOT NULL,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_documents_content_hash (content_hash),
  KEY idx_documents_created (created_at, id),
  KEY idx_documents_title (title, id),
  KEY idx_documents_pages (page_count, id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE nodes (
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

CREATE TABLE users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  display_name  VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  sso_sub       VARCHAR(255) NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'member', -- admin | curator | member (docs/02-decisions.md #4)
  status        ENUM('pending', 'active') NOT NULL DEFAULT 'pending',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_sso_sub (sso_sub)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

-- Personal collections reference the shared organization library; they never own PDFs.
CREATE TABLE membership_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  recipient_id CHAR(36) NOT NULL,
  applicant_id CHAR(36) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_membership_notice (recipient_id, applicant_id),
  KEY idx_membership_inbox (recipient_id, read_at, created_at, id),
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE collections (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  owner_id    CHAR(36)     NOT NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_collections_owner_name (owner_id, name),
  KEY idx_collections_owner_updated (owner_id, updated_at, id),
  CONSTRAINT chk_collections_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT fk_collections_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

-- Every selected member can read the collection and add/remove its documents.
-- The owner is implicit in collections.owner_id and is not duplicated here.
CREATE TABLE collection_members (
  collection_id CHAR(36)    NOT NULL,
  user_id       CHAR(36)    NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (collection_id, user_id),
  KEY idx_collection_members_user (user_id, created_at, collection_id),
  CONSTRAINT fk_collection_members_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE collection_documents (
  collection_id CHAR(36)    NOT NULL,
  doc_id        CHAR(36)    NOT NULL,
  added_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (collection_id, doc_id),
  KEY idx_collection_documents_added (collection_id, added_at, doc_id),
  KEY idx_collection_documents_doc (doc_id, collection_id),
  CONSTRAINT fk_collection_documents_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_documents_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE collection_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  recipient_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  collection_id CHAR(36) NOT NULL,
  kind ENUM('collection_shared', 'collection_left') NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_collection_notifications_inbox (recipient_id, read_at, created_at, id),
  CONSTRAINT fk_collection_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_notifications_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_collection_notifications_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE human_annotations (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  doc_id      CHAR(36)     NOT NULL,
  author_id   CHAR(36)     NULL,
  parent_id   CHAR(36)     NULL,
  parent_kind VARCHAR(8)   NULL,
  thread_root_id CHAR(36)  NULL,
  thread_root_kind VARCHAR(8) NULL,
  anchor      LONGTEXT     NOT NULL, -- JSON (MariaDB JSON is just LONGTEXT, docs/02-decisions.md #12)
  body        LONGTEXT     NOT NULL,
  visibility  VARCHAR(8)   NOT NULL DEFAULT 'org', -- private | org
  version     INT          NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  KEY idx_human_annotations_doc_id (doc_id),
  KEY idx_human_annotations_parent (parent_kind, parent_id),
  KEY idx_human_annotations_thread (doc_id, thread_root_kind, thread_root_id),
  CONSTRAINT fk_human_annotations_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_human_annotations_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_annotations (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  doc_id         CHAR(36)     NOT NULL,
  agent_id       VARCHAR(64)  NOT NULL,
  agent_version  VARCHAR(32)  NOT NULL,
  run_id         CHAR(36)     NOT NULL,
  owner_id       CHAR(36)     NULL,
  owner_name     VARCHAR(255) NULL,
  lens_name      VARCHAR(120) NULL,
  lens_color     VARCHAR(7)   NULL,
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
  KEY idx_agent_annotations_owner_id (owner_id),
  CONSTRAINT fk_agent_annotations_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE sso_config (
  id                      VARCHAR(16)  NOT NULL PRIMARY KEY, -- fixed 'default'; singleton row, org-wide setting
  provider_name           VARCHAR(64)  NOT NULL,
  authorization_endpoint  VARCHAR(512) NOT NULL,
  token_endpoint          VARCHAR(512) NOT NULL,
  userinfo_endpoint       VARCHAR(512) NOT NULL,
  client_id               VARCHAR(255) NOT NULL DEFAULT '',
  client_secret           VARCHAR(255) NULL, -- optional (confidential-client flow); never echoed back to clients as plaintext
  scopes                  VARCHAR(255) NULL,
  account_management_url  VARCHAR(512) NULL, -- optional URL to IdP's account management page
  updated_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;


CREATE TABLE lens_runs (
  doc_id          CHAR(36)     NOT NULL,
  lens_id         VARCHAR(64)  NOT NULL,
  owner_id        CHAR(36)     NULL,
  produced_count  INT          NOT NULL,
  ran_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (doc_id, lens_id),
  CONSTRAINT fk_lens_runs_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE providers (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  owner_id    CHAR(36)     NULL,
  name        VARCHAR(120) NOT NULL,
  base_url    VARCHAR(512) NOT NULL,
  models      LONGTEXT     NOT NULL,
  api_key     TEXT         NULL,
  deleted_at  DATETIME(3)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_providers_owner (owner_id),
  CONSTRAINT fk_providers_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE lenses (
  color VARCHAR(7) NULL,
  id                 VARCHAR(64)   NOT NULL PRIMARY KEY,
  owner_id           CHAR(36)      NULL, -- NULL = org lens; otherwise the personal lens's owner
  provider_id        VARCHAR(64)   NULL,
  model              VARCHAR(255)  NULL,
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
  CONSTRAINT fk_lenses_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  CONSTRAINT fk_lenses_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;


CREATE TABLE notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  recipient_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  doc_id CHAR(36) NOT NULL,
  reply_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_notifications_reply (recipient_id, reply_id),
  KEY idx_notifications_inbox (recipient_id, read_at, created_at, id),
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_reply FOREIGN KEY (reply_id) REFERENCES human_annotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_parent FOREIGN KEY (parent_id) REFERENCES human_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

-- Current votes. Notification history is stored separately so cancellation retains prior messages.
CREATE TABLE annotation_votes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  doc_id CHAR(36) NOT NULL,
  annotation_id CHAR(36) NOT NULL,
  annotation_kind VARCHAR(8) NOT NULL,
  voter_id CHAR(36) NOT NULL,
  value TINYINT NOT NULL,
  recipient_id CHAR(36) NULL,
  notification_read_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_annotation_vote (annotation_kind, annotation_id, voter_id),
  KEY idx_annotation_votes_doc (doc_id),
  KEY idx_annotation_votes_inbox (recipient_id, notification_read_at, updated_at, id),
  CONSTRAINT chk_annotation_vote_value CHECK (value IN (-1, 1)),
  CONSTRAINT chk_annotation_vote_kind CHECK (annotation_kind IN ('human', 'agent')),
  CONSTRAINT fk_annotation_votes_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_annotation_votes_voter FOREIGN KEY (voter_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_annotation_votes_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;

CREATE TABLE vote_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  doc_id CHAR(36) NOT NULL,
  annotation_id CHAR(36) NOT NULL,
  annotation_kind VARCHAR(8) NOT NULL,
  voter_id CHAR(36) NULL,
  recipient_id CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_vote_notifications_inbox (recipient_id, read_at, created_at, id),
  CONSTRAINT chk_vote_notification_kind CHECK (kind IN ('upvote', 'downvote', 'cancel_upvote', 'cancel_downvote')),
  CONSTRAINT fk_vote_notifications_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_notifications_voter FOREIGN KEY (voter_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_vote_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;
