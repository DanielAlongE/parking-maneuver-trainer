"""End-to-end API behaviour against a real Postgres database."""

from mt_sim import SIM_VERSION

from .conftest import PASSWORD, PLAN, needs_db

pytestmark = needs_db


# --- accounts ---------------------------------------------------------------------------


def test_health_and_templates(env):
    assert env.admin.get("/api/health").json() == {"status": "ok", "simVersion": SIM_VERSION}
    ids = {t["templateId"] for t in env.admin.get("/api/scenarios/templates").json()}
    assert ids == {"parallel-park-kerbside", "three-point-turn", "narrow-street-oncoming"}


def test_invite_accept_login_logout(env):
    res = env.admin.post(
        "/api/admin/users", json={"email": " Ann@Example.com ", "displayName": "Ann", "roles": ["annotator"]}
    )
    assert res.status_code == 201
    link = res.json()["inviteUrl"]
    assert link.startswith("http://web.test/invite/")
    token = link.rsplit("/", 1)[1]

    anon = env.client()
    assert anon.get(f"/api/auth/invites/{token}").json() == {"email": "ann@example.com", "displayName": "Ann"}
    assert anon.post(f"/api/auth/invites/{token}/accept", json={"password": "short"}).status_code == 422
    res = anon.post(f"/api/auth/invites/{token}/accept", json={"password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["user"]["roles"] == ["annotator"]
    # One-time link.
    assert anon.get(f"/api/auth/invites/{token}").status_code == 404

    assert anon.post("/api/auth/logout").status_code == 200
    assert anon.get("/api/auth/me").status_code == 401
    assert anon.post("/api/auth/login", json={"email": "ann@example.com", "password": "wrong password!"}).status_code == 401
    assert anon.post("/api/auth/login", json={"email": "ANN@example.com", "password": PASSWORD}).status_code == 200
    assert anon.get("/api/auth/me").json()["user"]["email"] == "ann@example.com"


def test_duplicate_email_and_bad_email(env):
    body = {"email": "dup@test", "displayName": "D", "roles": ["annotator"]}
    assert env.admin.post("/api/admin/users", json=body).status_code == 201
    assert env.admin.post("/api/admin/users", json=body).status_code == 409
    assert env.admin.post("/api/admin/users", json={**body, "email": "nope"}).status_code == 422


def test_reissued_invite_resets_password_and_signs_out(env):
    ann = env.invite("ann@test", ["annotator"])
    uid = env.user_id(ann)
    link = env.admin.post(f"/api/admin/users/{uid}/invite").json()["inviteUrl"]
    other = env.client()
    assert other.post(f"/api/auth/invites/{link.rsplit('/', 1)[1]}/accept", json={"password": "a new password"}).status_code == 200
    assert ann.get("/api/auth/me").status_code == 401
    assert other.post("/api/auth/login", json={"email": "ann@test", "password": PASSWORD}).status_code == 401
    assert other.post("/api/auth/login", json={"email": "ann@test", "password": "a new password"}).status_code == 200


def test_roles_and_deactivation(env):
    ann = env.invite("ann@test", ["annotator"])
    assert env.client().get("/api/admin/users").status_code == 401
    assert ann.get("/api/admin/users").status_code == 403
    assert ann.get("/api/reviews/queue").status_code == 403

    uid = env.user_id(ann)
    res = env.admin.patch(f"/api/admin/users/{uid}", json={"roles": ["annotator", "reviewer"]})
    assert res.json()["user"]["roles"] == ["annotator", "reviewer"]
    assert ann.get("/api/reviews/queue").status_code == 200

    assert env.admin.patch(f"/api/admin/users/{uid}", json={"active": False}).status_code == 200
    assert ann.get("/api/auth/me").status_code == 401
    assert env.client().post("/api/auth/login", json={"email": "ann@test", "password": PASSWORD}).status_code == 401

    admin_id = env.user_id(env.admin)
    assert env.admin.patch(f"/api/admin/users/{admin_id}", json={"active": False}).status_code == 422
    assert env.admin.patch(f"/api/admin/users/{admin_id}", json={"roles": ["reviewer"]}).status_code == 422


# --- tasks, claims, submissions --------------------------------------------------------------


def generate(env, n=2, template="parallel-park-kerbside"):
    res = env.admin.post("/api/admin/tasks/generate", json={"templateId": template, "count": n})
    assert res.status_code == 201, res.text
    return res.json()["created"]


def test_claim_and_submit(env):
    ann = env.invite("ann@test", ["annotator"])
    assert ann.post("/api/tasks/claim").status_code == 404
    assert ann.get("/api/assignments/current").json() == {"assignment": None}

    assert generate(env, 2) == 2
    a = ann.post("/api/tasks/claim").json()["assignment"]
    assert a["templateId"] == "parallel-park-kerbside" and a["defaultPoints"] == 1 and a["status"] == "claimed"
    # Claiming again returns the same open claim.
    assert ann.post("/api/tasks/claim").json()["assignment"]["id"] == a["id"]

    res = ann.post(f"/api/assignments/{a['id']}/submit", json=PLAN)
    assert res.status_code == 201
    sid = res.json()["id"]
    assert env.queue.jobs == [sid]
    assert ann.post(f"/api/assignments/{a['id']}/submit", json=PLAN).status_code == 409

    subs = ann.get("/api/me/submissions").json()["submissions"]
    assert [(s["id"], s["status"]) for s in subs] == [(sid, "pending_replay")]
    env.fake_replay(sid)
    assert ann.get("/api/me/submissions").json()["submissions"][0]["status"] == "pending_review"
    row = env.sql("SELECT attempts, status::text AS status FROM assignments WHERE id = %s", (a["id"],))[0]
    assert row == {"attempts": 3, "status": "submitted"}

    # The next claim gets the other task.
    b = ann.post("/api/tasks/claim").json()["assignment"]
    assert b["taskId"] != a["taskId"]


def test_submission_validation(env):
    generate(env, 1)
    ann = env.invite("ann@test", ["annotator"])
    other = env.invite("bob@test", ["annotator"])
    a = ann.post("/api/tasks/claim").json()["assignment"]
    assert ann.post(f"/api/assignments/{a['id']}/submit", json={**PLAN, "actions": []}).status_code == 422
    unreachable = {**PLAN, "outcome": "unreachable", "actions": []}
    assert ann.post(f"/api/assignments/{a['id']}/submit", json=unreachable).status_code == 422
    assert other.post(f"/api/assignments/{a['id']}/submit", json=PLAN).status_code == 404
    res = ann.post(f"/api/assignments/{a['id']}/submit", json={**unreachable, "reasonCode": "no_gap"})
    assert res.status_code == 201
    stored = env.sql("SELECT outcome::text AS o, actions, reason_code::text AS r FROM submissions")[0]
    assert stored == {"o": "unreachable", "actions": [], "r": "no_gap"}


def test_expired_claim_waits_for_admin_reset(env):
    generate(env, 1)
    ann = env.invite("ann@test", ["annotator"])
    bob = env.invite("bob@test", ["annotator"])
    a = ann.post("/api/tasks/claim").json()["assignment"]
    env.sql("UPDATE assignments SET expires_at = now() - interval '1 minute' WHERE id = %s", (a["id"],))

    assert ann.post(f"/api/assignments/{a['id']}/submit", json=PLAN).status_code == 409
    assert ann.get("/api/assignments/current").json()["assignment"] is None
    # The task stays out of the queue until an admin resets it.
    assert bob.post("/api/tasks/claim").status_code == 404
    claims = env.admin.get("/api/admin/claims").json()["claims"]
    assert [c["id"] for c in claims] == [a["id"]]
    assert env.admin.post("/api/admin/claims/reset", json={"assignmentIds": [a["id"]]}).json() == {"reset": 1}
    assert env.admin.get("/api/admin/claims").json()["claims"] == []
    assert bob.post("/api/tasks/claim").json()["assignment"]["taskId"] == a["taskId"]


# --- reviews and points -------------------------------------------------------------------


def submitted(env, client, plan=PLAN):
    a = client.post("/api/tasks/claim").json()["assignment"]
    sid = client.post(f"/api/assignments/{a['id']}/submit", json=plan).json()["id"]
    return a, sid


def balance(client):
    return client.get("/api/me/points").json()["balance"]


def test_review_awards_points(env):
    generate(env, 3)
    ann = env.invite("ann@test", ["annotator"])
    rev = env.invite("rev@test", ["reviewer"])
    rev_id = env.user_id(rev)
    _, sid = submitted(env, ann)

    # Not assignable until the server replay exists.
    assert env.admin.post("/api/admin/review-batches", json={"reviewerId": rev_id, "count": 5}).status_code == 404
    env.fake_replay(sid)
    assert [s["id"] for s in env.admin.get("/api/admin/submissions/unassigned").json()["submissions"]] == [sid]
    res = env.admin.post("/api/admin/review-batches", json={"reviewerId": rev_id, "count": 5})
    assert res.json()["size"] == 1
    assert env.admin.get("/api/admin/submissions/unassigned").json()["submissions"] == []

    queue = rev.get("/api/reviews/queue").json()
    assert [p["submissionId"] for p in queue["pending"]] == [sid]
    item = rev.get(f"/api/reviews/items/{sid}").json()
    assert item["replay"]["goalReached"] is True and item["attempts"] == 3 and len(item["actions"]) == 2
    # Reviewers don't see who the annotator was.
    assert not any("annotator" in k.lower() for k in item)

    assert rev.post(f"/api/reviews/items/{sid}", json={"verdict": "accepted", "pointsSet": 8}).status_code == 422
    assert rev.post(f"/api/reviews/items/{sid}", json={"verdict": "accepted", "pointsSet": 21, "pointsReason": "x"}).status_code == 422
    res = rev.post(f"/api/reviews/items/{sid}", json={"verdict": "accepted", "pointsSet": 8, "pointsReason": "tight gap"})
    assert res.status_code == 201 and res.json()["pointsAwarded"] == 8
    assert rev.post(f"/api/reviews/items/{sid}", json={"verdict": "accepted"}).status_code == 409

    # Points show up immediately.
    assert balance(ann) == 8
    assert balance(rev) == 1
    assert ann.get("/api/me/submissions").json()["submissions"][0]["pointsAwarded"] == 8
    assert rev.get("/api/reviews/queue").json() == {"pending": [], "completedCount": 1}


def test_default_points_and_rejection(env):
    generate(env, 2)
    ann = env.invite("ann@test", ["annotator"])
    bob = env.invite("bob@test", ["annotator"])
    rev = env.invite("rev@test", ["reviewer"])
    a1, s1 = submitted(env, ann)
    _, s2 = submitted(env, ann)
    env.fake_replay(s1)
    env.fake_replay(s2, valid=False)
    env.admin.post("/api/admin/review-batches", json={"reviewerId": env.user_id(rev), "submissionIds": [s1, s2]})

    assert rev.post(f"/api/reviews/items/{s1}", json={"verdict": "accepted"}).json()["pointsAwarded"] == 1
    assert rev.post(f"/api/reviews/items/{s2}", json={"verdict": "rejected"}).status_code == 422
    assert rev.post(f"/api/reviews/items/{s2}", json={"verdict": "rejected", "comment": "Hit the kerb"}).status_code == 201
    assert balance(ann) == 1
    assert balance(rev) == 2
    statuses = {s["id"]: (s["status"], s["reviewerComment"]) for s in ann.get("/api/me/submissions").json()["submissions"]}
    assert statuses == {s1: ("accepted", None), s2: ("rejected", "Hit the kerb")}

    # The rejected task goes back to the queue, but not to the annotator who failed it.
    assert ann.post("/api/tasks/claim").status_code == 404
    assert bob.post("/api/tasks/claim").status_code == 200


def test_reviewers_never_get_their_own_work(env):
    generate(env, 1)
    both = env.invite("both@test", ["annotator", "reviewer"])
    _, sid = submitted(env, both)
    env.fake_replay(sid)
    uid = env.user_id(both)
    assert env.admin.post("/api/admin/review-batches", json={"reviewerId": uid, "count": 3}).status_code == 404
    assert env.admin.post("/api/admin/review-batches", json={"reviewerId": uid, "submissionIds": [sid]}).status_code == 422


def test_reviewer_sees_only_assigned_items(env):
    generate(env, 1)
    ann = env.invite("ann@test", ["annotator"])
    r1 = env.invite("r1@test", ["reviewer"])
    r2 = env.invite("r2@test", ["reviewer"])
    _, sid = submitted(env, ann)
    env.fake_replay(sid)
    env.admin.post("/api/admin/review-batches", json={"reviewerId": env.user_id(r1), "count": 1})
    assert r2.get(f"/api/reviews/items/{sid}").status_code == 404
    assert r2.post(f"/api/reviews/items/{sid}", json={"verdict": "accepted"}).status_code == 404
    # A second batch can't take an assigned submission.
    res = env.admin.post("/api/admin/review-batches", json={"reviewerId": env.user_id(r2), "submissionIds": [sid]})
    assert res.status_code == 422


# --- payouts ----------------------------------------------------------------------------------


def award(env, client, points):
    env.sql(
        "INSERT INTO points_ledger (user_id, entry_type, points, note) VALUES (%s, 'award', %s, 'test')",
        (env.user_id(client), points),
    )


def test_payout_lifecycle(env):
    ann = env.invite("ann@test", ["annotator"])
    award(env, ann, 19)
    assert ann.post("/api/me/payouts", json={"points": 19}).status_code == 422
    award(env, ann, 6)
    assert ann.post("/api/me/payouts", json={"points": 30}).status_code == 422
    res = ann.post("/api/me/payouts", json={"points": 20})
    assert res.status_code == 201
    p = res.json()["payout"]
    assert p["cashAmountUsd"] == "5.00" and p["status"] == "requested"
    assert balance(ann) == 5
    assert ann.post("/api/me/payouts", json={"points": 20}).status_code == 422

    admin_list = env.admin.get("/api/admin/payouts").json()["payouts"]
    assert [(x["id"], x["email"]) for x in admin_list] == [(p["id"], "ann@test")]
    assert env.admin.post(f"/api/admin/payouts/{p['id']}", json={"status": "contacted"}).status_code == 200
    assert env.admin.post(f"/api/admin/payouts/{p['id']}", json={"status": "paid"}).status_code == 409
    res = env.admin.post(f"/api/admin/payouts/{p['id']}", json={"status": "paid", "externalReference": "e-transfer 4411"})
    assert res.json()["payout"]["status"] == "paid"
    assert env.admin.post(f"/api/admin/payouts/{p['id']}", json={"status": "cancelled"}).status_code == 409
    assert balance(ann) == 5
    assert env.admin.get("/api/admin/payouts").json()["payouts"] == []


def test_cancelled_payout_returns_points(env):
    ann = env.invite("ann@test", ["annotator"])
    award(env, ann, 40)
    p = ann.post("/api/me/payouts", json={"points": 40}).json()["payout"]
    assert balance(ann) == 0
    env.admin.post(f"/api/admin/payouts/{p['id']}", json={"status": "cancelled"})
    assert balance(ann) == 40
    types = [e["type"] for e in ann.get("/api/me/points").json()["entries"]]
    assert types == ["release", "hold", "award"]


def test_generate_with_seeds(env):
    res = env.admin.post("/api/admin/tasks/generate", json={"templateId": "parallel-park-kerbside", "seeds": [7, 1234, 7]})
    # The repeated seed is the same scenario instance, so it is skipped.
    assert res.json() == {"created": 2}
    seeds = sorted(r["seed"] for r in env.sql("SELECT seed FROM scenario_instances"))
    assert seeds == [7, 1234]
    bad = {"templateId": "parallel-park-kerbside"}
    assert env.admin.post("/api/admin/tasks/generate", json=bad).status_code == 422
    assert env.admin.post("/api/admin/tasks/generate", json={**bad, "count": 1, "seeds": [1]}).status_code == 422
    assert env.admin.post("/api/admin/tasks/generate", json={**bad, "seeds": [-1]}).status_code == 422


def test_overview(env):
    generate(env, 3)
    generate(env, 2, "three-point-turn")
    ann = env.invite("ann@test", ["annotator"])
    _, sid = submitted(env, ann)
    ann.post("/api/tasks/claim")
    o = env.admin.get("/api/admin/overview").json()
    assert o["tasks"] == {"total": 5, "available": 3, "claimed": 1, "expired": 0}
    assert o["submissions"]["awaitingReplay"] == 1
    assert {t["templateId"]: t["tasks"] for t in o["templates"]} == {"parallel-park-kerbside": 3, "three-point-turn": 2}
