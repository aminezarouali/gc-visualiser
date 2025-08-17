import React, { useMemo, useState } from "react";

/**
 * GC Visualizer — Slides 25–36 (Dark Mode)
 * Same simulator, now with high‑contrast dark theme for readability.
 */

// ---------- Types ----------

type Obj = {
  id: string;
  addr: number;    // start address in the heap array
  size: number;    // total cells, including header
  fields: (number | null)[]; // length = size-1
  marked?: boolean;          // for Phase 1
  newAddr?: number | null;   // for Phase 2 mapping
};

// ---------- Helpers ----------

function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function sortByAddr<T extends { addr: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.addr - b.addr);
}

// Build a memory tape (array) from objects. Empty cells are `null`.
function buildMemory(objects: Obj[], memorySize: number, phase: Phase): (number | string | null)[] {
  const mem: (number | string | null)[] = Array(memorySize).fill(null);
  for (const o of objects) {
    if (o.addr < 0 || o.addr + o.size > memorySize) continue; // skip invalid
    const headerVal = phase === "mark" || phase === "prepare" ? (o.marked ? -o.size : o.size) : o.size;
    mem[o.addr] = headerVal;
    for (let i = 0; i < o.fields.length; i++) {
      const cellIdx = o.addr + 1 + i;
      const v = o.fields[i];
      mem[cellIdx] = v === null ? null : `@${v}`; // render pointers as "@addr"
    }
  }
  return mem;
}

// DFS mark reachable objects from root.
function markReachable(objects: Obj[], rootAddr: number | null): Obj[] {
  const map = new Map(objects.map(o => [o.addr, o]));
  const visited = new Set<number>();
  function dfs(addr: number | null) {
    if (addr == null) return;
    const o = map.get(addr);
    if (!o || visited.has(addr)) return;
    visited.add(addr);
    o.marked = true;
    for (const p of o.fields) {
      if (p != null) dfs(p);
    }
  }
  if (rootAddr != null) dfs(rootAddr);
  return objects;
}

// Phase 2: compute new addresses for marked objects by scanning in address order
// and update pointers to point to the new address (without moving payload yet).
function prepareCompaction(objects: Obj[], memorySize: number, rootAddr: number | null) {
  const sorted = sortByAddr(objects);
  let newAddr = 0;
  const oldToNew = new Map<number, number>();
  for (const o of sorted) {
    if (o.marked) {
      oldToNew.set(o.addr, newAddr);
      o.newAddr = newAddr;
      newAddr += o.size;
    }
  }
  // Update pointers in-place to the new addresses
  for (const o of objects) {
    o.fields = o.fields.map(cell => (cell != null && oldToNew.has(cell) ? oldToNew.get(cell)! : cell));
  }
  const newRoot = rootAddr != null && oldToNew.has(rootAddr) ? oldToNew.get(rootAddr)! : null;
  return { objects, oldToNew, newRoot, nextFree: newAddr };
}

// Phase 3: crunch — move live objects to their new addresses and drop garbage.
function crunch(objects: Obj[], oldToNew: Map<number, number>) {
  const kept: Obj[] = [];
  for (const o of sortByAddr(objects)) {
    if (!o.marked) continue; // drop garbage
    const na = oldToNew.get(o.addr)!;
    kept.push({ ...o, addr: na, newAddr: null, marked: false });
  }
  return kept;
}

// Pretty render helper for addresses and IDs
function labelFor(o: Obj) {
  return `${o.id}@${o.addr}`;
}

// ---------- Component ----------

type Phase = "idle" | "mark" | "prepare" | "crunch";

type Scenario = {
  name: string;
  memorySize: number;
  root: number | null;
  objects: Obj[];
};

function makeDefaultScenario(): Scenario {
  const objects: Obj[] = [
    { id: "A", addr: 2,  size: 4, fields: [8, 14, null] },
    { id: "B", addr: 8,  size: 3, fields: [14, null] },
    { id: "C", addr: 14, size: 3, fields: [null, null] },
    { id: "D", addr: 22, size: 5, fields: [null, null, null, null] },
  ];
  return { name: "A→B→C with garbage D", memorySize: 36, root: 2, objects };
}

// Dark palette (high‑contrast)
const COLORS = {
  header: "bg-zinc-700 text-zinc-100",
  marked: "bg-amber-900/40 border border-amber-500",
  moved: "bg-emerald-900/40 border border-emerald-500",
  pointer: "text-sky-300",
};

