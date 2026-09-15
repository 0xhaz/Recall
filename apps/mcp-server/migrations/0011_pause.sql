-- Temporary mode (design.md §4.2): a window during which Recall neither reads nor writes.
-- Held on the household rather than the session, because the point is that every device in the
-- house goes quiet together — pausing on the kitchen Echo while the bedroom one keeps listening
-- would be worse than not offering it at all.
ALTER TABLE household ADD COLUMN paused_until timestamptz;
