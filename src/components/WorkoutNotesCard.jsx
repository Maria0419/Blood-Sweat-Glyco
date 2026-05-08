import React, { useState, useEffect, useRef } from 'react';
import { FileText, Pencil, Check } from 'lucide-react';

export default function WorkoutNotesCard({ notes, onSave }) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [observation, setObservation] = useState('');
  const titleRef = useRef(null);

  useEffect(() => {
    setTitle(notes?.title || '');
    setObservation(notes?.observation || '');
    setIsEditing(false);
  }, [notes]);

  const startEdit = () => {
    setIsEditing(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const save = () => {
    onSave({ title: title.trim(), observation: observation.trim() });
    setIsEditing(false);
  };

  const hasContent = notes?.title || notes?.observation;

  return (
    <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-clinical-secondary uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} className="text-clinical-primary" />
          Notas do Treino
        </h3>
        {!isEditing && (
          <button
            onClick={startEdit}
            className="p-1 hover:bg-clinical-bg rounded text-clinical-secondary hover:text-clinical-primary transition-colors"
            title="Editar"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div>
            <label className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider block mb-1">Título</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Intervalado no parque"
              className="w-full px-3 py-2 bg-clinical-bg border border-clinical-border rounded-lg text-sm text-clinical-text font-bold focus:outline-none focus:ring-2 focus:ring-clinical-primary placeholder:text-clinical-secondary/40 placeholder:font-normal"
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
          </div>
          <div>
            <label className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider block mb-1">Observação</label>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Como se sentiu, clima, alimentação..."
              className="w-full px-3 py-2 bg-clinical-bg border border-clinical-border rounded-lg text-xs text-clinical-text focus:outline-none focus:ring-2 focus:ring-clinical-primary resize-none placeholder:text-clinical-secondary/40"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
              }}
            />
          </div>
          <button
            onClick={save}
            className="w-full py-2 text-xs font-bold text-white bg-clinical-primary rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
          >
            <Check size={14} />
            Salvar
          </button>
        </div>
      ) : hasContent ? (
        <div className="space-y-2 cursor-pointer group" onClick={startEdit}>
          {notes.title && (
            <p className="text-sm font-bold text-clinical-text group-hover:text-clinical-primary transition-colors">{notes.title}</p>
          )}
          {notes.observation && (
            <p className="text-xs text-clinical-secondary leading-relaxed whitespace-pre-wrap">{notes.observation}</p>
          )}
        </div>
      ) : (
        <div className="text-center py-3 cursor-pointer group" onClick={startEdit}>
          <p className="text-xs text-clinical-secondary group-hover:text-clinical-primary transition-colors">
            Clique para adicionar título e observação
          </p>
        </div>
      )}
    </div>
  );
}
