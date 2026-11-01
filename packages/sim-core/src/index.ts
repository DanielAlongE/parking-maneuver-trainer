export * from "./types.js";
export * as dmath from "./dmath.js";
export { Rng } from "./rng.js";
export { boxCorners, polygonDistance, polygonsIntersect } from "./geometry.js";
export { instantiate, resolveVehicle, sampleParams } from "./instantiate.js";
export { simulate, egoPolygon, DT, MAX_SEGMENTS } from "./simulate.js";

/** Bump when a change alters simulation results; golden vectors record it. */
export const SIM_VERSION = "0.1.0";
