import React from 'react';
import { formatDateTimeSP } from '../utils/time';

const TOOLTIP_SERIES = [
  { key: 'glucose', label: 'Glicose', color: '#2563EB', unit: ' mg/dL' },
  { key: 'heartRate', label: 'Frequência Cardíaca', color: '#F43F5E', unit: ' bpm' },
  { key: 'paceSeconds', label: 'Ritmo', color: '#059669', unit: '/km' },
  { key: 'relativeLoad', label: 'Carga Relativa', color: '#D97706', unit: '%' },
];

function formatDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(2) : value;
}

function formatPaceSeconds(paceSecondsPerKm) {
  if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) return '—';
  const min = Math.floor(paceSecondsPerKm / 60);
  const sec = Math.round(paceSecondsPerKm % 60);
  return `${min}'${String(sec).padStart(2, '0')}''`;
}

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

function interpolateSeriesValue(series, targetTs, key, maxGapMs) {
  if (!series?.length || !Number.isFinite(targetTs)) return null;

  const rightIndex = lowerBoundByTimestamp(series, targetTs);
  const rightPoint = series[rightIndex];
  const leftPoint = series[rightIndex - 1];

  if (rightPoint?.timestamp === targetTs) return rightPoint[key] ?? null;
  if (leftPoint?.timestamp === targetTs) return leftPoint[key] ?? null;
  if (!leftPoint || !rightPoint) return null;

  const leftValue = leftPoint[key];
  const rightValue = rightPoint[key];
  const gapMs = rightPoint.timestamp - leftPoint.timestamp;

  if (
    leftValue === null || leftValue === undefined ||
    rightValue === null || rightValue === undefined ||
    gapMs <= 0 ||
    gapMs > maxGapMs
  ) {
    return null;
  }

  const ratio = (targetTs - leftPoint.timestamp) / gapMs;
  return leftValue + ((rightValue - leftValue) * ratio);
}

function nearestSeriesValue(series, targetTs, key, maxGapMs) {
  if (!series?.length || !Number.isFinite(targetTs)) return null;

  let low = 0;
  let high = series.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid].timestamp < targetTs) low = mid + 1;
    else high = mid;
  }

  const candidates = [series[low - 1], series[low]];
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const point of candidates) {
    if (!point) continue;
    const value = point[key];
    if (value === null || value === undefined) continue;
    const distance = Math.abs(point.timestamp - targetTs);
    if (distance <= maxGapMs && distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }

  return best;
}

function resolveSeriesValue(data, timestamp, seriesData, key) {
  const directValue = data?.[key];
  if (directValue !== null && directValue !== undefined) return directValue;

  if (key === 'glucose') {
    return interpolateSeriesValue(seriesData?.glucoseSeries, timestamp, 'glucose', 10 * 60 * 1000);
  }
  return nearestSeriesValue(seriesData?.trackSeries, timestamp, key, 5 * 60 * 1000)
    ?? interpolateSeriesValue(seriesData?.trackSeries, timestamp, key, 90 * 1000);
}

export default function CustomTooltip({ active, payload, label, activeSeries, dataLookup, seriesData }) {
  if (active && payload && payload.length) {
    const lookupData = dataLookup?.get(label);
    const data = lookupData || payload[0].payload;
    const timestamp = data?.timestamp ?? label;
    const tooltipTime = data?.timestamp ? formatDateTimeSP(data.timestamp) : (data?.fullTime || '');
    const visibleRows = TOOLTIP_SERIES.filter((series) => {
      if (series.key === 'glucose') return activeSeries?.glucose;
      if (series.key === 'heartRate') return activeSeries?.heartRate;
      if (series.key === 'paceSeconds') return activeSeries?.pace;
      if (series.key === 'relativeLoad') return activeSeries?.relativeLoad;
      return false;
    }).map((series) => {
      const rawValue = resolveSeriesValue(data, timestamp, seriesData, series.key);
      if (rawValue === null || rawValue === undefined) return null;

      if (series.key === 'paceSeconds') {
        return {
          ...series,
          displayValue: formatPaceSeconds(rawValue),
        };
      }

      return {
        ...series,
        displayValue: formatDecimal(rawValue),
      };
    }).filter(Boolean);
    
    return (
      <div className="bg-clinical-card border border-clinical-border p-3 rounded-lg shadow-lg text-[11px]">
        <p className="font-bold text-clinical-text mb-2 border-b border-clinical-border pb-1">
          {tooltipTime}
        </p>
        
        <div className="space-y-1.5">
          {visibleRows.map((entry) => {
            return (
              <div key={entry.key} className="flex items-center justify-between gap-4">
                <span className="font-medium" style={{ color: entry.color }}>
                  {entry.label}:
                </span>
                <span className="font-mono font-bold text-clinical-text">
                  {entry.displayValue}{entry.unit}
                </span>
              </div>
            );
          })}
          
          {data.bolus && (
            <div className="mt-1 pt-1 border-t border-purple-100 dark:border-purple-900/30 flex items-center justify-between gap-4 text-purple-700 dark:text-purple-400">
              <span className="font-bold">● Insulina:</span>
              <span className="font-mono font-bold">{formatDecimal(data.bolus)} U</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
