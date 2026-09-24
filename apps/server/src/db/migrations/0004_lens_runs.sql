-- Tracks that a lens was run against a document, independent of how many
-- annotations it produced — a lens that ran and found nothing is a
-- different state from one that was never triggered, and the frontend
-- filter chips need to tell those apart (docs: "run on demand" UX).
CREATE TABLE IF NOT EXISTS lens_runs (
  doc_id          CHAR(36)     NOT NULL,
  lens_id         VARCHAR(64)  NOT NULL,
  produced_count  INT          NOT NULL,
  ran_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (doc_id, lens_id),
  CONSTRAINT fk_lens_runs_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;
