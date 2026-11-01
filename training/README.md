# Training (phase 2)

Offline jobs that read versioned dataset snapshots and train maneuver models (ADR D10, section 8).

1. **Snapshot export:** accepted submissions, rankings and replay results to Parquet with a manifest (filters, sim version, row counts).
2. **Behaviour cloning baseline** on accepted segment plans.
3. **Reward model** (Bradley-Terry) from rankings.
4. **Closed-loop evaluation** with the Python twin (`packages/sim-py`) on held-out instances, using the same metrics as human labels.
5. **Correction loop (phase 3):** failed model rollouts become new annotation tasks.

Training jobs never read the production database directly; they read snapshots only.

Data from the UniqueData parking space detection dataset is credited and never leaves the project, including in any released snapshot (ADR D3).
