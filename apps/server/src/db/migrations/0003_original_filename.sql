-- Needed for the library page (list of uploaded papers) to show a human title
-- instead of a raw content hash.
ALTER TABLE documents
  ADD COLUMN original_filename VARCHAR(500) NULL AFTER content_hash;