export default function GCVisualizer() {
  const [scenario, setScenario] = useState<Scenario>(() => makeDefaultScenario());
  const [objects, setObjects] = useState<Obj[]>(() => deepClone(scenario.objects));
  const [root, setRoot] = useState<number | null>(scenario.root);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mapping, setMapping] = useState<Map<number, number>>(new Map());
  const [nextFree, setNextFree] = useState<number>(objects.reduce((m, o) => Math.max(m, o.addr + o.size), 0));

  // --- History for Previous button ---
  type Snap = { objects: Obj[]; root: number | null; phase: Phase; mapping: Array<[number, number]>; nextFree: number };
  const [history, setHistory] = useState<Snap[]>([]);
  const takeSnap = (): Snap => ({
    objects: deepClone(objects),
    root,
    phase,
    mapping: [...mapping.entries()],
    nextFree,
  });
  const pushHistory = () => setHistory(h => [...h, takeSnap()]);
  const goPrev = () => setHistory(h => {
    if (h.length === 0) return h;
    const last = h[h.length - 1];
    setObjects(deepClone(last.objects));
    setRoot(last.root);
    setPhase(last.phase);
    setMapping(new Map(last.mapping));
    setNextFree(last.nextFree);
    return h.slice(0, -1);
  });

  const memory = useMemo(() => buildMemory(objects, scenario.memorySize, phase), [objects, scenario.memorySize, phase]);

  function reset() {
    const sc = makeDefaultScenario();
    setScenario(sc);
    setObjects(deepClone(sc.objects));
    setRoot(sc.root);
    setPhase("idle");
    setMapping(new Map());
    setNextFree(sc.objects.reduce((m, o) => Math.max(m, o.addr + o.size), 0));
    setHistory([]);
  }

  function doMark() {
    if (phase !== "idle") return;
    pushHistory();
    const objs = deepClone(objects);
    markReachable(objs, root);
    setObjects(objs);
    setPhase("mark");
  }

  function doPrepare() {
    if (phase !== "mark") return;
    pushHistory();
    const objs = deepClone(objects);
    const { oldToNew, newRoot, nextFree } = prepareCompaction(objs, scenario.memorySize, root);
    setObjects(objs);
    setMapping(oldToNew);
    setRoot(newRoot);
    setNextFree(nextFree);
    setPhase("prepare");
  }

  function doCrunch() {
    if (phase !== "prepare") return;
    pushHistory();
    const objs = crunch(deepClone(objects), mapping);
    setObjects(objs);
    setPhase("crunch");
  }

  function autoRun() {
    if (phase === "idle") { doMark(); return; }
    if (phase === "mark") { doPrepare(); return; }
    if (phase === "prepare") { doCrunch(); return; }
  }

  function changeRoot(addr: number) {
    if (phase === "idle") setRoot(addr);
  }

  function addGarbage() {
    if (phase !== "idle") return;
    const lastEnd = objects.reduce((m, o) => Math.max(m, o.addr + o.size), 0);
    const free = scenario.memorySize - lastEnd;
    if (free < 3) return;
    const g: Obj = { id: `G${Math.floor(Math.random()*90+10)}`, addr: lastEnd+1, size: 3, fields: [null, null] };
    setObjects(sortByAddr([...objects, g]));
  }

  // ---------- Render ----------
  return (
    <div className="w-full mx-auto max-w-6xl p-4 space-y-4 bg-zinc-950 text-zinc-100 min-h-screen">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compacting Mark &amp; Sweep — Interactive (Slides 25–36)</h1>
          <p className="text-sm text-zinc-300">Vector memory model with 3 phases: Mark → Sweep-prepare → Sweep-crunch. Use <span className="font-medium">Previous</span>/<span className="font-medium">Next</span> to step.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="px-3 py-2 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100">Reset</button>
          <button onClick={addGarbage} className="px-3 py-2 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100">Add garbage</button>
          <button onClick={goPrev} disabled={history.length===0} className={`px-3 py-2 rounded-2xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 ${history.length===0?"opacity-50 cursor-not-allowed":""}`}>Previous</button>
          <button onClick={autoRun} className="px-3 py-2 rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700">Next</button>
        </div>
      </header>

      {/* Phase status */}
      <div className="grid grid-cols-3 gap-2">
        {(["idle","mark","prepare","crunch"] as Phase[]).map(p => (
          <div key={p} className={`rounded-2xl p-3 border ${phase===p?"border-emerald-500 bg-emerald-950/30":"border-zinc-700 bg-zinc-900"}`}>
            <div className="text-xs uppercase tracking-wide text-zinc-400">{p === "idle" ? "setup" : p}</div>
            <div className="font-semibold">
              {p === "idle" && "Setup: choose root & layout"}
              {p === "mark" && "Phase 1: Mark reachable (size→-size)"}
              {p === "prepare" && "Phase 2: Prepare (compute new addresses; retarget pointers)"}
              {p === "crunch" && "Phase 3: Crunch (move objects; root & nextFree updated)"}
            </div>
          </div>
        ))}
      </div>

      {/* Legend & Root */}
      <div className="flex items-center gap-4 text-sm">
        <span className="px-2 py-1 rounded bg-zinc-700 text-zinc-100">header</span>
        <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-100">payload</span>
        <span className="px-2 py-1 rounded border border-amber-500 bg-amber-900/40">marked</span>
        <span className="px-2 py-1 rounded border border-emerald-500 bg-emerald-900/40">moved</span>
        <span>root: <span className="font-mono">{root==null?"null":`@${root}`}</span></span>
        <span>nextFree: <span className="font-mono">{nextFree}</span></span>
      </div>

      {/* Memory tape */}
      <section>
        <h2 className="font-semibold mb-2">Heap Memory</h2>
        <div className="overflow-x-auto">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${scenario.memorySize}, minmax(2rem, 1fr))` }}>
            {memory.map((cell, i) => {
              let cls = "border border-zinc-700 text-xs text-center py-2 font-mono bg-zinc-900";
              let label = cell === null ? "·" : String(cell);
              const owner = objects.find(o => o.addr === i);
              if (owner) {
                if (phase === "crunch") {
                  cls += " " + COLORS.moved;
                } else if (phase === "mark" || phase === "prepare") {
                  cls += owner.marked ? ` ${COLORS.marked}` : " bg-zinc-900";
                } else {
                  cls += " " + COLORS.header;
                }
              }
              if (typeof cell === "string" && cell.startsWith("@")) {
                cls += " " + COLORS.pointer;
              }
              return (
                <div key={i} className={cls} title={`addr ${i}`}>
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Object list + interactions */}
      <section className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h2 className="font-semibold">Objects</h2>
          {sortByAddr(objects).map(o => (
            <div key={o.id} className={`p-3 rounded-2xl border ${o.marked?"border-amber-500 bg-amber-900/20":"border-zinc-700 bg-zinc-900"}`}>
              <div className="flex items-center justify-between">
                <div className="font-mono font-semibold">{labelFor(o)}<span className="ml-2 text-xs text-zinc-400">size={o.size}</span></div>
                <div className="flex items-center gap-2">
                  {phase === "idle" && (
                    <button
                      className={`text-xs px-2 py-1 rounded border ${root===o.addr?"bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700":"bg-zinc-800 hover:bg-zinc-700 border-zinc-700"}`}
                      onClick={() => changeRoot(o.addr)}
                    >
                      Set as root
                    </button>
                  )}
                  {phase !== "idle" && o.marked && o.newAddr != null && (
                    <span className="text-xs px-2 py-1 rounded bg-emerald-900/30 border border-emerald-500">→ {o.newAddr}</span>
                  )}
                </div>
              </div>
              <div className="mt-2 text-sm">
                <div className="flex gap-2 items-center">
                  <span className="text-zinc-400">fields:</span>
                  {o.fields.map((f, idx) => (
                    <span key={idx} className="font-mono px-2 py-1 rounded bg-zinc-800 border border-zinc-700">{f==null?"null":`@${f}`}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold">Mapping (Phase 2)</h2>
          <div className="p-3 rounded-2xl border border-zinc-700 bg-zinc-900 min-h-[4rem]">
            {mapping.size === 0 ? (
              <div className="text-sm text-zinc-400">Run Phase 1 and 2 to compute the old→new address mapping.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...mapping.entries()].sort((a,b)=>a[0]-b[0]).map(([oldA, newA]) => (
                  <span key={oldA} className="text-xs px-2 py-1 rounded bg-emerald-900/30 border border-emerald-500 font-mono">@{oldA} → @{newA}</span>
                ))}
              </div>
            )}
          </div>

          <h2 className="font-semibold">What to look for</h2>
          <ul className="list-disc ml-5 text-sm space-y-1 text-zinc-300">
            <li><b>Phase 1 (Mark)</b>: reachable objects’ headers flip sign (size → −size). Unreachable remain positive.</li>
            <li><b>Phase 2 (Prepare)</b>: a dense layout is planned; pointers are retargeted to those <i>planned</i> addresses. No bytes move yet.</li>
            <li><b>Phase 3 (Crunch)</b>: survivors slide left to their new addresses; garbage holes disappear; <code>root</code> and <code>nextFree</code> reflect the compacted heap.</li>
          </ul>
          <p className="text-xs text-zinc-400">Tip: Add some garbage before running to see compaction clearer.</p>
        </div>
      </section>

      <footer className="pt-2 border-t border-zinc-800 text-xs text-zinc-400">
        Educational simulator inspired by slides 25–36: vector memory model, root handling, and a 3‑phase compacting mark&amp;sweep collector.
      </footer>
    </div>
  );
}
