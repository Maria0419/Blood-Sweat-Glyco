import React, { useEffect, useMemo, useRef, useState } from 'react';
import WorkoutChart from './WorkoutChart';
import { calculateGlucoseImpact } from '../utils/metrics';
import {
  formatDateTimeSP,
  formatDayMonthSP,
  formatMonthYearSP,
  formatTimeSP,
} from '../utils/time';
import { translateSport } from '../utils/sports';

function chunk(list, size) {
  const pages = [];
  for (let index = 0; index < list.length; index += size) {
    pages.push(list.slice(index, index + size));
  }
  return pages;
}

function formatMetricValue(value, suffix = '') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '—';
  return `${value}${suffix}`;
}

function buildInsulinSummary(workout) {
  const startTs = workout.workoutStart;
  const endTs = workout.workoutEnd;
  const preWorkoutThreshold = startTs - 2 * 60 * 60 * 1000;
  const postWorkoutThreshold = endTs + 1 * 60 * 60 * 1000;
  const relevantBolus = (workout.carelink?.bolusEvents || []).filter((bolus) => {
    const timestamp = typeof bolus.timestamp === 'object' ? bolus.timestamp.getTime() : bolus.timestamp;
    return timestamp >= preWorkoutThreshold && timestamp <= postWorkoutThreshold;
  });
  const basalRate = (workout.carelink?.basalChanges || [])
    .filter((change) => {
      const timestamp = typeof change.timestamp === 'object' ? change.timestamp.getTime() : change.timestamp;
      return timestamp <= startTs;
    })
    .slice(-1)[0]?.rate;

  return {
    displayInsulin: workout.customInsulin ? `${workout.customInsulin} U/h` : formatMetricValue(basalRate, ' U/h'),
    bolus: relevantBolus,
  };
}

function StatBlock({ title, children }) {
  return (
    <section className="pt-2">
      <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-black mb-2 border-b border-black/20 pb-1">
        {title}
      </h3>
      {children}
    </section>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-black/5 last:border-b-0">
      <span className="text-[11px] text-black/70">{label}</span>
      <span className="text-[11px] font-mono font-bold text-clinical-text text-right">{value}</span>
    </div>
  );
}

