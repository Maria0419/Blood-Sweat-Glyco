import React from 'react';

const SERIES_CONFIG = [
  { key: 'glucose', label: 'Glicose', emoji: '🩸', color: '#2563EB' },
  { key: 'bolus', label: 'Insulina', emoji: '💉', color: '#7C3AED' },
  { key: 'heartRate', label: 'FC', emoji: '❤️', color: '#F43F5E' },
  { key: 'pace', label: 'Ritmo', emoji: '⚡', color: '#059669' },
  { key: 'relativeLoad', label: 'Carga Relativa', emoji: '📊', color: '#D97706' },
];

export default function SeriesToggle({ activeSeries, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SERIES_CONFIG.map(({ key, label, emoji, color }) => {
        const isActive = activeSeries[key];
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`
              px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2
              flex items-center gap-2
            `}
            style={{
              borderColor: color,
              backgroundColor: isActive ? color : 'transparent',
              color: isActive ? '#FFFFFF' : color,
            }}
          >
            <span>{emoji}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
