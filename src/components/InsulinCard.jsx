import React, { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { formatTimeSP } from '../utils/time';

export default function InsulinCard({ carelink, workoutStart, workoutEnd, customInsulin, onInsulinChange }) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(customInsulin || '');

  useEffect(() => {
    setInputValue(customInsulin || '');
  }, [customInsulin]);

  if (!carelink) return null;

  const startTs = typeof workoutStart === 'object' ? workoutStart.getTime() : workoutStart;
  const endTs = typeof workoutEnd === 'object' ? workoutEnd.getTime() : workoutEnd;

  const preWorkoutThreshold = startTs - 2 * 60 * 60 * 1000;
  const postWorkoutThreshold = endTs + 1 * 60 * 60 * 1000;
  
  const relevantBolus = (carelink.bolusEvents || []).filter(b => {
    const bTs = typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp;
    return bTs >= preWorkoutThreshold && bTs <= postWorkoutThreshold;
  });

  const activeBasal = (carelink.basalChanges || [])
    .filter(b => {
       const bTs = typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp;
       return bTs <= startTs;
    })
    .slice(-1)[0]?.rate || 0;

  const handleSave = () => {
    if (onInsulinChange && inputValue.trim()) {
      onInsulinChange(inputValue.trim());
      setIsEditing(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setInputValue(customInsulin || '');
      setIsEditing(false);
    }
  };

  return (
    <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
      {isEditing ? (
        <div>
          <p className="text-xs text-clinical-secondary uppercase font-bold mb-2">Insulina Ativa</p>
          <div className="flex gap-1.5 items-center mb-4">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="0.5"
              className="flex-1 px-2 py-0.5 bg-clinical-bg border border-blue-500 rounded text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <button onClick={handleSave} className="text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded transition-colors">✓</button>
            <button onClick={() => {
              setInputValue(customInsulin || '');
              setIsEditing(false);
            }} className="text-xs font-bold text-clinical-secondary hover:text-red-500 px-2 py-1">✕</button>
          </div>
        </div>
      ) : (
        <div className="mb-4 cursor-pointer group" onClick={() => setIsEditing(true)}>
          <p className="text-xs text-clinical-secondary uppercase font-bold mb-1">Insulina Ativa</p>
          <div className="flex items-center gap-2">
            <p className="font-mono font-bold text-sm text-clinical-text group-hover:text-blue-500 transition-colors">
              {customInsulin ? `${customInsulin} U/h` : '-'}
            </p>
            <Pencil size={14} className="text-blue-500" />
          </div>
        </div>
      )}

      <div className="space-y-0">
        <p className="text-xs text-clinical-secondary uppercase font-bold mb-1">Eventos de Bolus</p>
        <div>
        {relevantBolus.length === 0 ? (
          <p className="text-xs text-clinical-secondary italic">Nenhum bolus no período</p>
        ) : (
          relevantBolus.map((b, i) => {
            const bTs = typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp;
            return (
              <div key={i} className={`flex justify-between items-center border-b border-clinical-border last:border-0 ${i === 0 ? 'pt-0 pb-1' : 'py-1'}`}>
                <div className="flex flex-col">
                  <span className="text-sm font-bold font-mono text-clinical-text">{b.volume} U</span>
                  <span className="text-[10px] text-clinical-secondary">{formatTimeSP(b.timestamp)} • {b.type}</span>
                </div>
                {bTs > endTs ? (
                  <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-bold uppercase">Pós-treino</span>
                ) : bTs >= startTs ? (
                  <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded font-bold uppercase">No Treino</span>
                ) : (
                  <span className="text-[10px] bg-clinical-bg text-clinical-secondary px-1.5 py-0.5 rounded font-bold uppercase">Pré-treino</span>
                )}
              </div>
            );
          })
        )}
        </div>
      </div>
    </div>
  );
}
