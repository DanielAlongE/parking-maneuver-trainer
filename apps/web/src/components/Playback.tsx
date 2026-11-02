import type { SimResult } from "@mt/sim-core";
import { useEffect, useState } from "react";

/** Play / pause and a scrubber over the simulated run. Jumps to the end when the result changes. */
export function usePlayback(result: SimResult) {
  const lastFrame = result.trajectory.length - 1;
  const [frame, setFrame] = useState(lastFrame);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setFrame(lastFrame);
    setPlaying(false);
  }, [result, lastFrame]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    let f = frame >= lastFrame ? 0 : frame;
    const tick = (now: number) => {
      f = Math.min(lastFrame, f + Math.max(1, Math.round((now - prev) / 50)));
      prev = now;
      setFrame(f);
      if (f < lastFrame) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps -- frame is read once at start

  return { frame: Math.min(frame, lastFrame), setFrame, playing, setPlaying, lastFrame };
}

export function PlaybackBar({ result, pb }: { result: SimResult; pb: ReturnType<typeof usePlayback> }) {
  return (
    <div className="playback">
      <button onClick={() => pb.setPlaying((p) => !p)}>{pb.playing ? "Pause" : "Play"}</button>
      <input
        type="range"
        min={0}
        max={pb.lastFrame}
        value={pb.frame}
        aria-label="Time"
        onChange={(e) => {
          pb.setPlaying(false);
          pb.setFrame(Number(e.target.value));
        }}
      />
      <span className="num">{(result.trajectory[pb.frame]?.[0] ?? 0).toFixed(1)} s</span>
    </div>
  );
}
