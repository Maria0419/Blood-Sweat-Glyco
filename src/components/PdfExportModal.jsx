import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, CheckSquare, ChevronDown, FileText, Square, X } from 'lucide-react';
import Calendar from './Calendar';
import { formatDayMonthSP, formatMonthYearSP } from '../utils/time';
import { translateSport } from '../utils/sports';

const SERIES_OPTIONS = [
  { key: 'pace', label: 'Ritmo', color: '#059669' },
  { key: 'relativeLoad', label: 'Carga Relativa', color: '#D97706' },
  { key: 'heartRate', label: 'FC', color: '#F43F5E' },
];

function SeriesButton({ active, color, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-all"
      style={{
        borderColor: color,
        backgroundColor: active ? color : 'transparent',
        color: active ? '#FFFFFF' : color,
      }}
    >
      {label}
    </button>
  );
}

function capitalizeFirst(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function PdfExportModal({
  isOpen,
  onClose,
  filteredWorkouts,
  calendarWorkouts,
  availableMonths,
  availableSports,
  exportFilterDate,
  exportFilterMonth,
  exportSportFilters,
  onExportDateChange,
  onExportMonthChange,
  onToggleExportSport,
  onClearExportFilters,
  effectiveWorkouts,
  selectedFilteredCount,
  selectedWorkoutIds,
  onSelectAll,
  onClearSelection,
  onToggleWorkoutSelection,
  globalSeries,
  overrides,
  onToggleGlobal,
  onToggleOverride,
  onClearOverride,
  onExport,
  isExporting,
}) {
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const monthDropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setIsCalendarExpanded(false);
      setIsMonthDropdownOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isMonthDropdownOpen) return undefined;

    function handleClickOutside(event) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(event.target)) {
        setIsMonthDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMonthDropdownOpen]);

  const selectedExportDate = exportFilterDate ? new Date(`${exportFilterDate}T12:00:00`) : null;
  const selectedMonthLabel = useMemo(() => (
    availableMonths.find((month) => month.value === exportFilterMonth)?.label || ''
  ), [availableMonths, exportFilterMonth]);
  const monthSummary = exportFilterMonth ? selectedMonthLabel : 'Todos os meses';
  const dateSummary = selectedExportDate
    ? formatDayMonthSP(selectedExportDate)
    : exportFilterMonth
      ? selectedMonthLabel
      : 'Todos os dias';

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[160] flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-clinical-card rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-clinical-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-clinical-text">Exportar PDF</h2>
              <p className="text-xs text-clinical-secondary">
                {selectedFilteredCount > 0
                  ? `${selectedFilteredCount} treino(s) marcados`
                  : 'Nenhum treino marcado: o PDF vai usar todos os treinos do filtro do popup'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-clinical-bg rounded-full text-clinical-secondary transition-colors"
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto scrollbar-stable space-y-4">
          <div className="rounded-2xl border border-clinical-border bg-clinical-card p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-clinical-secondary">
                  Filtros do PDF
                </p>
                <p className="text-xs text-clinical-secondary mt-1">
                  Esses filtros valem só para a exportação, não para a lateral do app.
                </p>
              </div>
              <button
                type="button"
                onClick={onClearExportFilters}
                className="text-[11px] font-bold text-clinical-primary hover:underline"
              >
                Limpar filtros
              </button>
            </div>

            <div className="grid grid-cols-[1.15fr_1fr] gap-2.5 items-stretch">
              <div className="flex h-full flex-col gap-1">
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-clinical-secondary">Dia</span>
                <div className="flex flex-1 flex-col justify-start">
                  <button
                    type="button"
                    onClick={() => setIsCalendarExpanded((prev) => !prev)}
                    className="w-full min-h-[40px] px-2.5 py-1.5 bg-clinical-bg border border-clinical-border rounded-xl text-left transition-colors hover:border-clinical-primary"
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <CalendarIcon size={13} className="text-clinical-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-clinical-text truncate">{capitalizeFirst(dateSummary)}</p>
                        </div>
                      </div>
                      <ChevronDown
                        size={13}
                        className={`text-clinical-secondary transition-transform shrink-0 ${isCalendarExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {isCalendarExpanded && (
                    <Calendar
                      workouts={calendarWorkouts}
                      selectedDate={selectedExportDate}
                      visibleMonthKey={exportFilterMonth}
                      onSelectDate={(date) => {
                        if (!date) {
                          onExportDateChange('');
                          setIsCalendarExpanded(false);
                          return;
                        }
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        onExportDateChange(`${year}-${month}-${day}`);
                        setIsCalendarExpanded(false);
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="flex h-full flex-col gap-1" ref={monthDropdownRef}>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-clinical-secondary">Mês</span>
                <div className="relative flex flex-1 items-start">
                  <button
                    type="button"
                    onClick={() => setIsMonthDropdownOpen((prev) => !prev)}
                    className={`w-full min-h-[40px] flex items-center justify-between gap-2 pl-3 pr-3 py-1.5 bg-clinical-bg border rounded-xl text-left text-xs font-bold text-clinical-text transition-all hover:border-clinical-primary focus:outline-none focus:ring-2 focus:ring-clinical-primary ${
                      isMonthDropdownOpen ? 'border-clinical-primary ring-2 ring-clinical-primary' : 'border-clinical-border'
                    }`}
                  >
                    <span className="truncate">{capitalizeFirst(monthSummary)}</span>
                    <ChevronDown
                      size={14}
                      className={`text-clinical-secondary transition-transform shrink-0 ${isMonthDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isMonthDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-clinical-card border border-clinical-border rounded-xl shadow-lg z-[180] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                      <button
                        type="button"
                        onClick={() => {
                          onExportMonthChange('');
                          setIsMonthDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${
                          !exportFilterMonth
                            ? 'bg-clinical-primary/10 text-clinical-primary'
                            : 'text-clinical-text hover:bg-clinical-bg'
                        }`}
                      >
                        Todos os meses
                      </button>
                      {availableMonths.map((month) => {
                        const isSelected = month.value === exportFilterMonth;
                        return (
                          <button
                            key={month.value}
                            type="button"
                            onClick={() => {
                              onExportMonthChange(month.value);
                              setIsMonthDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${
                              isSelected
                                ? 'bg-clinical-primary/10 text-clinical-primary'
                                : 'text-clinical-text hover:bg-clinical-bg'
                            }`}
                          >
                            {capitalizeFirst(month.label)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-clinical-secondary">Tipo de treino</span>
              <div className="flex flex-wrap gap-1.5">
                {availableSports.map((sport) => {
                  const isActive = exportSportFilters.includes(sport);
                  return (
                    <button
                      key={sport}
                      type="button"
                      onClick={() => onToggleExportSport(sport)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                        isActive
                          ? 'bg-clinical-primary text-white border-clinical-primary'
                          : 'border-clinical-border text-clinical-text hover:bg-clinical-bg'
                      }`}
                    >
                      {sport}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-clinical-border bg-clinical-card p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-clinical-secondary">
                  Seleção
                </p>
                <p className="text-xs text-clinical-secondary mt-1">
                  {selectedFilteredCount > 0
                    ? `${selectedFilteredCount} treino(s) marcados entram no PDF`
                    : `Nenhum treino marcado. O PDF usará os ${filteredWorkouts.length} treino(s) do filtro`}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {(() => {
                  const allSelected = filteredWorkouts.length > 0 && selectedFilteredCount === filteredWorkouts.length;
                  return (
                <button
                  type="button"
                  onClick={onSelectAll}
                  disabled={filteredWorkouts.length === 0}
                  aria-pressed={allSelected}
                  className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-bold transition-colors flex items-center gap-1.5 ${
                    allSelected
                      ? 'bg-clinical-primary text-white border-clinical-primary shadow-sm'
                      : 'border-clinical-border text-clinical-text hover:bg-clinical-bg'
                  } disabled:opacity-50`}
                >
                  {allSelected && <CheckSquare size={12} />}
                  {allSelected ? 'Selecionados' : 'Selecionar todos'}
                </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="px-2.5 py-1.5 rounded-xl border border-clinical-border text-[10px] font-bold text-clinical-secondary hover:bg-clinical-bg transition-colors"
                >
                  Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-clinical-border bg-clinical-bg p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-clinical-secondary">
                  Séries para todos
                </p>
                <p className="text-xs text-clinical-secondary mt-1">
                  Glicose, bolus e marcações de comentários entram sempre. Aqui você define os extras.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                {SERIES_OPTIONS.map((series) => (
                  <SeriesButton
                    key={series.key}
                    label={series.label}
                    color={series.color}
                    active={globalSeries[series.key]}
                    onClick={() => onToggleGlobal(series.key)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-clinical-secondary">
                  Ajustes por treino
                </p>
                <p className="text-xs text-clinical-secondary mt-1">
                  {effectiveWorkouts.length} treino(s) entrarão no PDF em páginas com 2 cards por folha.
                </p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full bg-clinical-bg text-clinical-secondary font-bold uppercase tracking-wider">
                {filteredWorkouts.length} no filtro
              </span>
            </div>

            <div className="space-y-3">
              {filteredWorkouts.map((workout) => {
                const override = overrides[workout.id];
                const isSelected = selectedWorkoutIds.includes(workout.id);
                const isImplicitlyIncluded = selectedFilteredCount === 0;
                const isIncluded = isSelected || isImplicitlyIncluded;
                return (
                  <div
                    key={workout.id}
                    className="rounded-2xl border border-clinical-border bg-clinical-card p-4"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => onToggleWorkoutSelection(workout.id)}
                          className="mt-0.5 text-clinical-primary"
                          aria-label={isSelected ? 'Desmarcar treino' : 'Marcar treino'}
                        >
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-clinical-primary">
                            {translateSport(workout.sport)}
                          </p>
                          <p className="text-sm font-bold text-clinical-text">
                            {formatDayMonthSP(workout.date)}
                          </p>
                          <p className="text-[11px] text-clinical-secondary">
                            {formatMonthYearSP(workout.date)}
                          </p>
                          {isImplicitlyIncluded && (
                            <p className="text-[10px] text-clinical-secondary mt-1">
                              Incluído por padrão
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onClearOverride(workout.id)}
                        className="text-[11px] font-bold text-clinical-primary hover:underline"
                      >
                        {override ? 'Voltar ao padrão' : 'Usando padrão'}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {SERIES_OPTIONS.map((series) => (
                        <SeriesButton
                          key={`${workout.id}_${series.key}`}
                          label={series.label}
                          color={series.color}
                          active={override ? override[series.key] : globalSeries[series.key]}
                          onClick={() => onToggleOverride(workout.id, series.key)}
                        />
                      ))}
                    </div>
                    {!isIncluded && (
                      <p className="text-[10px] text-clinical-secondary mt-2">
                        Este treino fica fora do PDF enquanto não estiver marcado.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-clinical-border flex items-center justify-end gap-4 shrink-0">
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-clinical-border text-sm font-bold text-clinical-secondary hover:bg-clinical-bg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={isExporting || effectiveWorkouts.length === 0}
              className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isExporting ? 'Gerando PDF...' : 'Exportar PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
