import React from 'react';

export function SynergyGraph({ nodes, edges }: { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string; w?: number }>}){
  // Minimal placeholder: render as list; real graph can be added later
  return (
    <div className="rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/80">
      <div className="font-semibold text-white mb-2">Synergies</div>
      <ul className="list-disc pl-5">
        {edges.slice(0,3).map((e,i)=>{
          const a = nodes.find(n=>n.id===e.from)?.label || e.from;
          const b = nodes.find(n=>n.id===e.to)?.label || e.to;
          return <li key={i}>{a} ↔ {b}</li>;
        })}
      </ul>
    </div>
  );
}

export default SynergyGraph;
