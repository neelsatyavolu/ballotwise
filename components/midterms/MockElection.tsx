"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { readMock, setMock, type Mock } from "@/lib/midterms/clock";
import { ELECTION_DAY_START, stampET } from "@/lib/midterms/polls";
import { useClock } from "./hooks";

const HOUR = 3_600_000;
/** Where a mock night can start, in hours after midnight Eastern on Nov 3: 5 PM to 3 AM. */
const STARTS = Array.from({ length: 21 }, (_, i) => 17 + i / 2);
/** Night seconds per real second. At 60×, each 15-second poll moves the night on 15 minutes. */
const SPEEDS = [1, 10, 30, 60, 120];

const noSubscribe = () => () => {};
const mockKey = () => JSON.stringify(readMock());

/**
 * Development only: a switch for a mock election night that runs, so the tracker's live updates, calls, flips and
 * pop-ups can be watched before Nov 3. Starting, changing speed or stopping reloads the page on the new clock.
 */
export function MockElection() {
  // Read through the snapshot's JSON so the stored object compares equal between renders.
  const raw = useSyncExternalStore(noSubscribe, mockKey, () => "null");
  const mock = useMemo(() => JSON.parse(raw) as Mock | null, [raw]);
  const now = useClock(1000);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(17.5);
  const [speed, setSpeed] = useState(60);
  const hoursNow = (now - ELECTION_DAY_START) / HOUR;

  if (mock) {
    return (
      <div className="mt-mock on" role="region" aria-label="Mock election night">
        <b>Mock night</b>
        <span className="num">{stampET(now)} ET</span>
        <select aria-label="Speed" value={mock.speed} onChange={(e) => setMock(hoursNow, Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
        <button type="button" className="mt-linkish" onClick={() => setMock(null)}>Stop</button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="mt-mock" onClick={() => setOpen(true)} title="Development only: run a made-up election night">
        Mock election
      </button>
    );
  }
  return (
    <div className="mt-mock" role="region" aria-label="Mock election night">
      <b>Mock election</b>
      <label>
        Start at{" "}
        <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
          {STARTS.map((h) => (
            <option key={h} value={h}>{stampET(ELECTION_DAY_START + h * HOUR)}</option>
          ))}
        </select>
      </label>
      <label>
        Speed{" "}
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </label>
      <button type="button" className="btn small" onClick={() => setMock(start, speed)}>Start</button>
      <button type="button" className="mt-linkish" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
