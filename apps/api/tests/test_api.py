from fastapi.testclient import TestClient

from mt_api.main import app
from mt_sim import SIM_VERSION

client = TestClient(app)

PLAN = {
    "simVersion": SIM_VERSION,
    "templateId": "parallel-park-kerbside",
    "seed": 7,
    "outcome": "plan",
    "actions": [{"kind": "drive", "gear": "R", "steerDeg": -35, "distanceM": 2.75, "speedMps": 0.3}],
    "confidence": 4,
}


def test_health():
    assert client.get("/health").json() == {"status": "ok", "simVersion": SIM_VERSION}


def test_lists_the_mvp_templates():
    ids = {t["templateId"] for t in client.get("/scenarios/templates").json()}
    assert ids == {"parallel-park-kerbside", "three-point-turn", "narrow-street-oncoming"}


def test_create_and_read_submission():
    res = client.post("/submissions", json=PLAN)
    assert res.status_code == 201
    sid = res.json()["id"]
    assert client.get(f"/submissions/{sid}").json()["status"] == "pending_replay"


def test_unreachable_needs_a_reason():
    body = {**PLAN, "outcome": "unreachable", "actions": []}
    assert client.post("/submissions", json=body).status_code == 422
    body["reasonCode"] = "no_gap"
    assert client.post("/submissions", json=body).status_code == 201


def test_rejects_unknown_template():
    assert client.post("/submissions", json={**PLAN, "templateId": "nope"}).status_code == 422
