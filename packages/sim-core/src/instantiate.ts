/**
 * Template + seed -> immutable scenario instance.
 * Twin: packages/sim-py/src/mt_sim/instantiate.py
 */
import { degToRad, roundMm } from "./dmath.js";
import { Rng } from "./rng.js";
import type {
  AgentBehaviour,
  NumExpr,
  ScenarioInstance,
  ScenarioTemplate,
  StrExpr,
  VehicleProfile,
  VehicleProfileSpec,
} from "./types.js";

export function resolveVehicle(name: string, specs: Record<string, VehicleProfileSpec>): VehicleProfile {
  const v = specs[name];
  if (!v) throw new Error(`Unknown vehicle profile: ${name}`);
  return {
    name,
    length: v.length,
    width: v.width,
    wheelbase: v.wheelbase,
    rearOverhang: v.rearOverhang,
    maxSteer: degToRad(v.maxSteerDeg),
    maxSteerRate: degToRad(v.maxSteerRateDeg),
    maxSpeedMps: v.maxSpeedMps,
  };
}

export function sampleParams(template: ScenarioTemplate, seed: number): Record<string, number | string> {
  const rng = new Rng(seed);
  const out: Record<string, number | string> = {};
  const names = Object.keys(template.params).sort();
  for (const name of names) {
    const spec = template.params[name]!;
    const u = rng.next();
    if ("choices" in spec) {
      out[name] = spec.choices[Math.floor(u * spec.choices.length)]!;
    } else {
      out[name] = roundMm(spec.min + (spec.max - spec.min) * u);
    }
  }
  return out;
}

function num(expr: NumExpr, params: Record<string, number | string>): number {
  if (typeof expr === "number") return expr;
  if ("param" in expr) {
    const v = params[expr.param];
    if (typeof v !== "number") throw new Error(`Parameter ${expr.param} is not a number`);
    return v;
  }
  if ("sum" in expr) {
    if (expr.sum.length === 0) throw new Error("Empty sum");
    let acc = num(expr.sum[0]!, params);
    for (let i = 1; i < expr.sum.length; i++) acc = acc + num(expr.sum[i]!, params);
    return acc;
  }
  return num(expr.mul[0], params) * num(expr.mul[1], params);
}

function str(expr: StrExpr, params: Record<string, number | string>): string {
  if (typeof expr === "string") return expr;
  const v = params[expr.param];
  if (typeof v !== "string") throw new Error(`Parameter ${expr.param} is not a string`);
  return v;
}

export function instantiate(
  template: ScenarioTemplate,
  seed: number,
  vehicles: Record<string, VehicleProfileSpec>,
): ScenarioInstance {
  const p = sampleParams(template, seed);
  const n = (e: NumExpr) => num(e, p);
  return {
    templateId: template.templateId,
    seed,
    params: p,
    vehicle: resolveVehicle(template.vehicleProfile, vehicles),
    timeLimitS: template.timeLimitS,
    ego: { x: n(template.ego.x), y: n(template.ego.y), heading: degToRad(n(template.ego.headingDeg)) },
    goal: {
      x: n(template.goal.x),
      y: n(template.goal.y),
      heading: degToRad(n(template.goal.headingDeg)),
      positionTol: n(template.goal.positionTolM),
      headingTol: degToRad(n(template.goal.headingTolDeg)),
    },
    obstacles: template.obstacles.map((o) => ({
      id: o.id,
      kind: o.kind,
      x: n(o.x),
      y: n(o.y),
      heading: degToRad(n(o.headingDeg)),
      length: n(o.length),
      width: n(o.width),
    })),
    agents: template.agents.map((a) => ({
      id: a.id,
      kind: a.kind,
      behaviour: str(a.behaviour, p) as AgentBehaviour,
      x: n(a.x),
      y: n(a.y),
      heading: degToRad(n(a.headingDeg)),
      length: n(a.length),
      width: n(a.width),
      speedMps: n(a.speedMps),
      startDelayS: n(a.startDelayS),
      yieldDistanceM: n(a.yieldDistanceM),
    })),
  };
}
