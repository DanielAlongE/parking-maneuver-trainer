/**
 * Plays a plan in a scenario instance and scores it.
 * Twin: packages/sim-py/src/mt_sim/simulate.py
 *
 * Model: kinematic bicycle at the rear axle, explicit Euler, 50 ms steps.
 * The last step of a segment is shortened so the segment ends exactly at its
 * distance or duration. The run stops at the first collision.
 */
import { clamp, cos, degToRad, normalizeAngle, radToDeg, sin, sqrt, tan } from "./dmath.js";
import { boxCornersCS, polygonDistance, polygonsIntersect, type Polygon } from "./geometry.js";
import type { AgentSpec, Collision, Plan, ScenarioInstance, SimResult, VehicleProfile } from "./types.js";

export const DT = 0.05;
export const MAX_SEGMENTS = 30;
export const MAX_SEGMENT_DISTANCE_M = 50.0;
export const MAX_WAIT_S = 60.0;
export const MIN_SPEED_MPS = 0.1;
const EPS = 1e-9;

interface AgentState {
  spec: AgentSpec;
  c: number;
  s: number;
  traveled: number;
  x: number;
  y: number;
}

export function egoPolygon(x: number, y: number, heading: number, v: VehicleProfile): Polygon {
  const c = cos(heading);
  const s = sin(heading);
  const d = v.length / 2.0 - v.rearOverhang;
  return boxCornersCS(x + d * c, y + d * s, c, s, v.length, v.width);
}

function agentPolygon(a: AgentState): Polygon {
  return boxCornersCS(a.x, a.y, a.c, a.s, a.spec.length, a.spec.width);
}

/** The strip in front of an agent that it checks before moving. */
function agentCorridor(a: AgentState): Polygon {
  const ahead = a.spec.length / 2.0 + a.spec.yieldDistanceM / 2.0;
  return boxCornersCS(
    a.x + ahead * a.c,
    a.y + ahead * a.s,
    a.c,
    a.s,
    a.spec.yieldDistanceM,
    a.spec.width + 0.4,
  );
}

