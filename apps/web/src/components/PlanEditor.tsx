import type { Segment } from "@mt/sim-core";
import { newDrive, newWait, type SegmentEnd } from "../lib/plan";

/**
 * The list of moves. Clicking a row highlights that move on the scene.
 * With `readOnly` it shows a submitted plan for review.
 */
export function PlanEditor({
  segments,
  onChange,
  selected,
  onSelect,
  ends,
  readOnly = false,
}: {
  segments: Segment[];
  onChange?: (s: Segment[]) => void;
  selected: number | null;
  onSelect: (i: number | null) => void;
  ends: SegmentEnd[];
  readOnly?: boolean;
}) {
  const set = (next: Segment[]) => onChange?.(next);
  const update = (i: number, patch: Partial<Segment>) =>
    set(segments.map((seg, j) => (j === i ? ({ ...seg, ...patch } as Segment) : seg)));
  const remove = (i: number) => {
    set(segments.filter((_, j) => j !== i));
    onSelect(null);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= segments.length) return;
    const next = [...segments];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
    onSelect(j);
  };
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <div>
      <table className="segments">
        <thead>
          <tr>
            <th>#</th>
            <th>Move</th>
            <th>Steer (°, + left)</th>
            <th>Distance (m) / time (s)</th>
            <th>Speed (m/s)</th>
            {!readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {segments.map((seg, i) => (
            <tr
              key={i}
              className={`${selected === i ? "selected" : ""} ${ends[i] && !ends[i]!.completed ? "stopped" : ""}`}
              onClick={() => onSelect(selected === i ? null : i)}
            >
              <td>{i + 1}</td>
              {seg.kind === "drive" ? (
                <>
                  <td>
                    {readOnly ? (
                      seg.gear === "D" ? "Forward" : "Reverse"
                    ) : (
                      <select
                        value={seg.gear}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update(i, { gear: e.target.value as "D" | "R" })}
                      >
                        <option value="D">Forward</option>
                        <option value="R">Reverse</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {!readOnly && (
                      <input
                        type="range"
                        min={-35}
                        max={35}
                        step={1}
                        value={seg.steerDeg}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update(i, { steerDeg: Number(e.target.value) })}
                        aria-label={`Move ${i + 1} steering`}
                      />
                    )}
                    <span className="num">{seg.steerDeg}</span>
                  </td>
                  <td>
                    {readOnly ? (
                      seg.distanceM
                    ) : (
                      <input
                        type="number"
                        step={0.25}
                        min={0}
                        value={seg.distanceM}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update(i, { distanceM: num(e.target.value) })}
                        aria-label={`Move ${i + 1} distance`}
                      />
                    )}
                  </td>
                  <td>
                    {readOnly ? (
                      seg.speedMps
                    ) : (
                      <input
                        type="number"
                        step={0.1}
                        min={0.1}
                        max={4.2}
                        value={seg.speedMps}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update(i, { speedMps: num(e.target.value) })}
                        aria-label={`Move ${i + 1} speed`}
                      />
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td>Wait</td>
                  <td />
                  <td>
                    {readOnly ? (
                      seg.durationS
                    ) : (
                      <input
                        type="number"
                        step={0.5}
                        min={0}
                        value={seg.durationS}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update(i, { durationS: num(e.target.value) })}
                        aria-label={`Move ${i + 1} wait time`}
                      />
                    )}
                  </td>
                  <td />
                </>
              )}
              {!readOnly && (
                <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button onClick={() => remove(i)} aria-label="Remove">✕</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="row gap">
          <button
            onClick={() => {
              set([...segments, newDrive()]);
              onSelect(segments.length);
            }}
          >
            Add move
          </button>
          <button
            onClick={() => {
              set([...segments, newWait()]);
              onSelect(segments.length);
            }}
          >
            Add wait
          </button>
        </div>
      )}
      <p className="hint">Click a move to highlight it. Numbered outlines show where the car is after each move.</p>
    </div>
  );
}
