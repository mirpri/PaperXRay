-- Visibility needs an owner to mean anything (docs/02-decisions.md #5):
-- a `private` run is visible only to whoever ran it. Org-lens runs have no
-- owner (NULL) and are always `org`; personal-lens runs (executed in the
-- browser, docs/02-decisions.md #6) carry the uploading user's id.
ALTER TABLE agent_annotations
  ADD COLUMN owner_id CHAR(36) NULL AFTER run_id,
  ADD KEY idx_agent_annotations_owner_id (owner_id);

-- Personal lens ids are per-user, so (doc_id, lens_id) stays unique; the
-- owner is recorded so a personal lens's run status is only shown to its
-- owner.
ALTER TABLE lens_runs
  ADD COLUMN owner_id CHAR(36) NULL AFTER lens_id;
