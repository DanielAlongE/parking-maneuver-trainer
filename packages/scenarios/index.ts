import narrowStreet from "./templates/narrow-street-oncoming.json";
import parallelPark from "./templates/parallel-park-kerbside.json";
import threePointTurn from "./templates/three-point-turn.json";
import vehiclesJson from "./vehicles.json";
import type { ScenarioTemplate, VehicleProfileSpec } from "@mt/sim-core";

export const vehicles = vehiclesJson as Record<string, VehicleProfileSpec>;

export const templates: Record<string, ScenarioTemplate> = {
  "parallel-park-kerbside": parallelPark as unknown as ScenarioTemplate,
  "three-point-turn": threePointTurn as unknown as ScenarioTemplate,
  "narrow-street-oncoming": narrowStreet as unknown as ScenarioTemplate,
};
