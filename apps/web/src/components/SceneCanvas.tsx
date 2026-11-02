import { boxCorners, egoPolygon, type ScenarioInstance, type SimResult } from "@mt/sim-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SegmentEnd } from "../lib/plan";

type Pt = [number, number];

const COLORS = {
  ground: "#e9ece6",
  road: "#4b5157",
  kerb: "#c9ccc4",
  parked: "#9aa4b1",
  parkedEdge: "#6b7480",
  goal: "#3fb27f",
  path: "#7cc4ff",
  pathSelected: "#ffd166",
  ego: "#2f7fd8",
  egoHit: "#e0473c",
  agent: "#f0a030",
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

interface View {
  zoom: number;
  /** World point at the centre of the canvas. */
  cx: number;
  cy: number;
}

/**
 * Top-down view of a scenario at one frame of a simulated run.
 * Scroll or use +/− to zoom, drag to pan, Fit to reset.
 * `ends` draws a numbered ghost car where each move finishes.
 */
export function SceneCanvas({
  instance,
  result,
  frame,
  ends = [],
  selected = null,
}: {
  instance: ScenarioInstance;
  result: SimResult;
  frame: number;
  ends?: SegmentEnd[];
  selected?: number | null;
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

  // World bounds of the static scene, start and goal, with a margin.
  const bounds = useMemo(() => {
    const pts: Pt[] = [
      ...instance.obstacles.flatMap((o) => boxCorners(o.x, o.y, o.heading, o.length, o.width)),
      ...egoPolygon(instance.ego.x, instance.ego.y, instance.ego.heading, instance.vehicle),
      ...egoPolygon(instance.goal.x, instance.goal.y, instance.goal.heading, instance.vehicle),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const m = 1.5;
    return { minX: Math.min(...xs) - m, maxX: Math.max(...xs) + m, minY: Math.min(...ys) - m, maxY: Math.max(...ys) + m };
  }, [instance]);

  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const height = Math.round(Math.min(480, Math.max(260, (width * worldH) / worldW)));
  const baseScale = Math.min(width / worldW, height / worldH);

  const fitView = useCallback(
    (): View => ({ zoom: 1, cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2 }),
    [bounds],
  );
  const [view, setView] = useState<View>(fitView);
  useEffect(() => setView(fitView()), [fitView]);

  const scale = baseScale * view.zoom;
  const toScreen = useCallback(
    ([x, y]: Pt): Pt => [(x - view.cx) * scale + width / 2, (view.cy - y) * scale + height / 2],
    [view, scale, width, height],
  );

  const zoomAt = useCallback(
    (factor: number, sx = width / 2, sy = height / 2) => {
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
        const s0 = baseScale * v.zoom;
        const s1 = baseScale * zoom;
        // Keep the world point under the cursor fixed.
        const wx = v.cx + (sx - width / 2) / s0;
        const wy = v.cy - (sy - height / 2) / s0;
        return { zoom, cx: wx - (sx - width / 2) / s1, cy: wy + (sy - height / 2) / s1 };
      });
    },
    [baseScale, width, height],
  );

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, cx: v.cx - dx / (baseScale * v.zoom), cy: v.cy + dy / (baseScale * v.zoom) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    const frontMark = (p: Pt[], color: string) => {
      const [a, b] = [toScreen(p[0]!), toScreen(p[3]!)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    const pathPart = (from: number, to: number, color: string, lw: number) => {
      ctx.beginPath();
      for (let i = Math.max(0, from); i <= Math.min(to, result.trajectory.length - 1); i++) {
        const row = result.trajectory[i]!;
        const [sx, sy] = toScreen([row[1]!, row[2]!]);
        if (i === Math.max(0, from)) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, width, height);

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

    pathPart(0, result.trajectory.length - 1, COLORS.path, 2);
    if (selected !== null && ends[selected]) {
      const from = selected === 0 ? 0 : ends[selected - 1]!.step;
      pathPart(from, ends[selected]!.step, COLORS.pathSelected, 4);
    }

    // Numbered ghost car where each move ends.
    ends.forEach((end, i) => {
      if (!end.completed && i > 0 && !ends[i - 1]!.completed) return;
      const p = egoPolygon(end.pose.x, end.pose.y, end.pose.heading, instance.vehicle);
      const isSel = selected === i;
      poly(p, isSel ? "rgba(255,209,102,0.35)" : "rgba(255,255,255,0.18)", isSel ? "#e0a800" : "rgba(255,255,255,0.75)", [4, 3], 1.5);
    });

    const f = Math.min(frame, result.trajectory.length - 1);
    const agentRow = result.agentFrames[f] ?? [];
    instance.agents.forEach((a, i) => {
      const p = boxCorners(agentRow[2 * i]!, agentRow[2 * i + 1]!, a.heading, a.length, a.width);
      poly(p, COLORS.agent, "#a8650c");
      frontMark(p, "#5a3505");
    });

    const row = result.trajectory[f]!;
    const ego = egoPolygon(row[1]!, row[2]!, row[3]!, instance.vehicle);
    const hit = result.collision !== null && f >= result.collision.step;
    poly(ego, hit ? COLORS.egoHit : COLORS.ego, "#123a66");
    frontMark(ego, "#ffffff");

    // Move numbers last, on top of everything.
    ends.forEach((end, i) => {
      if (!end.completed && i > 0 && !ends[i - 1]!.completed) return;
      const p = egoPolygon(end.pose.x, end.pose.y, end.pose.heading, instance.vehicle);
      const c = p.reduce<Pt>((acc, q) => [acc[0] + q[0] / 4, acc[1] + q[1] / 4], [0, 0]);
      const [sx, sy] = toScreen(c);
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = selected === i ? "#e0a800" : "rgba(29,35,42,0.8)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), sx, sy + 0.5);
    });
  }, [instance, result, frame, width, height, toScreen, ends, selected]);

  return (
    <div ref={wrapRef} className="scene">
      <canvas
        ref={canvasRef}
        style={{ width, height, cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Top-down view of the scenario. Scroll to zoom, drag to pan."
        role="img"
      />
      <div className="scene-tools">
        <button onClick={() => zoomAt(1.4)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">−</button>
        <button onClick={() => setView(fitView())}>Fit</button>
      </div>
    </div>
  );
}
