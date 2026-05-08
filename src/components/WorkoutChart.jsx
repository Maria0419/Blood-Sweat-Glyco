import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Label
} from 'recharts';
import CustomTooltip from './CustomTooltip';
import { ZoomIn, ZoomOut, Maximize2, MessageSquarePlus, X } from 'lucide-react';
import { APP_TIMEZONE } from '../utils/time';

function lowerBoundByTimestamp(data, targetTs) {
  let low = 0;
  let high = data.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (data[mid].timestamp < targetTs) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBoundByTimestamp(data, targetTs) {
  let low = 0;
  let high = data.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (data[mid].timestamp <= targetTs) low = mid + 1;
    else high = mid;
  }
  return low;
}

function sliceSeriesByDomain(series, startTs, endTs, paddingMs = 0) {
  if (!series.length) return [];
  const startIndex = lowerBoundByTimestamp(series, startTs - paddingMs);
  const endExclusive = upperBoundByTimestamp(series, endTs + paddingMs);
  return series.slice(
    Math.max(0, startIndex - 1),
    Math.min(series.length, endExclusive + 1)
  );
}

function buildBucketTimeline(startTs, endTs, targetPoints) {
  const spanMs = endTs - startTs;
  if (!Number.isFinite(spanMs) || spanMs <= 0) return [];

  const rawStepMs = spanMs / Math.max(1, targetPoints - 1);
  const roundedStepMs = Math.max(30 * 1000, Math.round(rawStepMs / (30 * 1000)) * 30 * 1000);
  const firstBucketTs = Math.floor(startTs / roundedStepMs) * roundedStepMs;
  const buckets = [];

  for (let bucketTs = firstBucketTs; bucketTs <= endTs + roundedStepMs; bucketTs += roundedStepMs) {
    if (bucketTs >= startTs - roundedStepMs) {
      buckets.push(bucketTs);
    }
  }

  return buckets;
}

function buildExactValueMap(series, key) {
  const map = new Map();
  for (const point of series) {
    const value = point[key];
    if (value !== null && value !== undefined) {
      map.set(point.timestamp, value);
    }
  }
  return map;
}

function formatFixed2(value) {
  return Number.isFinite(value) ? value.toFixed(2) : value;
}

function sampleInterpolatedSeries(series, buckets, key, maxGapMs) {
  if (!series.length || !buckets.length) return [];

  const exactValues = buildExactValueMap(series, key);
  const firstPoint = series.find(point => point[key] !== null && point[key] !== undefined) ?? null;
  const lastPoint = [...series].reverse().find(point => point[key] !== null && point[key] !== undefined) ?? null;

  return buckets.map(bucketTs => {
    if (exactValues.has(bucketTs)) {
      return exactValues.get(bucketTs);
    }

    const rightIndex = lowerBoundByTimestamp(series, bucketTs);
    const rightPoint = series[rightIndex];
    const leftPoint = series[rightIndex - 1];

    if (
      leftPoint &&
      rightPoint &&
      leftPoint[key] !== null && leftPoint[key] !== undefined &&
      rightPoint[key] !== null && rightPoint[key] !== undefined
    ) {
      const gapMs = rightPoint.timestamp - leftPoint.timestamp;
      if (gapMs > 0 && gapMs <= maxGapMs) {
        const ratio = (bucketTs - leftPoint.timestamp) / gapMs;
        return leftPoint[key] + ((rightPoint[key] - leftPoint[key]) * ratio);
      }
    }

    if (firstPoint && bucketTs < firstPoint.timestamp && (firstPoint.timestamp - bucketTs) <= maxGapMs) {
      return firstPoint[key];
    }
    if (lastPoint && bucketTs > lastPoint.timestamp && (bucketTs - lastPoint.timestamp) <= maxGapMs) {
      return lastPoint[key];
    }

    return null;
  });
}

