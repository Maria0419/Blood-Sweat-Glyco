import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Activity, Clock, Droplets, ChevronDown } from 'lucide-react';
import { getDateKeyFromDate, getSaoPauloDateKey } from '../utils/time';

const Calendar = React.memo(({ workouts, onSelectDate, selectedDate, visibleMonthKey = '' }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const monthRef = useRef(null);
  const yearRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (monthRef.current && !monthRef.current.contains(e.target)) setShowMonthDropdown(false);
      if (yearRef.current && !yearRef.current.contains(e.target)) setShowYearDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!visibleMonthKey) return;
    const [year, month] = visibleMonthKey.split('-').map(Number);
    if (!year || !month) return;
    setCurrentMonth(new Date(year, month - 1, 1));
  }, [visibleMonthKey]);

  useEffect(() => {
    if (!selectedDate) return;
    setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate]);

  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const date = new Date(year, month, 1);
    const days = [];
    
    // Fill previous month days to align first day of week
    const firstDay = date.getDay();
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    while (date.getMonth() === month) {
      days.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }
    return days;
  }, [currentMonth]);

  const workoutDates = useMemo(() => {
    return new Set(workouts.map(w => getSaoPauloDateKey(w.date)));
  }, [workouts]);

  const workoutYears = useMemo(() => {
    if (!workouts || workouts.length === 0) return [new Date().getFullYear()];
    const years = new Set();
    workouts.forEach(w => {
      const d = typeof w.date === 'string' ? new Date(w.date) : w.date;
      if (!isNaN(d.getTime())) years.add(d.getFullYear());
    });
    const arr = Array.from(years).sort((a, b) => a - b);
    return arr.length > 0 ? arr : [new Date().getFullYear()];
  }, [workouts]);

  const changeMonth = (offset) => {
    setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + offset)));
  };

  const months = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' }));

  return (
    <div className="p-4 bg-clinical-bg rounded-xl mb-4 border border-clinical-border">
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-clinical-card rounded border border-transparent hover:border-clinical-border transition-all text-clinical-secondary"><ChevronLeft size={14} /></button>
        <div className="flex items-center justify-center gap-1">
          <div className="relative" ref={monthRef}>
            <button 
              onClick={() => { setShowMonthDropdown(!showMonthDropdown); setShowYearDropdown(false); }}
              className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:bg-clinical-card rounded py-1 px-2 transition-colors flex items-center gap-1"
            >
              {months[currentMonth.getMonth()]}
              <ChevronDown size={10} className="opacity-50" />
            </button>
            {showMonthDropdown && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-32 max-h-48 overflow-y-auto bg-clinical-card border border-clinical-border rounded-lg shadow-xl z-50 p-1 scrollbar-stable">
                {months.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const newDate = new Date(currentMonth);
                      newDate.setMonth(i);
                      setCurrentMonth(newDate);
                      setShowMonthDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${currentMonth.getMonth() === i ? 'bg-blue-600 text-white' : 'text-clinical-text hover:bg-clinical-bg'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div className="relative" ref={yearRef}>
            <button 
              onClick={() => { setShowYearDropdown(!showYearDropdown); setShowMonthDropdown(false); }}
              className="text-[10px] font-black tracking-widest text-blue-600 hover:bg-clinical-card rounded py-1 px-2 transition-colors flex items-center gap-1"
            >
              {currentMonth.getFullYear()}
              <ChevronDown size={10} className="opacity-50" />
            </button>
            {showYearDropdown && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-20 max-h-48 overflow-y-auto bg-clinical-card border border-clinical-border rounded-lg shadow-xl z-50 p-1 scrollbar-stable">
                {workoutYears.map((year) => (
                  <button
                    key={year}
                    onClick={() => {
                      const newDate = new Date(currentMonth);
                      newDate.setFullYear(year);
                      setCurrentMonth(newDate);
                      setShowYearDropdown(false);
                    }}
                    className={`w-full text-center px-2 py-1.5 rounded-md text-xs font-bold transition-colors ${currentMonth.getFullYear() === year ? 'bg-blue-600 text-white' : 'text-clinical-text hover:bg-clinical-bg'}`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button onClick={() => changeMonth(1)} className="p-1 hover:bg-clinical-card rounded border border-transparent hover:border-clinical-border transition-all text-clinical-secondary"><ChevronRight size={14} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => (
          <span key={d} className="text-[9px] font-bold text-clinical-secondary/50 mb-1">{d}</span>
        ))}
        {daysInMonth.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const dateKey = getDateKeyFromDate(date);
          const hasWorkout = workoutDates.has(dateKey);
          const isSelected = selectedDate && dateKey === getDateKeyFromDate(selectedDate);
          return (
            <button
              key={i}
              onClick={() => onSelectDate(isSelected ? null : date)}
              className={`text-[10px] p-1.5 rounded-lg transition-all relative ${
                isSelected 
                  ? 'bg-blue-600 text-white font-bold' 
                  : hasWorkout 
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold hover:bg-blue-200 dark:hover:bg-blue-900/50' 
                    : 'text-clinical-secondary hover:bg-clinical-card'
              }`}
            >
              {date.getDate()}
              {hasWorkout && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default Calendar;
