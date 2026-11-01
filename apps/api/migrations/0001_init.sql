-- ADR-001 section 7 data model. Labels, reviews and the points ledger are
-- append-only: corrections are new rows, never updates.

CREATE TYPE user_role AS ENUM ('annotator', 'reviewer', 'admin');
CREATE TYPE task_mode AS ENUM ('segment', 'keyframe', 'ranking', 'decision');
CREATE TYPE assignment_status AS ENUM ('claimed', 'submitted', 'expired', 'reset');
CREATE TYPE submission_outcome AS ENUM ('plan', 'unreachable');
CREATE TYPE unreachable_reason AS ENUM ('no_gap', 'blocked_by_agent', 'rule_violation_required', 'other');
CREATE TYPE review_verdict AS ENUM ('accepted', 'rejected');
CREATE TYPE ledger_entry_type AS ENUM ('award', 'adjustment', 'reversal', 'hold', 'release');
CREATE TYPE payout_status AS ENUM ('requested', 'contacted', 'paid', 'cancelled');

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    display_name  text NOT NULL,
    -- Any annotator can also be given the reviewer role (ADR Q9).
    roles         user_role[] NOT NULL DEFAULT '{annotator}',
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scenario_templates (
    id               text NOT NULL,
    schema_version   text NOT NULL,
    family           text NOT NULL,
    difficulty_tier  smallint NOT NULL CHECK (difficulty_tier BETWEEN 1 AND 4),
    body             jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, schema_version)
);

CREATE TABLE scenario_instances (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id      text NOT NULL,
    schema_version   text NOT NULL,
    seed             bigint NOT NULL,
    -- 'generator', or a dataset name such as 'uniquedata-parking-space-detection'.
    source           text NOT NULL DEFAULT 'generator',
    source_record    text,
    source_licence   text,
    params           jsonb NOT NULL,
    content_hash     text NOT NULL UNIQUE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (template_id, schema_version) REFERENCES scenario_templates (id, schema_version)
);

CREATE TABLE candidate_plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id     uuid NOT NULL REFERENCES scenario_instances (id),
    planner_config  jsonb NOT NULL,
    segments        jsonb NOT NULL,
    metrics         jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id     uuid NOT NULL REFERENCES scenario_instances (id),
    mode            task_mode NOT NULL DEFAULT 'segment',
    is_gold         boolean NOT NULL DEFAULT false,
    overlap_group   uuid,
    default_points  smallint NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assignments (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id            uuid NOT NULL REFERENCES tasks (id),
    annotator_id       uuid NOT NULL REFERENCES users (id),
    status             assignment_status NOT NULL DEFAULT 'claimed',
    attempts           integer NOT NULL DEFAULT 0,
    claimed_at         timestamptz NOT NULL DEFAULT now(),
    -- 24-hour claim window (ADR Q7); expired claims wait for an admin reset.
    expires_at         timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    finished_at        timestamptz,
    reset_by_admin_id  uuid REFERENCES users (id)
);
CREATE INDEX assignments_open ON assignments (task_id) WHERE status = 'claimed';

CREATE TABLE submissions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id  uuid NOT NULL REFERENCES assignments (id),
    sim_version    text NOT NULL,
    outcome        submission_outcome NOT NULL,
    actions        jsonb NOT NULL DEFAULT '[]',
    reason_code    unreachable_reason,
    confidence     smallint CHECK (confidence BETWEEN 1 AND 5),
    notes          text NOT NULL DEFAULT '',
    client_result  jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK ((outcome = 'unreachable') = (reason_code IS NOT NULL))
);

-- Written only by the replay worker.
CREATE TABLE replay_results (
    submission_id            uuid PRIMARY KEY REFERENCES submissions (id),
    sim_version              text NOT NULL,
    valid                    boolean NOT NULL,
    goal_reached             boolean NOT NULL,
    collision                jsonb,
    final_position_error_m   double precision NOT NULL,
    final_heading_error_deg  double precision NOT NULL,
    min_clearance_static_m   double precision,
    min_clearance_agents_m   double precision,
    direction_changes        integer NOT NULL,
    duration_s               double precision NOT NULL,
    steering_smoothness      double precision NOT NULL,
    planner_solvable         boolean,
    client_mismatch          boolean NOT NULL,
    flags                    text[] NOT NULL DEFAULT '{}',
    trajectory_uri           text,
    created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rankings (
    submission_id          uuid PRIMARY KEY REFERENCES submissions (id),
    ordered_candidate_ids  uuid[] NOT NULL,
    reason_tags            text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE review_batches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id  uuid NOT NULL REFERENCES users (id),
    assigned_by  uuid NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id  uuid NOT NULL REFERENCES submissions (id),
    reviewer_id    uuid NOT NULL REFERENCES users (id),
    batch_id       uuid REFERENCES review_batches (id),
    verdict        review_verdict NOT NULL,
    scores         jsonb NOT NULL DEFAULT '{}',
    comment        text NOT NULL DEFAULT '',
    -- 1 by default, up to 20 at the reviewer's discretion (ADR D14).
    points_set     smallint NOT NULL DEFAULT 1 CHECK (points_set BETWEEN 1 AND 20),
    points_reason  text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (points_set = 1 OR points_reason IS NOT NULL)
);

CREATE TABLE points_ledger (
    id             bigserial PRIMARY KEY,
    user_id        uuid NOT NULL REFERENCES users (id),
    entry_type     ledger_entry_type NOT NULL,
    points         integer NOT NULL,
    submission_id  uuid REFERENCES submissions (id),
    review_id      uuid REFERENCES reviews (id),
    payout_id      uuid,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_user ON points_ledger (user_id);

-- 1 point = 0.25 USD; settled off-platform by an admin by email (ADR D14).
-- No bank, card or wallet details are ever stored here.
CREATE TABLE payout_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users (id),
    points              integer NOT NULL CHECK (points >= 20),
    cash_amount_usd     numeric(10, 2) NOT NULL,
    status              payout_status NOT NULL DEFAULT 'requested',
    admin_id            uuid REFERENCES users (id),
    paid_at             timestamptz,
    external_reference  text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (cash_amount_usd = points * 0.25)
);

ALTER TABLE points_ledger
    ADD CONSTRAINT points_ledger_payout FOREIGN KEY (payout_id) REFERENCES payout_requests (id);

CREATE TABLE dataset_snapshots (
    version       text PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    filters       jsonb NOT NULL,
    manifest_uri  text NOT NULL,
    row_count     integer NOT NULL
);