function CommentInputPopup({ pendingComment, submitComment, cancelComment, tags = [], onAddTag }) {
  const [inputValue, setInputValue] = useState('');
  const [text, setText] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(null);
  const inputRef = useRef(null);

  const colors = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#A855F7', '#EC4899', '#A16207', '#64748B'];

  useEffect(() => {
    setInputValue('');
    setText('');
    setSelectedColor(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [pendingComment]);

  const filteredTags = tags.filter(t => t?.label && t.label.toLowerCase().includes((inputValue || '').toLowerCase()));

  const handleSelectTag = (tag) => {
    setInputValue(tag.label);
    setSelectedColor(tag.color);
    setIsDropdownOpen(false);
  };

  const handleSave = async () => {
    const finalTitle = inputValue.trim();
    if (!finalTitle) return; // Tag is mandatory
    if (onAddTag) {
      await onAddTag(finalTitle, selectedColor || '#F59E0B');
    }
    submitComment(finalTitle, text);
  };

  const exactMatch = tags.find(t => t?.label && t.label.toLowerCase() === (inputValue || '').toLowerCase());
  const isTagConfirmed = exactMatch && !isDropdownOpen;

  return (
    <div
      className="absolute top-1/3 left-1/2 -translate-x-1/2 z-50 bg-clinical-card border border-amber-500/40 rounded-xl shadow-2xl p-4 w-72 animate-in zoom-in-95 fade-in duration-200"
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mb-2">Novo Comentário</p>
      
      {!isTagConfirmed ? (
        <div className="relative mb-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            placeholder="Tag..."
            className="w-full px-3 py-2 bg-clinical-bg border border-clinical-border rounded-lg text-sm font-bold text-clinical-text focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-clinical-secondary/50 placeholder:font-normal"
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelComment();
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
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-2 bg-clinical-card border border-clinical-border rounded-lg mb-2">
          <div className="flex items-center justify-between">
            <span 
              className="text-xs font-bold px-2 py-0.5 rounded text-white" 
              style={{ backgroundColor: exactMatch.color || '#F59E0B' }}
            >
              {exactMatch.label}
            </span>
            <button 
              onClick={() => {
                setInputValue('');
                setSelectedColor(null);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="text-clinical-secondary hover:text-clinical-text"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {!exactMatch && inputValue.trim() && (
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {colors.map(color => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              className={`w-5 h-5 rounded-full transition-all ${selectedColor === color || (!selectedColor && color === '#F59E0B') ? 'ring-2 ring-white ring-offset-2 ring-offset-clinical-card scale-110' : 'hover:scale-110 border border-black/10 dark:border-white/10'}`}
              style={{ backgroundColor: color }}
              title="Criar/usar tag com esta cor"
            />
          ))}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escreva sua observação..."
        className="w-full px-3 py-2 bg-clinical-bg border border-clinical-border rounded-lg text-xs text-clinical-text focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none placeholder:text-clinical-secondary/50"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            handleSave();
          }
          if (e.key === 'Escape') cancelComment();
        }}
      />
      <div className="flex gap-2 mt-3">
        <button
          onClick={cancelComment}
          className="flex-1 py-1.5 text-xs font-bold text-clinical-secondary bg-clinical-bg border border-clinical-border rounded-lg hover:bg-clinical-card transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={!inputValue.trim()}
          className="flex-1 py-1.5 text-xs font-bold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

const WorkoutChart = React.memo(function WorkoutChart({ data, activeSeries, isDarkMode, targetLimits, targetGoal, comments, commentMode, onCommentModeToggle, onAddComment, tags, onAddTag }) {
  const [pendingComment, setPendingComment] = useState(null);
  const [viewingComment, setViewingComment] = useState(null);
  const glucoseTicks = useMemo(() => {
    const min = targetLimits?.min ?? 70;
    const max = targetLimits?.max ?? 180;
    const goal = targetGoal ?? 100;
    return Array.from(new Set([40, min, goal, max, 300])).sort((a, b) => a - b);
  }, [targetLimits, targetGoal]);
  const { trackpoints, carelink, workoutStart, workoutEnd } = data;
  const containerRef = useRef(null);
  const isInteractingRef = useRef(false);
  const panRafRef = useRef(0);
  const wheelRafRef = useRef(0);
  const pendingDxRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const wheelPanDeltaRef = useRef(0);
  const zoomMsRef = useRef(0);
  const zoomInteractionTimeoutRef = useRef(0);

  const startTsValue = typeof workoutStart === 'object' ? workoutStart.getTime() : workoutStart;
  const endTsValue = typeof workoutEnd === 'object' ? workoutEnd.getTime() : workoutEnd;

  const workoutDurationMs = endTsValue - startTsValue;
  const workoutCenter = (startTsValue + endTsValue) / 2;

  const MIN_ZOOM_MS = 10 * 60 * 1000;
  const PAN_PADDING_MS = 60 * 60 * 1000;

  const navigationStart = startTsValue - PAN_PADDING_MS;
  const navigationEnd = endTsValue + PAN_PADDING_MS;
  const maxZoomMs = navigationEnd - navigationStart;

  const clampCenterX = useCallback((centerX, zoomMs) => {
    const halfZoom = zoomMs / 2;
    const minCenter = navigationStart + halfZoom;
    const maxCenter = navigationEnd - halfZoom;

    if (minCenter > maxCenter) return workoutCenter;
    return Math.max(minCenter, Math.min(maxCenter, centerX));
  }, [navigationEnd, navigationStart, workoutCenter]);

  const initialZoomMs = Math.max(MIN_ZOOM_MS, Math.min(maxZoomMs, workoutDurationMs + 60 * 60 * 1000));

  const [view, setView] = useState({
    zoomMs: initialZoomMs,
    centerX: clampCenterX(workoutCenter, initialZoomMs)
  });

  // Reset view when workout changes
  useEffect(() => {
    setView({
      zoomMs: initialZoomMs,
      centerX: clampCenterX(workoutCenter, initialZoomMs)
    });
  }, [clampCenterX, initialZoomMs, workoutCenter, workoutStart, workoutEnd]);

  const [chartWidth, setChartWidth] = useState(0);

  const [isInteracting, setIsInteracting] = useState(false);

  const setInteracting = useCallback((next) => {
    if (isInteractingRef.current === next) return;
    isInteractingRef.current = next;
    setIsInteracting(next);
  }, []);

  const dragInfo = useRef({ isDragging: false, lastX: 0 });

  useEffect(() => {
    dragInfo.current = { isDragging: false, lastX: 0 };
    pendingDxRef.current = 0;
    wheelDeltaRef.current = 0;
    wheelPanDeltaRef.current = 0;
    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = 0;
    }
    if (wheelRafRef.current) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = 0;
    }
    if (zoomInteractionTimeoutRef.current) {
      clearTimeout(zoomInteractionTimeoutRef.current);
      zoomInteractionTimeoutRef.current = 0;
    }
    setInteracting(false);
    if (containerRef.current) {
      containerRef.current.style.cursor = 'crosshair';
    }
  }, [setInteracting, workoutEnd, workoutStart]);

  const trackSeries = useMemo(() => (
    (trackpoints || []).map(tp => ({
      timestamp: typeof tp.timestamp === 'object' ? tp.timestamp.getTime() : tp.timestamp,
      heartRate: tp.heartRate ?? null,
      paceSeconds: tp.paceSecondsPerKm ? Math.min(tp.paceSecondsPerKm, 1080) : null,
      relativeLoad: tp.relativeLoad ?? null,
    }))
  ), [trackpoints]);

  const glucoseSeries = useMemo(() => (
    (carelink.sgvReadings || []).map(r => ({
      timestamp: typeof r.timestamp === 'object' ? r.timestamp.getTime() : r.timestamp,
      glucose: r.glucose ?? null,
    }))
  ), [carelink.sgvReadings]);

  const visibleData = useMemo(() => {
    const startTs = view.centerX - view.zoomMs / 2;
    const endTs = view.centerX + view.zoomMs / 2;
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return [];

    const widthBasedPoints = chartWidth > 0
      ? Math.round(chartWidth * 0.55)
      : 320;
    const targetPoints = Math.max(180, Math.min(640, widthBasedPoints));
    const buckets = buildBucketTimeline(startTs, endTs, targetPoints);
    const trackWindow = sliceSeriesByDomain(trackSeries, startTs, endTs, 90 * 1000);
    const glucoseWindow = sliceSeriesByDomain(glucoseSeries, startTs, endTs, 10 * 60 * 1000);
    const glucoseTimeline = glucoseWindow
      .map(point => point.timestamp)
      .filter(timestamp => timestamp >= startTs && timestamp <= endTs);

    const timeline = Array.from(new Set([startTs, ...buckets, ...glucoseTimeline, endTs])).sort((a, b) => a - b);
    const glucoseSamples = sampleInterpolatedSeries(glucoseWindow, timeline, 'glucose', 10 * 60 * 1000);
    const heartRateSamples = sampleInterpolatedSeries(trackWindow, timeline, 'heartRate', 90 * 1000);
    const paceSamples = sampleInterpolatedSeries(trackWindow, timeline, 'paceSeconds', 90 * 1000);
    const loadSamples = sampleInterpolatedSeries(trackWindow, timeline, 'relativeLoad', 90 * 1000);

    return timeline.map((timestamp, index) => ({
      timestamp,
      glucose: glucoseSamples[index],
      heartRate: heartRateSamples[index],
      paceSeconds: paceSamples[index],
      relativeLoad: loadSamples[index],
    }));
  }, [chartWidth, glucoseSeries, trackSeries, view.centerX, view.zoomMs]);

  const visibleBolus = useMemo(() => {
    const startTs = view.centerX - view.zoomMs / 2;
    const endTs = view.centerX + view.zoomMs / 2;
    return (carelink.bolusEvents || [])
      .filter(b => {
        const ts = typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp;
        return ts >= startTs && ts <= endTs;
      })
      .map(b => ({
        timestamp: typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp,
        bolus: b.volume,
      }));
  }, [carelink.bolusEvents, view.centerX, view.zoomMs]);

  const visibleDataLookup = useMemo(() => {
    const map = new Map();
    for (const point of visibleData) {
      map.set(point.timestamp, point);
    }
    return map;
  }, [visibleData]);

  const domain = useMemo(() => [view.centerX - view.zoomMs / 2, view.centerX + view.zoomMs / 2], [view.centerX, view.zoomMs]);
  
  const processedLabels = useMemo(() => {
    const items = [];
    if (comments && comments.length > 0) {
      items.push(...comments.map(c => ({ type: 'comment', data: c, timestamp: c.timestamp })));
    }
    if (activeSeries.bolus && carelink.bolusEvents) {
      items.push(...carelink.bolusEvents.map(b => {
        const ts = typeof b.timestamp === 'object' ? b.timestamp.getTime() : b.timestamp;
        return { type: 'bolus', data: b, timestamp: ts };
      }));
    }
    
    if (items.length === 0) return [];
    
    // Sort by timestamp, then bolus first if same time
    items.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.type === 'bolus' ? -1 : 1;
    });

    const width = chartWidth > 0 ? chartWidth : 800;
    const msPerPixel = view.zoomMs / width;
    
    const result = [];
    for (let i = 0; i < items.length; i++) {
      let level = 0;
      let overlapping = true;
      
      const currentItem = items[i];
      let currentLabelLen = 0;
      
      if (currentItem.type === 'comment') {
        const currentTitle = currentItem.data.title || currentItem.data.text || '';
        currentLabelLen = Math.min(20, currentTitle.length);
      } else {
        currentLabelLen = `${formatFixed2(currentItem.data.volume)}U`.length;
      }
      
      const currentWidthPx = currentLabelLen * 6 + 10;
      const currentWidthMs = currentWidthPx * msPerPixel;
      
      while (overlapping) {
        overlapping = false;
        for (let j = 0; j < i; j++) {
          const prev = result[j];
          if (prev.level === level) {
            let prevLabelLen = 0;
            if (prev.item.type === 'comment') {
              const prevTitle = prev.item.data.title || prev.item.data.text || '';
              prevLabelLen = Math.min(20, prevTitle.length);
            } else {
              prevLabelLen = `${formatFixed2(prev.item.data.volume)}U`.length;
            }
            
            const prevWidthPx = prevLabelLen * 6 + 10;
            const prevWidthMs = prevWidthPx * msPerPixel;
            
            const distance = currentItem.timestamp - prev.item.timestamp;
            
            // Check if distance is less than the width of the previous label plus some padding
            if (distance >= 0 && distance < (prevWidthMs + 8 * msPerPixel)) {
              overlapping = true;
              level++;
              break;
            }
          }
        }
      }
      result.push({ item: currentItem, level, dy: -2 + (level * 14) });
    }
    return result;
  }, [comments, activeSeries.bolus, carelink.bolusEvents, view.zoomMs, chartWidth]);

  const xTicks = useMemo(() => {
    const [start, end] = domain;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }

    const tickCount = 7;
    return Array.from({ length: tickCount }, (_, index) => (
      start + ((end - start) * index) / (tickCount - 1)
    ));
  }, [domain]);

  const { paceDomain, paceTicks, loadDomain } = useMemo(() => {
    let minPace = Infinity;
    let maxPace = -Infinity;
    let minLoad = Infinity;
    let maxLoad = -Infinity;

    for (const d of visibleData) {
      if (d.paceSeconds != null) {
        if (d.paceSeconds < minPace) minPace = d.paceSeconds;
        if (d.paceSeconds > maxPace) maxPace = d.paceSeconds;
      }
      if (d.relativeLoad != null) {
        if (d.relativeLoad < minLoad) minLoad = d.relativeLoad;
        if (d.relativeLoad > maxLoad) maxLoad = d.relativeLoad;
      }
    }

    let pDomain = [240, 1080];
    let pTicks = undefined;
    if (minPace !== Infinity && maxPace !== -Infinity) {
      const minBound = Math.max(0, Math.floor(minPace / 60) * 60);
      const maxBound = Math.min(1080, Math.ceil(maxPace / 60) * 60);
      pDomain = [minBound, maxBound];

      pTicks = [];
      for (let t = minBound; t <= maxBound; t += 60) {
        pTicks.push(t);
      }
    }

    let lDomain = [0, 100];
    if (minLoad !== Infinity && maxLoad !== -Infinity) {
      if (maxLoad === minLoad) {
        lDomain = [Math.max(0, minLoad - 5), maxLoad + 5];
      } else {
        const amplitude = maxLoad - minLoad;
        const minBound = Math.max(0, minLoad - amplitude * 0.1);
        const maxBound = maxLoad + amplitude * 0.1;
        lDomain = [minBound, maxBound];
      }
    }

    return { paceDomain: pDomain, paceTicks: pTicks, loadDomain: lDomain };
  }, [visibleData]);

  useEffect(() => {
    zoomMsRef.current = view.zoomMs;
  }, [view.zoomMs]);

  useEffect(() => {
    setView(prev => {
      const safeZoomMs = Number.isFinite(prev.zoomMs)
        ? Math.max(MIN_ZOOM_MS, Math.min(maxZoomMs, prev.zoomMs))
        : initialZoomMs;
      const safeCenterX = Number.isFinite(prev.centerX)
        ? clampCenterX(prev.centerX, safeZoomMs)
        : clampCenterX(workoutCenter, safeZoomMs);

      if (safeZoomMs === prev.zoomMs && safeCenterX === prev.centerX) {
        return prev;
      }

      return {
        ...prev,
        zoomMs: safeZoomMs,
        centerX: safeCenterX,
      };
    });
  }, [MIN_ZOOM_MS, clampCenterX, initialZoomMs, maxZoomMs, workoutCenter]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => setChartWidth(Math.round(el.clientWidth || 0));
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => updateWidth());
      resizeObserver.observe(el);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // 3. Optimized State Updates
  const handleZoom = useCallback((factor) => {
    setView(prev => {
      const nextZoomMs = Math.max(MIN_ZOOM_MS, Math.min(maxZoomMs, prev.zoomMs * factor));
      return {
        ...prev,
        zoomMs: nextZoomMs,
        centerX: clampCenterX(prev.centerX, nextZoomMs),
      };
    });
  }, [clampCenterX, maxZoomMs]);

  const resetView = useCallback(() => {
    const resetZoomMs = Math.max(MIN_ZOOM_MS, Math.min(maxZoomMs, workoutDurationMs + 60 * 60 * 1000));
    setView({ zoomMs: resetZoomMs, centerX: clampCenterX(workoutCenter, resetZoomMs) });
  }, [MIN_ZOOM_MS, clampCenterX, maxZoomMs, workoutDurationMs, workoutCenter]);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (commentMode) return;
    e.preventDefault();
    dragInfo.current = { isDragging: true, lastX: e.clientX };
    setInteracting(true);
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
  };

  const onChartClick = useCallback((e) => {
    if (!commentMode || !e?.activeLabel) return;
    const ts = e.activeLabel;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return;
    setPendingComment({ timestamp: ts });
  }, [commentMode]);

  const submitComment = useCallback((title, text) => {
    if (!pendingComment) return;
    onAddComment(pendingComment.timestamp, title.trim(), text.trim());
    setPendingComment(null);
    onCommentModeToggle();
  }, [pendingComment, onAddComment, onCommentModeToggle]);

  const cancelComment = useCallback(() => {
    setPendingComment(null);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragInfo.current.isDragging) return;
      const dx = e.clientX - dragInfo.current.lastX;
      dragInfo.current.lastX = e.clientX;
      if (dx === 0) return;

      pendingDxRef.current += dx;
      if (panRafRef.current) return;

      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = 0;
        if (!containerRef.current) return;
        const width = containerRef.current.clientWidth || 1;
        const totalDx = pendingDxRef.current;
        pendingDxRef.current = 0;
        const timeDelta = (totalDx / width) * zoomMsRef.current;
        setView(prev => ({
          ...prev,
          centerX: clampCenterX(prev.centerX - timeDelta, prev.zoomMs),
        }));
      });
    };

    const handleMouseUp = () => {
      dragInfo.current.isDragging = false;
      pendingDxRef.current = 0;
      setInteracting(false);
      if (containerRef.current) containerRef.current.style.cursor = 'crosshair';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
    };
  }, [clampCenterX, setInteracting]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const flushWheelInteraction = () => {
      wheelRafRef.current = 0;
      const panDelta = wheelPanDeltaRef.current;
      const zoomDelta = wheelDeltaRef.current;
      wheelPanDeltaRef.current = 0;
      wheelDeltaRef.current = 0;
      if (panDelta === 0 && zoomDelta === 0) return;

      setView(prev => {
        let nextZoomMs = prev.zoomMs;
        if (zoomDelta !== 0) {
          const zoomFactor = Math.exp(zoomDelta * 0.0012);
          nextZoomMs = Math.max(MIN_ZOOM_MS, Math.min(maxZoomMs, prev.zoomMs * zoomFactor));
        }

        let nextCenterX = prev.centerX;
        if (panDelta !== 0) {
          const width = el.clientWidth || 1;
          const timeDelta = (panDelta / width) * nextZoomMs;
          nextCenterX = prev.centerX + timeDelta;
        }

        return {
          ...prev,
          zoomMs: nextZoomMs,
          centerX: clampCenterX(nextCenterX, nextZoomMs),
        };
      });
    };

    const onWheel = (e) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isZoomGesture = absY > 0 && absY >= absX;
      const isPanGesture = absX > 0 && absX > absY;
      if (!isZoomGesture && !isPanGesture) return;

      e.preventDefault();
      setInteracting(true);

      if (isPanGesture) {
        wheelPanDeltaRef.current += e.deltaX;
      }
      if (isZoomGesture) {
        wheelDeltaRef.current += e.deltaY;
      }

      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(flushWheelInteraction);
      }

      if (zoomInteractionTimeoutRef.current) {
        clearTimeout(zoomInteractionTimeoutRef.current);
      }
      zoomInteractionTimeoutRef.current = window.setTimeout(() => setInteracting(false), 120);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      if (zoomInteractionTimeoutRef.current) clearTimeout(zoomInteractionTimeoutRef.current);
    };
  }, [MIN_ZOOM_MS, clampCenterX, maxZoomMs, setInteracting]);

  const xTickFormatter = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: APP_TIMEZONE,
    });
    return (ts) => formatter.format(ts);
  }, []);

  return (
    <div className="flex flex-col h-full min-w-0 select-none">
      <div className="flex justify-end items-center gap-2 mb-2 px-1">
        <span className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider mr-auto">
          {commentMode ? '🖊️ Clique na timeline para comentar' : 'Arraste para mover lateralmente • Scroll para zoom'}
        </span>
        <div className="flex gap-1 bg-clinical-bg p-1 rounded-lg border border-clinical-border">
          <button
            onClick={onCommentModeToggle}
            className={`p-1.5 rounded-md transition-all border ${commentMode
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-500'
                : 'border-transparent hover:bg-clinical-card hover:border-clinical-border text-clinical-secondary'
              }`}
            title={commentMode ? 'Desativar modo comentário' : 'Ativar modo comentário'}
          >
            <MessageSquarePlus size={14} />
          </button>
          <div className="w-px h-5 bg-clinical-border self-center" />
          <button onClick={() => handleZoom(0.75)} className="p-1.5 hover:bg-clinical-card rounded-md transition-all border border-transparent hover:border-clinical-border"><ZoomIn size={14} className="text-clinical-secondary" /></button>
          <button onClick={() => handleZoom(1.33)} className="p-1.5 hover:bg-clinical-card rounded-md transition-all border border-transparent hover:border-clinical-border"><ZoomOut size={14} className="text-clinical-secondary" /></button>
          <button onClick={resetView} className="p-1.5 hover:bg-clinical-card rounded-md transition-all border border-transparent hover:border-clinical-border"><Maximize2 size={14} className="text-clinical-secondary" /></button>
        </div>
      </div>

      <div
        className={`flex-1 min-h-0 min-w-0 relative overflow-hidden ${commentMode ? 'ring-2 ring-amber-500/30 rounded-lg' : ''}`}
        ref={containerRef}
        onMouseDown={onMouseDown}
        style={{ cursor: commentMode ? 'crosshair' : 'crosshair' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={visibleData}
            margin={{ top: 45, right: activeSeries.pace ? 0 : 35, left: activeSeries.glucose ? 45 : 90, bottom: 20 }}
            onClick={commentMode ? onChartClick : undefined}
          >
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={domain}
              scale="time"
              allowDataOverflow
              ticks={xTicks}
              minTickGap={28}
              tickFormatter={xTickFormatter}
              stroke={isDarkMode ? '#9CA3AF' : '#6B7280'}
              fontSize={10}
            />
            <YAxis
              yAxisId="glucose"
              domain={[40, 300]}
              width={activeSeries.glucose ? 45 : 0}
              stroke={isDarkMode ? '#60A5FA' : '#2563EB'}
              fontSize={10}
              axisLine={activeSeries.glucose}
              tickLine={false}
              tick={activeSeries.glucose}
              ticks={activeSeries.glucose ? glucoseTicks : []}
            >
              {activeSeries.glucose && <Label value="mg/dL" position="insideLeft" angle={-90} style={{ fill: isDarkMode ? '#60A5FA' : '#2563EB', fontSize: 10 }} />}
            </YAxis>
            <YAxis yAxisId="hr" orientation="right" domain={[60, 200]} width={0} mirror stroke="#F43F5E" fontSize={10} hide={!activeSeries.heartRate} />
            <YAxis yAxisId="pace" orientation="right" reversed domain={paceDomain} ticks={paceTicks} width={35} stroke={isDarkMode ? '#34D399' : '#059669'} fontSize={10} tickFormatter={(v) => `${Math.floor(v / 60)}'`} hide={!activeSeries.pace} />
            <YAxis yAxisId="load" domain={loadDomain} hide />

            {!isInteracting && (
              <Tooltip
                content={<CustomTooltip activeSeries={activeSeries} dataLookup={visibleDataLookup} seriesData={{ glucoseSeries, trackSeries }} />}
                isAnimationActive={false}
              />
            )}

            {!isInteracting && <ReferenceArea y1={targetLimits?.min ?? 70} y2={targetLimits?.max ?? 180} yAxisId="glucose" fill="#38BDF8" fillOpacity={isDarkMode ? 0.08 : 0.06} />}
            {!isInteracting && <ReferenceLine y={targetGoal ?? 100} yAxisId="glucose" stroke={isDarkMode ? '#60A5FA' : '#2563EB'} strokeDasharray="4 4" strokeWidth={1.5} />}
            {!isInteracting && <ReferenceArea x1={startTsValue} x2={endTsValue} fill="#2563EB" fillOpacity={isDarkMode ? 0.1 : 0.04} />}
            <CartesianGrid
              strokeDasharray="2 4"
              vertical={false}
              horizontal={true}
              horizontalPoints={[45]}
              stroke={isDarkMode ? '#4B5563' : '#D8DEE6'}
              strokeOpacity={0.9}
            />

            {/* Using type="linear" and disabling animations for extreme speed */}
            {activeSeries.relativeLoad && <Area yAxisId="load" type="linear" dataKey="relativeLoad" name="Carga Relativa" fill={isDarkMode ? "rgba(217, 119, 6, 0.15)" : "rgba(217, 119, 6, 0.1)"} stroke="#D97706" strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />}
            {activeSeries.heartRate && <Line yAxisId="hr" type="linear" dataKey="heartRate" name="Frequência Cardíaca" stroke="#F43F5E" strokeWidth={2} dot={false} activeDot={!isInteracting ? { r: 3 } : false} connectNulls isAnimationActive={false} />}
            {activeSeries.pace && <Line yAxisId="pace" type="linear" dataKey="paceSeconds" name="Ritmo" stroke={isDarkMode ? '#34D399' : '#059669'} strokeWidth={2} dot={false} activeDot={!isInteracting ? { r: 3 } : false} connectNulls isAnimationActive={false} />}
            {activeSeries.glucose && <Line yAxisId="glucose" type="monotoneX" dataKey="glucose" name="Glicose" stroke={isDarkMode ? '#60A5FA' : '#2563EB'} strokeWidth={2.5} dot={false} activeDot={!isInteracting ? { r: 3 } : false} connectNulls isAnimationActive={false} />}

            {processedLabels.map(({ item, dy }, index) => {
              if (item.type === 'bolus') {
                const b = item.data;
                return (
                  <ReferenceLine key={`bolus-${index}`} x={item.timestamp} stroke="#7C3AED" strokeWidth={2} strokeDasharray="3 3" yAxisId="glucose">
                    {!isInteracting && <Label value={`${formatFixed2(b.volume)}U`} position="top" fill={isDarkMode ? '#A78BFA' : '#7C3AED'} fontSize={11} fontWeight="bold" dy={dy} />}
                  </ReferenceLine>
                );
              } else {
                const c = item.data;
                const labelText = c.title || c.text;
                const tag = tags?.find(t => t.label === c.title);
                const tagColor = tag ? tag.color : '#F59E0B';
                return (
                  <ReferenceLine
                    key={`comment-${c.id || index}`}
                    x={item.timestamp}
                    stroke={tagColor}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    yAxisId="glucose"
                    className="cursor-pointer"
                    style={{ pointerEvents: 'all' }}
                    onDoubleClick={(e) => {
                      if (e && e.stopPropagation) e.stopPropagation();
                      setViewingComment(c);
                    }}
                  >
                    {!isInteracting && (
                      <Label
                        value={labelText?.length > 20 ? labelText.slice(0, 20) + '…' : labelText}
                        position="top"
                        fill={tagColor}
                        fontSize={9}
                        fontWeight="bold"
                        dy={dy}
                      />
                    )}
                  </ReferenceLine>
                );
              }
            })}

            {pendingComment && (
              <ReferenceLine x={pendingComment.timestamp} stroke="#F59E0B" strokeWidth={2} yAxisId="glucose" />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {pendingComment && (
          <CommentInputPopup
            pendingComment={pendingComment}
            submitComment={submitComment}
            cancelComment={cancelComment}
            tags={tags}
            onAddTag={onAddTag}
          />
        )}

            {viewingComment && (() => {
              const tag = tags?.find(t => t.label === viewingComment.title);
              const tagColor = tag ? tag.color : '#F59E0B';
              return (
                <div
                  className="absolute top-1/3 left-1/2 -translate-x-1/2 z-50 bg-clinical-card border border-amber-500/40 rounded-xl shadow-2xl p-4 w-72 animate-in zoom-in-95 fade-in duration-200"
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tagColor }}>Ver Comentário</p>
                    <button onClick={() => setViewingComment(null)} className="text-clinical-secondary hover:text-clinical-text">
                      <X size={14} />
                    </button>
                  </div>
                  {viewingComment.title && (
                    <div className="mb-3">
                      <span 
                        className="text-xs font-bold px-2 py-0.5 rounded text-white inline-block max-w-full truncate align-bottom" 
                        style={{ backgroundColor: tagColor }}
                        title={viewingComment.title}
                      >
                        {viewingComment.title}
                      </span>
                    </div>
                  )}
                  {viewingComment.text && (
                    <p className="text-xs text-clinical-text leading-relaxed whitespace-pre-wrap">{viewingComment.text}</p>
                  )}
                </div>
              );
            })()}
      </div>
    </div>
  );
});

export default WorkoutChart;
