import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Pencil, Trash2, X, Check } from 'lucide-react';
import { formatTimeSP } from '../utils/time';

function InlineTagSelector({ initialTagLabel, tags, onAddTag, onTagSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(null);
  const inputRef = useRef(null);

  const colors = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#A855F7', '#EC4899', '#A16207', '#64748B'];

  useEffect(() => {
    setInputValue(initialTagLabel || '');
    const tag = tags.find(t => t.label === initialTagLabel);
    setSelectedColor(tag ? tag.color : null);
    onTagSelect(initialTagLabel || '', tag ? tag.color : null);
  }, [initialTagLabel, tags]); // Need to set parent state initially if needed

  const filteredTags = tags.filter(t => t.label?.toLowerCase().includes(inputValue?.toLowerCase() || ''));
  const exactMatch = tags.find(t => t.label?.toLowerCase() === inputValue.trim().toLowerCase());
  const isTagConfirmed = exactMatch && !isDropdownOpen;

  const handleSelectTag = (tag) => {
    setInputValue(tag.label);
    setSelectedColor(tag.color);
    setIsDropdownOpen(false);
    onTagSelect(tag.label, tag.color);
  };

  return (
    <div className="relative mb-2">
      {!isTagConfirmed ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              onTagSelect(e.target.value, selectedColor);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            placeholder="Tag..."
            className="w-full px-2 py-1.5 bg-clinical-card border border-clinical-border rounded-lg text-sm font-bold text-clinical-text focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-clinical-secondary/50 placeholder:font-normal"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                 e.preventDefault();
                 setIsDropdownOpen(false);
              }
            }}
          />
          {isDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-clinical-card border border-clinical-border rounded-lg shadow-lg z-50 p-1 scrollbar-stable">
              {filteredTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => handleSelectTag(tag)}
                  className="w-full text-left px-2 py-1.5 hover:bg-clinical-bg rounded-md flex items-center"
                >
                  <span 
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" 
                    style={{ backgroundColor: tag.color || '#F59E0B' }}
                  >
                    {tag.label}
                  </span>
                </button>
              ))}
              {inputValue.trim() && (
                <button
                  onClick={() => setIsDropdownOpen(false)}
                  className="w-full text-left px-2 py-1.5 hover:bg-clinical-bg rounded-md flex items-center gap-2 text-xs text-clinical-text"
                >
                  <span className="text-clinical-secondary">Criar nova tag:</span>
                  <span className="font-bold text-amber-500">"{inputValue}"</span>
                </button>
              )}
              {filteredTags.length === 0 && !inputValue.trim() && (
                <div className="px-2 py-1.5 text-xs text-clinical-secondary italic">Nenhuma tag existente.</div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2 p-2 bg-clinical-card border border-clinical-border rounded-lg mb-2">
          <div className="flex items-center justify-between">
            <span 
              className="text-xs font-bold px-2 py-0.5 rounded text-white shadow-sm" 
              style={{ backgroundColor: exactMatch.color || '#F59E0B' }}
            >
              {exactMatch.label}
            </span>
            <button 
              onClick={() => {
                setInputValue('');
                setSelectedColor(null);
                setTimeout(() => inputRef.current?.focus(), 50);
                onTagSelect('', null);
              }}
              className="text-clinical-secondary hover:text-clinical-text"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {!exactMatch && inputValue.trim() && (
        <div className="flex gap-1.5 flex-wrap justify-center mt-2">
          {colors.map(color => (
            <button
              key={color}
              onClick={() => {
                setSelectedColor(color);
                onTagSelect(inputValue, color);
              }}
              className={`w-5 h-5 rounded-full transition-all ${selectedColor === color || (!selectedColor && color === '#F59E0B') ? 'ring-2 ring-white ring-offset-2 ring-offset-clinical-bg scale-110' : 'hover:scale-110 border border-black/10 dark:border-white/10'}`}
              style={{ backgroundColor: color }}
              title="Criar/usar tag com esta cor"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentsPanel({ comments, tags = [], onAddTag, onEdit, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [editTagColor, setEditTagColor] = useState(null);

  const startEdit = (comment) => {
    setEditingId(comment.id);
    setEditTitle(comment.title || '');
    setEditText(comment.text || '');
    const tag = tags.find(t => t.label === comment.title);
    setEditTagColor(tag ? tag.color : null);
  };

  const confirmEdit = async () => {
    const finalTitle = editTitle.trim();
    if (finalTitle) {
      if (onAddTag) {
        await onAddTag(finalTitle, editTagColor || '#F59E0B');
      }
    }
    onEdit(editingId, finalTitle, editText.trim());
    setEditingId(null);
    setEditTitle('');
    setEditText('');
    setEditTagColor(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditText('');
    setEditTagColor(null);
  };

  if (!comments || comments.length === 0) {
    return (
      <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
        <h3 className="text-xs font-bold text-clinical-secondary uppercase tracking-wider mb-4 flex items-center gap-2">
          <MessageSquare size={14} className="text-amber-500" />
          Comentários
        </h3>
        <div className="text-center py-4">
          <MessageSquare size={24} className="mx-auto text-clinical-secondary/30 mb-2" />
          <p className="text-xs text-clinical-secondary">Nenhum comentário</p>
          <p className="text-[10px] text-clinical-secondary/50 mt-1">Ative o modo de comentário no gráfico para adicionar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-clinical-card rounded-xl border border-clinical-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-clinical-secondary uppercase tracking-wider flex items-center gap-2">
          <MessageSquare size={14} className="text-amber-500" />
          Comentários
        </h3>
        <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-bold">
          {comments.length}
        </span>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-stable">
        {comments.map((comment) => {
          const tag = tags.find(t => t.label === comment.title);
          const tagColor = tag ? tag.color : '#F59E0B';
          
          return (
            <div
              key={comment.id}
              className="group p-3 bg-clinical-bg rounded-lg border border-clinical-border hover:border-amber-500/30 transition-all"
            >
              {editingId === comment.id ? (
                <div className="flex flex-col gap-2">
                  <InlineTagSelector
                    initialTagLabel={editTitle}
                    tags={tags}
                    onAddTag={onAddTag}
                    onTagSelect={(label, color) => {
                      setEditTitle(label);
                      setEditTagColor(color);
                    }}
                  />
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Observação..."
                    className="w-full px-2 py-1.5 bg-clinical-card border border-clinical-border rounded-lg text-xs text-clinical-text focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit(); }
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <div className="flex gap-1 justify-end">
                    <button onClick={cancelEdit} className="p-1 hover:bg-clinical-card rounded text-clinical-secondary">
                      <X size={14} />
                    </button>
                    <button onClick={confirmEdit} className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 rounded text-green-600">
                      <Check size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      {comment.title && (
                        <div className="mb-1.5">
                          <span 
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white inline-block max-w-full truncate align-bottom" 
                            style={{ backgroundColor: tagColor }}
                            title={comment.title}
                          >
                            {comment.title}
                          </span>
                        </div>
                      )}
                      {comment.text && (
                        <p className="text-xs text-clinical-text leading-relaxed break-words whitespace-pre-wrap">{comment.text}</p>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => startEdit(comment)}
                        className="p-1 hover:bg-clinical-card rounded text-clinical-secondary hover:text-amber-500 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => onDelete(comment.id)}
                        className="p-1 hover:bg-clinical-card rounded text-clinical-secondary hover:text-red-500 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-clinical-secondary mt-1.5 font-mono">
                    {formatTimeSP(comment.timestamp)}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
