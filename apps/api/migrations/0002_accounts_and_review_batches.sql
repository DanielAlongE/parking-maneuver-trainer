-- Phase 1: email + password accounts created by admin invitation, sessions,
-- and the items in each review batch.

ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN invited_by uuid REFERENCES users (id);

-- One-time invite links. Only a hash of the token is stored.
CREATE TABLE invites (
    token_hash  text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users (id),
    created_by  uuid REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz
);

-- Signed-in sessions, keyed by a hash of the cookie value.
CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Submissions an admin assigned to a reviewer, one batch at a time
-- (an individual assignment is a batch of one).
CREATE TABLE review_batch_items (
    batch_id       uuid NOT NULL REFERENCES review_batches (id),
    submission_id  uuid NOT NULL UNIQUE REFERENCES submissions (id),
    PRIMARY KEY (batch_id, submission_id)
);

-- One verdict per submission in phase 1; second reviews come later.
ALTER TABLE reviews ADD CONSTRAINT reviews_one_per_submission UNIQUE (submission_id);

-- An annotator holds at most one open claim at a time.
CREATE UNIQUE INDEX assignments_one_open_claim ON assignments (annotator_id) WHERE status = 'claimed';

CREATE INDEX submissions_assignment ON submissions (assignment_id);
CREATE INDEX assignments_annotator ON assignments (annotator_id);
