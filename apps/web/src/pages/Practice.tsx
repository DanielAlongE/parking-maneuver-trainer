import { templates, vehicles } from "@mt/scenarios";
import { instantiate, simulate, type Segment } from "@mt/sim-core";
import { useMemo, useState } from "react";
import { Feedback } from "../components/Feedback";
import { PlanEditor } from "../components/PlanEditor";
import { PlaybackBar, usePlayback } from "../components/Playback";
import { SceneCanvas } from "../components/SceneCanvas";
import { newDrive, segmentEnds } from "../lib/plan";

/** Free practice on any scenario and seed. Nothing is submitted. */
export function Practice() {
  const [templateId, setTemplateId] = useState("parallel-park-kerbside");
  const [seed, setSeed] = useState(7);
  const [segments, setSegments] = useState<Segment[]>([newDrive()]);
  const [selected, setSelected] = useState<number | null>(null);

  const template = templates[templateId]!;
  const instance = useMemo(() => instantiate(template, seed, vehicles), [template, seed]);
  const result = useMemo(() => simulate(instance, { segments }), [instance, segments]);
  const ends = useMemo(() => segmentEnds(instance, segments, result), [instance, segments, result]);
  const pb = usePlayback(result);

  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h1>Practice</h1>
          <p className="muted">{template.description} Nothing here is submitted or scored for points.</p>
        </div>
        <div className="row gap">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Scenario">
            {Object.values(templates).map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.title}
              </option>
            ))}
          </select>
          <label className="row gap-sm">
            Seed
            <input
              className="seed"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
          </label>
        </div>
      </div>
      <SceneCanvas instance={instance} result={result} frame={pb.frame} ends={ends} selected={selected} />
      <PlaybackBar result={result} pb={pb} />
      <div className="columns">
        <section className="panel">
          <h2>Plan</h2>
          <PlanEditor segments={segments} onChange={setSegments} selected={selected} onSelect={setSelected} ends={ends} />
        </section>
        <section className="panel">
          <h2>Feedback</h2>
          <Feedback instance={instance} result={result} />
        </section>
      </div>
    </div>
  );
}
