import React from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

export default function GlucoseImpactCard({ impact }) {
  if (!impact) return null;

  const getTrendIcon = (val) => {
    if (!val) return <Minus size={16} />;
    if (val > 0) return <TrendingUp size={16} className="text-emerald-600" />;
    return <TrendingDown size={16} className="text-red-500" />;
  };

  const variationClass = impact.variation > 0
    ? 'text-emerald-600'
    : impact.variation < 0
      ? 'text-red-500'
      : 'text-clinical-secondary';

  return (
    <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
      <h3 className="text-xs font-bold text-clinical-secondary uppercase tracking-wider mb-4">Impacto na Glicemia</h3>
      
      <div className="flex items-end gap-3 mb-6">
        <span className="text-4xl font-mono font-bold text-clinical-text">{impact.end || '—'}</span>
        <span className="text-sm text-clinical-secondary font-medium mb-1.5">mg/dL</span>
        <div className="flex flex-col ml-auto text-right">
          <div className={`flex items-center justify-end gap-1 font-mono font-bold ${variationClass}`}>
            {getTrendIcon(impact.variation)}
            {impact.variation > 0 ? '+' : ''}{impact.variation}
          </div>
          <span className="text-[10px] text-clinical-secondary uppercase font-bold">Variação no treino</span>
        </div>
      </div>

      <div className="space-y-3">
        <MetricRow label="1h antes" value={impact.preWorkout} />
        <MetricRow label="Início" value={impact.start} />
        <MetricRow label="Mínima" value={impact.min} />
        <MetricRow label="Fim" value={impact.end} />
        <MetricRow label="1h depois" value={impact.postWorkout} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-clinical-border last:border-0">
      <span className="text-xs text-clinical-secondary font-medium">{label}</span>
      <span className="text-xs font-mono font-bold text-clinical-text">{value ? `${value} mg/dL` : '—'}</span>
    </div>
  );
}