export function simulate(instance: ScenarioInstance, plan: Plan): SimResult {
  const v = instance.vehicle;
  const obstaclePolys = instance.obstacles.map((o) => ({
    id: o.id,
    poly: boxCornersCS(o.x, o.y, cos(o.heading), sin(o.heading), o.length, o.width),
  }));
  const agents: AgentState[] = instance.agents.map((spec) => ({
    spec,
    c: cos(spec.heading),
    s: sin(spec.heading),
    traveled: 0.0,
    x: spec.x,
    y: spec.y,
  }));

  let x = instance.ego.x;
  let y = instance.ego.y;
  let heading = instance.ego.heading;
  let steer = 0.0;
  let speed = 0.0;
  let t = 0.0;
  let step = 0;
  let steerTravel = 0.0;
  let directionChanges = 0;
  let lastGear: "D" | "R" | null = null;
  let collision: Collision | null = null;
  let timeLimitExceeded = false;
  let minStatic: number | null = null;
  let minAgents: number | null = null;

  const trajectory: number[][] = [];
  const agentFrames: number[][] = [];

  const record = () => {
    trajectory.push([t, x, y, heading, steer, speed]);
    const frame: number[] = [];
    for (const a of agents) frame.push(a.x, a.y);
    agentFrames.push(frame);
  };

  /** Records clearances; returns true if the ego collided. */
  const check = (): boolean => {
    const ego = egoPolygon(x, y, heading, v);
    for (const o of obstaclePolys) {
      const d = polygonDistance(ego, o.poly);
      if (minStatic === null || d < minStatic) minStatic = d;
      if (collision === null && d === 0.0) collision = { step, t, withId: o.id };
    }
    for (const a of agents) {
      const d = polygonDistance(ego, agentPolygon(a));
      if (minAgents === null || d < minAgents) minAgents = d;
      if (collision === null && d === 0.0) collision = { step, t, withId: a.spec.id };
    }
    return collision !== null;
  };

  const moveAgents = (dt: number) => {
    const ego = egoPolygon(x, y, heading, v);
    for (const a of agents) {
      if (a.spec.behaviour === "stationary") continue;
      if (t < a.spec.startDelayS) continue;
      if (a.spec.behaviour === "yielding" && polygonsIntersect(ego, agentCorridor(a))) continue;
      a.traveled = a.traveled + a.spec.speedMps * dt;
      a.x = a.spec.x + a.traveled * a.c;
      a.y = a.spec.y + a.traveled * a.s;
    }
  };

  /** Ends one step: advance the clock, move agents, record, check. */
  const finishStep = (dt: number): boolean => {
    moveAgents(dt);
    t = t + dt;
    step = step + 1;
    record();
    if (check()) return true;
    if (t > instance.timeLimitS + EPS) {
      timeLimitExceeded = true;
      return true;
    }
    return false;
  };

  record();
  let stopped = check();

  for (const seg of plan.segments.slice(0, MAX_SEGMENTS)) {
    if (stopped) break;
    if (seg.kind === "drive") {
      const segSpeed = clamp(seg.speedMps, MIN_SPEED_MPS, v.maxSpeedMps);
      const sign = seg.gear === "R" ? -1.0 : 1.0;
      const target = clamp(degToRad(seg.steerDeg), -v.maxSteer, v.maxSteer);
      let remaining = clamp(seg.distanceM, 0.0, MAX_SEGMENT_DISTANCE_M);
      if (remaining <= EPS) continue;
      if (lastGear !== null && lastGear !== seg.gear) directionChanges = directionChanges + 1;
      lastGear = seg.gear;
      while (remaining > EPS && !stopped) {
        const ds = Math.min(segSpeed * DT, remaining);
        const dt = ds / segSpeed;
        const maxDelta = v.maxSteerRate * dt;
        const diff = target - steer;
        let newSteer: number;
        if (diff > maxDelta) newSteer = steer + maxDelta;
        else if (diff < -maxDelta) newSteer = steer - maxDelta;
        else newSteer = target;
        steerTravel = steerTravel + Math.abs(newSteer - steer);
        steer = newSteer;
        const c = cos(heading);
        const s = sin(heading);
        const dsSigned = sign * ds;
        x = x + dsSigned * c;
        y = y + dsSigned * s;
        heading = heading + (dsSigned * tan(steer)) / v.wheelbase;
        speed = sign * segSpeed;
        remaining = remaining - ds;
        stopped = finishStep(dt);
      }
      speed = 0.0;
    } else {
      let remaining = clamp(seg.durationS, 0.0, MAX_WAIT_S);
      speed = 0.0;
      while (remaining > EPS && !stopped) {
        const dt = Math.min(DT, remaining);
        remaining = remaining - dt;
        stopped = finishStep(dt);
      }
    }
  }

  const dx = x - instance.goal.x;
  const dy = y - instance.goal.y;
  const posErr = sqrt(dx * dx + dy * dy);
  const headErr = Math.abs(normalizeAngle(heading - instance.goal.heading));
  const goalReached =
    collision === null &&
    !timeLimitExceeded &&
    posErr <= instance.goal.positionTol &&
    headErr <= instance.goal.headingTol;

  return {
    goalReached,
    collision,
    timeLimitExceeded,
    finalPose: { x, y, heading },
    finalPositionErrorM: posErr,
    finalHeadingErrorDeg: radToDeg(headErr),
    minClearanceStaticM: minStatic,
    minClearanceAgentsM: minAgents,
    directionChanges,
    durationS: t,
    steeringSmoothnessDegPerS: t > 0 ? radToDeg(steerTravel) / t : 0.0,
    steps: step,
    trajectory,
    agentFrames,
  };
}
