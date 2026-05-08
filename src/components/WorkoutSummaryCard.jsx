import React from 'react';

export default function WorkoutSummaryCard({ metrics }) {
  if (!metrics) return null;

  return (
    <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
      <h3 className="text-xs font-bold text-clinical-secondary uppercase tracking-wider mb-4">Resumo do Treino</h3>
      
      <div className="grid grid-cols-2 gap-y-4 gap-x-2">
        <SummaryItem label="Pace Médio" value={metrics.avgPace} />
        <SummaryItem label="Carga Relativa" value={`${metrics.avgRelativeLoad}%`} />
        <SummaryItem label="FC Média" value={`${metrics.avgHR} bpm`} />
        <SummaryItem label="FC Máxima" value={`${metrics.maxHR} bpm`} />
        <SummaryItem label="Watts Médios" value={`${metrics.avgWatts} W`} />
        <SummaryItem label="Watts Máximos" value={`${metrics.maxWatts} W`} />
      </div>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-clinical-secondary uppercase font-bold">{label}</p>
      <p className="font-mono font-bold text-sm text-clinical-text">{value}</p>
    </div>
  );
}