function PrintWorkoutCard({ workout, tags }) {
  const insulin = buildInsulinSummary(workout);
  const glucoseImpact = useMemo(() => (
    calculateGlucoseImpact(
      workout.carelink?.sgvReadings || [],
      workout.workoutStart,
      workout.workoutEnd
    )
  ), [workout.carelink?.sgvReadings, workout.workoutEnd, workout.workoutStart]);

  return (
    <article className="pdf-card bg-white p-0 flex flex-col gap-3 break-inside-avoid">
      <header className="flex items-start justify-between gap-4 border-b border-black/20 pb-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-black">
            {translateSport(workout.sport)}
          </p>
          <h2 className="text-lg font-bold text-clinical-text leading-tight">
            {formatDayMonthSP(workout.date)}
          </h2>
          <p className="text-[11px] text-black/70">
            {formatMonthYearSP(workout.date)} • {formatTimeSP(workout.date)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-right shrink-0">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-black/70">Tempo</p>
            <p className="text-sm font-mono font-bold text-clinical-text">{workout.metrics?.duration || '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-black/70">Dist.</p>
            <p className="text-sm font-mono font-bold text-clinical-text">
              {formatMetricValue(workout.metrics?.distanceKm, ' km')}
            </p>
          </div>
        </div>
      </header>

      <div className="bg-white h-[270px]">
        <WorkoutChart
          printMode
          data={{
            trackpoints: workout.trackpoints,
            carelink: workout.carelink,
            metrics: workout.metrics,
            glucoseImpact,
            workoutStart: workout.workoutStart,
            workoutEnd: workout.workoutEnd,
          }}
          activeSeries={workout.chartSeries}
          isDarkMode={false}
          targetLimits={workout.targetLimits}
          targetGoal={workout.targetGoal}
          comments={workout.comments}
          commentMode={false}
          tags={tags}
          onAddTag={async () => null}
          onCommentModeToggle={() => {}}
          onAddComment={() => {}}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 items-start">
        <StatBlock title="Glicemia">
          <MetricRow label="1h antes" value={formatMetricValue(glucoseImpact?.preWorkout, ' mg/dL')} />
          <MetricRow label="Início" value={formatMetricValue(glucoseImpact?.start, ' mg/dL')} />
          <MetricRow label="Mínima" value={formatMetricValue(glucoseImpact?.min, ' mg/dL')} />
          <MetricRow label="Fim" value={formatMetricValue(glucoseImpact?.end, ' mg/dL')} />
          <MetricRow label="1h depois" value={formatMetricValue(glucoseImpact?.postWorkout, ' mg/dL')} />
        </StatBlock>

        <StatBlock title="Treino">
          <MetricRow label="Pace médio" value={workout.metrics?.avgPace || '—'} />
          <MetricRow label="FC média" value={formatMetricValue(workout.metrics?.avgHR, ' bpm')} />
          <MetricRow label="FC máxima" value={formatMetricValue(workout.metrics?.maxHR, ' bpm')} />
        </StatBlock>

        <StatBlock title="Insulina">
          <MetricRow label="Insulina ativa" value={insulin.displayInsulin} />
          <div className="pt-1 space-y-1">
            {insulin.bolus.length === 0 ? (
              <p className="text-[11px] text-black/60 italic">Nenhum bolus no período</p>
            ) : (
              insulin.bolus.map((bolus, index) => {
                const bolusTs = typeof bolus.timestamp === 'object' ? bolus.timestamp.getTime() : bolus.timestamp;
                const phase = bolusTs > workout.workoutEnd
                  ? 'Pós'
                  : bolusTs >= workout.workoutStart
                    ? 'Durante'
                    : 'Pré';
                return (
                  <div key={`${bolus.timestamp}_${index}`} className="py-1 border-b border-black/5 last:border-b-0">
                    <div className="flex items-center justify-between gap-3 flex-nowrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1 whitespace-nowrap">
                        <span className="text-[10px] font-mono font-bold text-clinical-text shrink-0">
                          {formatMetricValue(bolus.volume, ' U')}
                        </span>
                        <span className="text-[9px] text-black/70 truncate flex-1">
                          {formatTimeSP(bolus.timestamp)} • {bolus.type || 'Bolus'}
                        </span>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-black/70 shrink-0">
                        {phase}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </StatBlock>
      </div>

      <StatBlock title="Comentários">
        {workout.comments?.length ? (
          <div className="space-y-2">
            {workout.comments.map((comment) => {
              const tag = tags.find((item) => item.label === comment.title);
              const color = tag?.color || '#F59E0B';
              return (
                <div key={comment.id} className="py-1.5 border-b border-black/5 last:border-b-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span
                      className="text-[10px] font-bold"
                      style={{ color }}
                    >
                      {comment.title || 'Comentário'}
                    </span>
                    <span className="text-[10px] text-black/70 font-mono shrink-0">
                      {formatTimeSP(comment.timestamp)}
                    </span>
                  </div>
                  <p className="text-[11px] text-clinical-text whitespace-pre-wrap leading-relaxed">
                    {comment.text || '—'}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-black/60 italic">Nenhum comentário</p>
        )}
      </StatBlock>
    </article>
  );
}

export default function PrintExportView() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const didNotifyRef = useRef(false);
  const jobId = useMemo(() => new URLSearchParams(window.location.search).get('jobId'), []);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.body.style.background = '#ffffff';
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadJob() {
      if (!jobId) {
        setError('Job de impressão ausente.');
        return;
      }

      try {
        const nextPayload = await window.electronAPI.getPrintJob(jobId);
        if (!cancelled) {
          if (!nextPayload) {
            setError('Payload de impressão não encontrado.');
            return;
          }
          setPayload(nextPayload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError('Falha ao carregar o payload do PDF.');
          console.error(loadError);
        }
      }
    }

    loadJob();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!payload || !jobId || didNotifyRef.current) return;
    didNotifyRef.current = true;

    const notify = async () => {
      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise((resolve) => setTimeout(resolve, 250));
        await window.electronAPI.notifyPrintReady(jobId);
      } catch (notifyError) {
        console.error('Falha ao sinalizar PDF pronto:', notifyError);
      }
    };

    notify();
  }, [payload, jobId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clinical-bg text-clinical-text">
        {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clinical-bg text-clinical-secondary">
        Preparando PDF...
      </div>
    );
  }

  const pages = chunk(payload.workouts || [], 2);

  return (
    <div className="min-h-screen bg-white p-0">
      <style>
        {`
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          @media print {
            html, body {
              background: #ffffff !important;
            }

            body {
              background: #ffffff !important;
            }

            .pdf-page {
              margin: 0;
              box-shadow: none;
              border-radius: 0;
              page-break-after: always;
            }

            .pdf-page:last-child {
              page-break-after: auto;
            }
          }
        `}
      </style>

      <div className="max-w-[210mm] mx-auto space-y-0">
        {pages.map((page, pageIndex) => (
          <section
            key={`page_${pageIndex}`}
            className="pdf-page w-[194mm] min-h-[281mm] mx-auto bg-white p-[5mm] flex flex-col gap-[5mm]"
          >
            <div className="flex items-center justify-between border-b border-black/20 pb-1">
              <p className="text-[10px] text-black/70">
                Exportado em {formatDateTimeSP(Date.now())}
              </p>
              <p className="text-[10px] font-mono font-bold text-black/70">
                {pageIndex + 1}/{pages.length}
              </p>
            </div>

            <div className="flex flex-col gap-[5mm] flex-1">
              {page.map((workout) => (
                <PrintWorkoutCard key={workout.id} workout={workout} tags={payload.tags || []} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
