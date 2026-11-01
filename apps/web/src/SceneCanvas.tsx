import { boxCorners, egoPolygon, type ScenarioInstance, type SimResult } from "@mt/sim-core";
import { useEffect, useRef, useState } from "react";

type Pt = [number, number];

const COLORS = {
  ground: "#e9ece6",
  road: "#4b5157",
  kerb: "#c9ccc4",
  parked: "#9aa4b1",
  parkedEdge: "#6b7480",
  goal: "#3fb27f",
  path: "#7cc4ff",
  ego: "#2f7fd8",
  egoHit: "#e0473c",
  agent: "#f0a030",
};

/** Top-down view of the scenario at one frame of the simulated run. */
export function SceneCanvas({
  instance,
  result,
  frame,
}: {
  instance: ScenarioInstance;
  result: SimResult;
  frame: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // World bounds from the static obstacles plus the start and goal, with a margin.
  const pts: Pt[] = [
    ...instance.obstacles.flatMap((o) => boxCorners(o.x, o.y, o.heading, o.length, o.width)),
    ...egoPolygon(instance.ego.x, instance.ego.y, instance.ego.heading, instance.vehicle),
    ...egoPolygon(instance.goal.x, instance.goal.y, instance.goal.heading, instance.vehicle),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const margin = 1.5;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const scale = width / (maxX - minX);
  const height = Math.round((maxY - minY) * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const toScreen = ([x, y]: Pt): Pt => [(x - minX) * scale, (maxY - y) * scale];
    const poly = (p: Pt[], fill: string | null, stroke: string | null, dash: number[] = [], lw = 1.5) => {
      ctx.beginPath();
      p.map(toScreen).forEach(([sx, sy], i) => (i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.setLineDash(dash);
        ctx.lineWidth = lw;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    /** Short line across the front of a polygon, so heading is readable. */
    const frontMark = (p: Pt[], color: string) => {
      const [a, b] = [toScreen(p[0]!), toScreen(p[3]!)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, width, height);

    // Road surface between the kerbs.
    const kerbs = instance.obstacles.filter((o) => o.kind === "kerb");
    if (kerbs.length >= 2) {
      const kys = kerbs.map((k) => k.y);
      const kxs = kerbs.flatMap((k) => [k.x - k.length / 2, k.x + k.length / 2]);
      poly(
        [
          [Math.min(...kxs), Math.min(...kys)],
          [Math.max(...kxs), Math.min(...kys)],
          [Math.max(...kxs), Math.max(...kys)],
          [Math.min(...kxs), Math.max(...kys)],
        ],
        COLORS.road,
        null,
      );
    }

    for (const o of instance.obstacles) {
      const p = boxCorners(o.x, o.y, o.heading, o.length, o.width);
      if (o.kind === "kerb") poly(p, COLORS.kerb, null);
      else poly(p, COLORS.parked, COLORS.parkedEdge);
    }

    const goal = egoPolygon(instance.goal.x, instance.goal.y, instance.goal.heading, instance.vehicle);
    poly(goal, "rgba(63,178,127,0.18)", COLORS.goal, [6, 4], 2);
    frontMark(goal, COLORS.goal);

    // Rear-axle path of the whole plan.
    ctx.beginPath();
    result.trajectory.forEach((row, i) => {
      const [sx, sy] = toScreen([row[1]!, row[2]!]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.path;
    ctx.stroke();

    const f = Math.min(frame, result.trajectory.length - 1);
    const agentRow = result.agentFrames[f] ?? [];
    instance.agents.forEach((a, i) => {
      const ax = agentRow[2 * i]!;
      const ay = agentRow[2 * i + 1]!;
      const p = boxCorners(ax, ay, a.heading, a.length, a.width);
      poly(p, COLORS.agent, "#a8650c");
      frontMark(p, "#5a3505");
    });

    const row = result.trajectory[f]!;
    const ego = egoPolygon(row[1]!, row[2]!, row[3]!, instance.vehicle);
    const hit = result.collision !== null && f >= result.collision.step;
    poly(ego, hit ? COLORS.egoHit : COLORS.ego, "#123a66");
    frontMark(ego, "#ffffff");
  }, [instance, result, frame, width, height, minX, maxY, scale]);

  return (
    <div ref={wrapRef} className="scene">
      <canvas ref={canvasRef} style={{ width, height }} />
    </div>
  );
}
