/**
 * Shared types. Poses refer to the midpoint of the rear axle; headings are
 * radians, counter-clockwise from +x. Units are metres and seconds.
 */

export interface VehicleProfileSpec {
  length: number;
  width: number;
  wheelbase: number;
  rearOverhang: number;
  maxSteerDeg: number;
  maxSteerRateDeg: number;
  maxSpeedMps: number;
}

export interface VehicleProfile {
  name: string;
  length: number;
  width: number;
  wheelbase: number;
  rearOverhang: number;
  maxSteer: number;
  maxSteerRate: number;
  maxSpeedMps: number;
}

/** A number in a template: a literal, a parameter, or a sum / product. */
export type NumExpr = number | { param: string } | { sum: NumExpr[] } | { mul: [NumExpr, NumExpr] };
export type StrExpr = string | { param: string };

export type ParamSpec = { min: number; max: number } | { choices: (number | string)[] };

export interface ScenarioTemplate {
  schemaVersion: string;
  templateId: string;
  family: "parking" | "tight-turn" | "negotiation" | "obstruction";
  title: string;
  description: string;
  difficultyTier: number;
  vehicleProfile: string;
  timeLimitS: number;
  params: Record<string, ParamSpec>;
  ego: { x: NumExpr; y: NumExpr; headingDeg: NumExpr };
  goal: {
    x: NumExpr;
    y: NumExpr;
    headingDeg: NumExpr;
    positionTolM: NumExpr;
    headingTolDeg: NumExpr;
  };
  obstacles: {
    id: string;
    kind: string;
    x: NumExpr;
    y: NumExpr;
    headingDeg: NumExpr;
    length: NumExpr;
    width: NumExpr;
  }[];
  agents: {
    id: string;
    kind: string;
    behaviour: StrExpr;
    x: NumExpr;
    y: NumExpr;
    headingDeg: NumExpr;
    length: NumExpr;
    width: NumExpr;
    speedMps: NumExpr;
    startDelayS: NumExpr;
    yieldDistanceM: NumExpr;
  }[];
}

export type AgentBehaviour = "assertive" | "yielding" | "stationary";

export interface Obstacle {
  id: string;
  kind: string;
  /** Centre of the box. */
  x: number;
  y: number;
  heading: number;
  length: number;
  width: number;
}

export interface AgentSpec extends Obstacle {
  behaviour: AgentBehaviour;
  speedMps: number;
  startDelayS: number;
  yieldDistanceM: number;
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export interface ScenarioInstance {
  templateId: string;
  seed: number;
  params: Record<string, number | string>;
  vehicle: VehicleProfile;
  timeLimitS: number;
  ego: Pose;
  goal: Pose & { positionTol: number; headingTol: number };
  obstacles: Obstacle[];
  agents: AgentSpec[];
}

export type Segment =
  | { kind: "drive"; gear: "D" | "R"; steerDeg: number; distanceM: number; speedMps: number }
  | { kind: "wait"; durationS: number };

export interface Plan {
  segments: Segment[];
}

export interface Collision {
  step: number;
  t: number;
  withId: string;
}

export interface SimResult {
  goalReached: boolean;
  collision: Collision | null;
  timeLimitExceeded: boolean;
  finalPose: Pose;
  finalPositionErrorM: number;
  finalHeadingErrorDeg: number;
  /** null when the scenario has no static obstacles / agents. */
  minClearanceStaticM: number | null;
  minClearanceAgentsM: number | null;
  directionChanges: number;
  durationS: number;
  steeringSmoothnessDegPerS: number;
  steps: number;
  /** One row per step: [t, x, y, heading, steer, speed]. Row 0 is the start. */
  trajectory: number[][];
  /** One row per step: [x0, y0, x1, y1, ...] agent box centres. */
  agentFrames: number[][];
}
