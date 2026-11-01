"""Plays a plan in a scenario instance and scores it.

Twin of packages/sim-core/src/simulate.ts; see that file for the model notes.
"""

from typing import Any

from .dmath import clamp, cos, deg_to_rad, normalize_angle, rad_to_deg, sin, sqrt, tan
from .geometry import Polygon, box_corners_cs, polygon_distance, polygons_intersect

DT = 0.05
MAX_SEGMENTS = 30
MAX_SEGMENT_DISTANCE_M = 50.0
MAX_WAIT_S = 60.0
MIN_SPEED_MPS = 0.1
EPS = 1e-9


def ego_polygon(x: float, y: float, heading: float, v: dict[str, Any]) -> Polygon:
    c = cos(heading)
    s = sin(heading)
    d = v["length"] / 2.0 - v["rearOverhang"]
    return box_corners_cs(x + d * c, y + d * s, c, s, v["length"], v["width"])


class _Agent:
    def __init__(self, spec: dict[str, Any]) -> None:
        self.spec = spec
        self.c = cos(spec["heading"])
        self.s = sin(spec["heading"])
        self.traveled = 0.0
        self.x = spec["x"]
        self.y = spec["y"]

    def polygon(self) -> Polygon:
        return box_corners_cs(self.x, self.y, self.c, self.s, self.spec["length"], self.spec["width"])

    def corridor(self) -> Polygon:
        ahead = self.spec["length"] / 2.0 + self.spec["yieldDistanceM"] / 2.0
        return box_corners_cs(
            self.x + ahead * self.c,
            self.y + ahead * self.s,
            self.c,
            self.s,
            self.spec["yieldDistanceM"],
            self.spec["width"] + 0.4,
        )


def simulate(instance: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    v = instance["vehicle"]
    obstacle_polys = [
        (o["id"], box_corners_cs(o["x"], o["y"], cos(o["heading"]), sin(o["heading"]), o["length"], o["width"]))
        for o in instance["obstacles"]
    ]
    agents = [_Agent(spec) for spec in instance["agents"]]

    st: dict[str, Any] = {
        "x": instance["ego"]["x"],
        "y": instance["ego"]["y"],
        "heading": instance["ego"]["heading"],
        "steer": 0.0,
        "speed": 0.0,
        "t": 0.0,
        "step": 0,
        "collision": None,
        "time_limit": False,
        "min_static": None,
        "min_agents": None,
    }
    trajectory: list[list[float]] = []
    agent_frames: list[list[float]] = []

    def record() -> None:
        trajectory.append([st["t"], st["x"], st["y"], st["heading"], st["steer"], st["speed"]])
        frame: list[float] = []
        for a in agents:
            frame.extend([a.x, a.y])
        agent_frames.append(frame)

    def check() -> bool:
        ego = ego_polygon(st["x"], st["y"], st["heading"], v)
        for oid, poly in obstacle_polys:
            d = polygon_distance(ego, poly)
            if st["min_static"] is None or d < st["min_static"]:
                st["min_static"] = d
            if st["collision"] is None and d == 0.0:
                st["collision"] = {"step": st["step"], "t": st["t"], "withId": oid}
        for a in agents:
            d = polygon_distance(ego, a.polygon())
            if st["min_agents"] is None or d < st["min_agents"]:
                st["min_agents"] = d
            if st["collision"] is None and d == 0.0:
                st["collision"] = {"step": st["step"], "t": st["t"], "withId": a.spec["id"]}
        return st["collision"] is not None

    def move_agents(dt: float) -> None:
        ego = ego_polygon(st["x"], st["y"], st["heading"], v)
        for a in agents:
            behaviour = a.spec["behaviour"]
            if behaviour == "stationary":
                continue
            if st["t"] < a.spec["startDelayS"]:
                continue
            if behaviour == "yielding" and polygons_intersect(ego, a.corridor()):
                continue
            a.traveled = a.traveled + a.spec["speedMps"] * dt
            a.x = a.spec["x"] + a.traveled * a.c
            a.y = a.spec["y"] + a.traveled * a.s

    def finish_step(dt: float) -> bool:
        move_agents(dt)
        st["t"] = st["t"] + dt
        st["step"] = st["step"] + 1
        record()
        if check():
            return True
        if st["t"] > instance["timeLimitS"] + EPS:
            st["time_limit"] = True
            return True
        return False

    steer_travel = 0.0
    direction_changes = 0
    last_gear = None

    record()
    stopped = check()

    for seg in plan["segments"][:MAX_SEGMENTS]:
        if stopped:
            break
        if seg["kind"] == "drive":
            seg_speed = clamp(seg["speedMps"], MIN_SPEED_MPS, v["maxSpeedMps"])
            sign = -1.0 if seg["gear"] == "R" else 1.0
            target = clamp(deg_to_rad(seg["steerDeg"]), -v["maxSteer"], v["maxSteer"])
            remaining = clamp(seg["distanceM"], 0.0, MAX_SEGMENT_DISTANCE_M)
            if remaining <= EPS:
                continue
            if last_gear is not None and last_gear != seg["gear"]:
                direction_changes = direction_changes + 1
            last_gear = seg["gear"]
            while remaining > EPS and not stopped:
                ds = min(seg_speed * DT, remaining)
                dt = ds / seg_speed
                max_delta = v["maxSteerRate"] * dt
                diff = target - st["steer"]
                if diff > max_delta:
                    new_steer = st["steer"] + max_delta
                elif diff < -max_delta:
                    new_steer = st["steer"] - max_delta
                else:
                    new_steer = target
                steer_travel = steer_travel + abs(new_steer - st["steer"])
                st["steer"] = new_steer
                c = cos(st["heading"])
                s = sin(st["heading"])
                ds_signed = sign * ds
                st["x"] = st["x"] + ds_signed * c
                st["y"] = st["y"] + ds_signed * s
                st["heading"] = st["heading"] + (ds_signed * tan(st["steer"])) / v["wheelbase"]
                st["speed"] = sign * seg_speed
                remaining = remaining - ds
                stopped = finish_step(dt)
            st["speed"] = 0.0
        else:
            remaining = clamp(seg["durationS"], 0.0, MAX_WAIT_S)
            st["speed"] = 0.0
            while remaining > EPS and not stopped:
                dt = min(DT, remaining)
                remaining = remaining - dt
                stopped = finish_step(dt)

    goal = instance["goal"]
    dx = st["x"] - goal["x"]
    dy = st["y"] - goal["y"]
    pos_err = sqrt(dx * dx + dy * dy)
    head_err = abs(normalize_angle(st["heading"] - goal["heading"]))
    goal_reached = (
        st["collision"] is None
        and not st["time_limit"]
        and pos_err <= goal["positionTol"]
        and head_err <= goal["headingTol"]
    )
    t = st["t"]
    return {
        "goalReached": goal_reached,
        "collision": st["collision"],
        "timeLimitExceeded": st["time_limit"],
        "finalPose": {"x": st["x"], "y": st["y"], "heading": st["heading"]},
        "finalPositionErrorM": pos_err,
        "finalHeadingErrorDeg": rad_to_deg(head_err),
        "minClearanceStaticM": st["min_static"],
        "minClearanceAgentsM": st["min_agents"],
        "directionChanges": direction_changes,
        "durationS": t,
        "steeringSmoothnessDegPerS": rad_to_deg(steer_travel) / t if t > 0 else 0.0,
        "steps": st["step"],
        "trajectory": trajectory,
        "agentFrames": agent_frames,
    }
