const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const keytar = require('keytar');
const { GarminConnect } = require('garmin-connect');
const { XMLParser } = require('fast-xml-parser');

const SERVICE_NAME = 'BloodSweatGlyco';
const ACCOUNT_GARMIN = 'GarminConnect';

let gcClient = null;
let mainWindow = null;
const printJobs = new Map();

app.disableHardwareAcceleration();

// Configuração dos Diretórios de Dados (Otimizados)
const userDataPath = app.getPath('userData');
const DATA_DIR = path.join(userDataPath, 'data');
const WORKOUTS_DIR = path.join(DATA_DIR, 'workouts');
const CARELINK_DIR = path.join(DATA_DIR, 'carelink');
const COMMENTS_DIR = path.join(DATA_DIR, 'comments');

[DATA_DIR, WORKOUTS_DIR, CARELINK_DIR, COMMENTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// --- Funções Auxiliares de Processamento (ETL) ---

function formatPace(speed) {
  if (!speed || speed < 0.1) return "—";
  const paceSecondsPerKm = 1000 / speed;
  const min = Math.floor(paceSecondsPerKm / 60);
  const sec = Math.round(paceSecondsPerKm % 60);
  return `${min}'${String(sec).padStart(2, '0')}''`;
}

function processTCXtoOptimizedJSON(tcxString, activityId, sportFromGarmin = null) {
  const parser = new XMLParser({ 
    ignoreAttributes: false, 
    attributeNamePrefix: '@_',
    parseAttributeValue: true
  });
  const result = parser.parse(tcxString);
  
  if (!result.TrainingCenterDatabase || !result.TrainingCenterDatabase.Activities || !result.TrainingCenterDatabase.Activities.Activity) {
    throw new Error('Arquivo TCX Inválido');
  }

  const activity = result.TrainingCenterDatabase.Activities.Activity;
  const laps = Array.isArray(activity.Lap) ? activity.Lap : [activity.Lap];
  const lapTotalTimeSeconds = laps.reduce((sum, lap) => sum + (parseFloat(lap.TotalTimeSeconds) || 0), 0);
  const lapTotalDistance = laps.reduce((sum, lap) => sum + (parseFloat(lap.DistanceMeters) || 0), 0);
  
  let allTrackpoints = [];
  const MAX_HR = 200;
  
  laps.forEach(lap => {
    const track = lap.Track;
    if (!track) return;
    
    const points = Array.isArray(track.Trackpoint) ? track.Trackpoint : [track.Trackpoint];
    
    points.forEach(tp => {
      const extensions = tp.Extensions?.['ns3:TPX'];
      const heartRate = tp.HeartRateBpm?.Value ? parseInt(tp.HeartRateBpm.Value) : null;
      const speed = extensions?.['ns3:Speed'] ? parseFloat(extensions['ns3:Speed']) : 0;
      
      allTrackpoints.push({
        timestamp: new Date(tp.Time).getTime(),
        distanceMeters: parseFloat(tp.DistanceMeters) || 0,
        heartRate: heartRate,
        speed: speed,
        cadence: extensions?.['ns3:RunCadence'] ? parseInt(extensions['ns3:RunCadence']) * 2 : 0,
        watts: extensions?.['ns3:Watts'] ? parseInt(extensions['ns3:Watts']) : 0,
        paceSecondsPerKm: speed > 0.1 ? 1000 / speed : null,
        relativeLoad: heartRate ? (heartRate / MAX_HR) * 100 : null,
      });
    });
  });

  allTrackpoints.sort((a, b) => a.timestamp - b.timestamp);

  const intervalMs = 10 * 1000;
  const downsampled = [];
  let lastTimestamp = null;
  for (const tp of allTrackpoints) {
    if (!lastTimestamp || (tp.timestamp - lastTimestamp) >= intervalMs) {
      downsampled.push(tp);
      lastTimestamp = tp.timestamp;
    }
  }

  if (downsampled.length === 0) throw new Error("Treino sem trackpoints úteis.");

  const lastTrackpoint = allTrackpoints[allTrackpoints.length - 1];
  const lastDownsampled = downsampled[downsampled.length - 1];
  if (lastTrackpoint && lastDownsampled && lastTrackpoint.timestamp !== lastDownsampled.timestamp) {
    downsampled.push(lastTrackpoint);
  }

  // --- Filtro de Pico de Pace Inicial (GPS Lock) ---
  let firstValidPaceTs = null;
  let globalMinPace = Infinity;

  // Primeiro encontra o melhor pace do treino todo e o primeiro timestamp com pace
  for (const tp of downsampled) {
    if (tp.paceSecondsPerKm !== null) {
      if (firstValidPaceTs === null) firstValidPaceTs = tp.timestamp;
      if (tp.paceSecondsPerKm < globalMinPace) globalMinPace = tp.paceSecondsPerKm;
    }
  }

  if (firstValidPaceTs !== null && globalMinPace !== Infinity) {
    const initialWindowMs = 150000; // 2m30s
    for (const tp of downsampled) {
      // Se estiver nos primeiros 2m30s e o pace for > 2 min mais lento que o melhor do treino
      if (tp.timestamp - firstValidPaceTs > initialWindowMs) break;
      if (tp.paceSecondsPerKm !== null && (tp.paceSecondsPerKm - globalMinPace) > 120) {
        tp.paceSecondsPerKm = null;
      }
    }
  }
  // --- Fim do Filtro ---

  const workoutStart = allTrackpoints[0].timestamp;
  const workoutEnd = allTrackpoints[allTrackpoints.length - 1].timestamp;
  
  // Usa os totais oficiais das voltas do Garmin para evitar perder tempo/distância no downsample.
  const trackpointTimeSeconds = (workoutEnd - workoutStart) / 1000;
  const trackpointDistance = allTrackpoints[allTrackpoints.length - 1].distanceMeters;
  const totalTimeSeconds = lapTotalTimeSeconds > 0 ? lapTotalTimeSeconds : trackpointTimeSeconds;
  const totalDistance = lapTotalDistance > 0 ? lapTotalDistance : trackpointDistance;
  
  const heartRates = downsampled.map(tp => tp.heartRate).filter(hr => hr !== null);
  const avgHR = heartRates.length ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : 0;
  const maxHR = heartRates.length ? Math.max(...heartRates) : 0;
  
  const watts = downsampled.map(tp => tp.watts).filter(w => w > 0);
  const avgWatts = watts.length ? watts.reduce((a, b) => a + b, 0) / watts.length : 0;
  const maxWatts = watts.length ? Math.max(...watts) : 0;
  
  const relativeLoads = downsampled.map(tp => tp.relativeLoad).filter(rl => rl !== null);
  const avgRelativeLoad = relativeLoads.length ? relativeLoads.reduce((a, b) => a + b, 0) / relativeLoads.length : 0;
  
  const avgPaceSpeed = totalDistance / totalTimeSeconds;
  
  const durationMins = Math.floor(totalTimeSeconds / 60);
  const durationSecs = Math.round(totalTimeSeconds % 60);

  return {
    id: activityId,
    importVersion: 2,
    sport: sportFromGarmin || activity['@_Sport'] || 'Atividade',
    date: new Date(workoutStart).toISOString(),
    workoutStart,
    workoutEnd,
    metrics: {
      duration: `${durationMins}:${durationSecs.toString().padStart(2, '0')}`,
      distanceKm: (totalDistance / 1000).toFixed(2),
      avgPace: formatPace(avgPaceSpeed),
      avgHR: Math.round(avgHR),
      maxHR: Math.round(maxHR),
      avgRelativeLoad: Math.round(avgRelativeLoad),
      avgWatts: Math.round(avgWatts),
      maxWatts: Math.round(maxWatts),
    },
    trackpoints: downsampled
  };
}

function parseCareLinkCSV(csvString) {
  const text = csvString.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  
  const headerIndex = lines.findIndex(l => l.includes('Index;Date;Time'));
  if (headerIndex === -1) return { sgvReadings: [], bolusEvents: [], basalChanges: [] };

  const dataLines = lines.slice(headerIndex + 1);
  const sgvReadings = [];
  const bolusEvents = [];
  const basalChanges = [];
  
  for (const line of dataLines) {
    const cols = line.split(';').map(c => c.trim().replace(/"/g, ''));
    if (!cols[1] || !cols[2]) continue;
    
    const dateStr = cols[1];
    const timeStr = cols[2];
    if (!dateStr.includes('/') || !timeStr.includes(':')) continue;

    const iso = `${dateStr.replace(/\//g, '-')}T${timeStr}-03:00`;
    const timestamp = new Date(iso).getTime();
    if (isNaN(timestamp)) continue;

    // Sensor Glucose (col 35, index 34)
    if (cols[34] && cols[34] !== '') {
      sgvReadings.push({ 
        timestamp, 
        glucose: parseFloat(cols[34].replace(',', '.')) 
      });
    }
    
    // Bolus entregue (col 14, index 13)
    if (cols[13] && cols[13] !== '') {
      bolusEvents.push({
        timestamp,
        volume: parseFloat(cols[13].replace(',', '.')),
        type: cols[11],
        source: cols[45],
        bgAtBolus: cols[28] ? parseFloat(cols[28].replace(',', '.')) : null,
        iob: cols[31] ? parseFloat(cols[31].replace(',', '.')) : null,
      });
    }

    // Mudanças de taxa basal (col 8, index 7)
    if (cols[7] && cols[7] !== '') {
      basalChanges.push({
        timestamp,
        rate: parseFloat(cols[7].replace(',', '.')),
      });
    }
  }
  return { sgvReadings, bolusEvents, basalChanges };
}

function sliceAndSaveCareLinkData(carelinkData) {
  const workoutFiles = fs.readdirSync(WORKOUTS_DIR).filter(f => f.startsWith('garmin_') && f.endsWith('.json'));
  let savedCount = 0;

  workoutFiles.forEach(file => {
    try {
      const workout = JSON.parse(fs.readFileSync(path.join(WORKOUTS_DIR, file), 'utf-8'));
      const start = workout.workoutStart - (2 * 60 * 60 * 1000); // 2h antes
      const end = workout.workoutEnd + (2 * 60 * 60 * 1000);     // 2h depois
      
      const filteredSgs = (carelinkData.sgvReadings || []).filter(s => s.timestamp >= start && s.timestamp <= end);
      const filteredBolus = (carelinkData.bolusEvents || []).filter(b => b.timestamp >= start && b.timestamp <= end);
      const filteredBasal = (carelinkData.basalChanges || []).filter(b => b.timestamp >= start && b.timestamp <= end);

      if (filteredSgs.length > 0 || filteredBolus.length > 0 || filteredBasal.length > 0) {
        const carelinkJsonPath = path.join(CARELINK_DIR, `carelink_${workout.id}.json`);
        let existing = { sgvReadings: [], bolusEvents: [], basalChanges: [] };
        if (fs.existsSync(carelinkJsonPath)) {
          existing = JSON.parse(fs.readFileSync(carelinkJsonPath, 'utf-8'));
        }

        // Merge e deduplicação simples por timestamp
        const merge = (arr1, arr2) => {
          if (!arr1) arr1 = [];
          if (!arr2) arr2 = [];
          const map = new Map();
          [...arr1, ...arr2].forEach(item => map.set(item.timestamp, item));
          return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
        };

        const finalData = {
          sgvReadings: merge(existing.sgvReadings, filteredSgs),
          bolusEvents: merge(existing.bolusEvents, filteredBolus),
          basalChanges: merge(existing.basalChanges, filteredBasal)
        };

        fs.writeFileSync(carelinkJsonPath, JSON.stringify(finalData));
        savedCount++;
      }
    } catch (e) {
      console.error(`Erro ao processar recorte para ${file}:`, e);
    }
  });
  return savedCount;
}

function getFullCarelinkHistory() {
  const fullPath = path.join(CARELINK_DIR, 'full_history.json');
  if (fs.existsSync(fullPath)) {
    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch {
      return { sgvReadings: [], bolusEvents: [], basalChanges: [] };
    }
  }
  return { sgvReadings: [], bolusEvents: [], basalChanges: [] };
}

function mergeAndSaveFullCarelinkHistory(newData) {
  const existing = getFullCarelinkHistory();
  const merge = (arr1, arr2) => {
    if (!arr1) arr1 = [];
    if (!arr2) arr2 = [];
    const map = new Map();
    [...arr1, ...arr2].forEach(item => map.set(item.timestamp, item));
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  };
  const merged = {
    sgvReadings: merge(existing.sgvReadings, newData.sgvReadings),
    bolusEvents: merge(existing.bolusEvents, newData.bolusEvents),
    basalChanges: merge(existing.basalChanges, newData.basalChanges)
  };
  fs.writeFileSync(path.join(CARELINK_DIR, 'full_history.json'), JSON.stringify(merged));
  return merged;
}

const PRINT_TIMEZONE = 'America/Sao_Paulo';
const printTimeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: PRINT_TIMEZONE });
const printDayMonthFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', timeZone: PRINT_TIMEZONE });
const printMonthYearFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: PRINT_TIMEZONE });
const printDateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: PRINT_TIMEZONE,
});

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function formatTimeSPMain(value) {
  return printTimeFormatter.format(toDate(value));
}

function formatDayMonthSPMain(value) {
  return printDayMonthFormatter.format(toDate(value));
}

function formatMonthYearSPMain(value) {
  return printMonthYearFormatter.format(toDate(value));
}

function formatDateTimeSPMain(value) {
  return printDateTimeFormatter.format(toDate(value));
}

function formatMetricValueMain(value, suffix = '') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '—';
  return `${value}${suffix}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSportLabel(sport) {
  const labels = {
    running: 'Corrida',
    trail_running: 'Corrida em Trilha',
    track_running: 'Corrida de Pista',
    treadmill_running: 'Corrida em Esteira',
    walking: 'Caminhada',
    hiking: 'Trilha',
    cycling: 'Ciclismo',
    road_biking: 'Ciclismo de Estrada',
    road_cycling: 'Ciclismo de Estrada',
    mountain_biking: 'Mountain Bike',
    gravel_cycling: 'Gravel',
    swimming: 'Natação',
    strength_training: 'Musculação',
    cardio_training: 'Cardio',
    indoor_cycling: 'Ciclismo Indoor',
    indoor_running: 'Corrida Indoor',
    pool_swimming: 'Natação (Piscina)',
  };
  const key = String(sport || 'Outros').toLowerCase().replace(/[\s-]+/g, '_');
  return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function calculateGlucoseImpactMain(sgvReadings, workoutStart, workoutEnd) {
  if (!sgvReadings || !sgvReadings.length) return null;

  const hourMs = 60 * 60 * 1000;
  const startTs = typeof workoutStart === 'object' ? workoutStart.getTime() : workoutStart;
  const endTs = typeof workoutEnd === 'object' ? workoutEnd.getTime() : workoutEnd;
  const normalizedReadings = sgvReadings
    .map((reading) => ({
      ...reading,
      timestamp: typeof reading.timestamp === 'object' ? reading.timestamp.getTime() : reading.timestamp,
    }))
    .filter((reading) => Number.isFinite(reading.timestamp) && Number.isFinite(reading.glucose))
    .sort((a, b) => a.timestamp - b.timestamp);

  const findClosest = (time) => {
    const targetTs = typeof time === 'object' ? time.getTime() : time;
    let closest = normalizedReadings[0];
    let minDiff = Math.abs((closest?.timestamp ?? 0) - targetTs);

    for (const reading of normalizedReadings) {
      const diff = Math.abs(reading.timestamp - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = reading;
      }
    }

    return minDiff < 15 * 60 * 1000 ? closest?.glucose ?? null : null;
  };

  const workoutGlucoseValues = normalizedReadings
    .filter((reading) => reading.timestamp >= startTs && reading.timestamp <= endTs)
    .map((reading) => reading.glucose);

  return {
    preWorkout: findClosest(startTs - hourMs),
    start: findClosest(startTs),
    min: workoutGlucoseValues.length ? Math.round(Math.min(...workoutGlucoseValues)) : null,
    end: findClosest(endTs),
    postWorkout: findClosest(endTs + hourMs),
  };
}

function buildInsulinSummaryMain(workout) {
  const startTs = workout.workoutStart;
  const endTs = workout.workoutEnd;
  const preWorkoutThreshold = startTs - (2 * 60 * 60 * 1000);
  const postWorkoutThreshold = endTs + (1 * 60 * 60 * 1000);
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
    displayInsulin: workout.customInsulin ? `${workout.customInsulin} U/h` : formatMetricValueMain(basalRate, ' U/h'),
    bolus: relevantBolus,
  };
}

function buildSvgLinePath(points, getX, getY) {
  let path = '';
  let drawing = false;
  for (const point of points) {
    const x = getX(point);
    const y = getY(point);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  }
  return path.trim();
}

function downsampleByCount(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  if (maxPoints <= 2) return [points[0], points[points.length - 1]];

  const sampled = [];
  const step = (points.length - 1) / (maxPoints - 1);
  let lastIndex = -1;

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round(i * step);
    if (index === lastIndex) continue;
    sampled.push(points[index]);
    lastIndex = index;
  }

  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  return sampled;
}

function buildPrintChartSvg(workout, tags = []) {
  const clipId = `plot_clip_${String(workout.id || 'workout').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const width = 980;
  const height = 360;
  const margin = { top: 42, right: 40, bottom: 28, left: 22 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const navStart = workout.workoutStart - (60 * 60 * 1000);
  const navEnd = workout.workoutEnd + (60 * 60 * 1000);
  const timeSpan = Math.max(1, navEnd - navStart);
  const glucoseTicks = Array.from(new Set([40, workout.targetLimits?.min ?? 70, workout.targetGoal ?? 100, workout.targetLimits?.max ?? 180, 300])).sort((a, b) => a - b);

  const xScale = (timestamp) => margin.left + (((timestamp - navStart) / timeSpan) * plotWidth);
  const glucoseY = (value) => margin.top + (((300 - value) / 260) * plotHeight);
  const heartRateY = (value) => margin.top + (((200 - value) / 140) * plotHeight);
  const loadY = (value) => margin.top + (((100 - value) / 100) * plotHeight);

  const glucosePoints = downsampleByCount((workout.carelink?.sgvReadings || [])
    .map((reading) => ({ timestamp: typeof reading.timestamp === 'object' ? reading.timestamp.getTime() : reading.timestamp, value: reading.glucose }))
    .filter((reading) => reading.timestamp >= navStart && reading.timestamp <= navEnd && Number.isFinite(reading.value)), 160);

  const trackPoints = downsampleByCount((workout.trackpoints || [])
    .map((point) => ({
      timestamp: typeof point.timestamp === 'object' ? point.timestamp.getTime() : point.timestamp,
      pace: point.paceSecondsPerKm ?? null,
      heartRate: point.heartRate ?? null,
      relativeLoad: point.relativeLoad ?? null,
    }))
    .filter((point) => point.timestamp >= navStart && point.timestamp <= navEnd), 180);

  const paceValues = trackPoints.map((point) => point.pace).filter((value) => Number.isFinite(value));
  let paceMin = 240;
  let paceMax = 1080;
  if (paceValues.length) {
    paceMin = Math.max(0, Math.floor(Math.min(...paceValues) / 60) * 60);
    paceMax = Math.min(1080, Math.ceil(Math.max(...paceValues) / 60) * 60);
    if (paceMax <= paceMin) {
      paceMax = paceMin + 60;
    }
  }
  const paceY = (value) => margin.top + (((value - paceMin) / (paceMax - paceMin)) * plotHeight);

  const plotBottom = margin.top + plotHeight;
  const plotRight = margin.left + plotWidth;
  const xTicks = Array.from({ length: 7 }, (_, index) => navStart + ((timeSpan * index) / 6));
  const paceTickValues = workout.chartSeries?.pace
    ? Array.from(new Set([paceMin, Math.round((paceMin + paceMax) / 2 / 60) * 60, paceMax])).sort((a, b) => a - b)
    : [];

  const labelItems = [];
  for (const comment of (workout.comments || [])) {
    const timestamp = typeof comment.timestamp === 'object' ? comment.timestamp.getTime() : comment.timestamp;
    if (timestamp >= navStart && timestamp <= navEnd) {
      labelItems.push({ type: 'comment', timestamp, data: comment });
    }
  }
  if (workout.chartSeries?.bolus) {
    for (const bolus of (workout.carelink?.bolusEvents || [])) {
      const timestamp = typeof bolus.timestamp === 'object' ? bolus.timestamp.getTime() : bolus.timestamp;
      if (timestamp >= navStart && timestamp <= navEnd) {
        labelItems.push({ type: 'bolus', timestamp, data: bolus });
      }
    }
  }
  labelItems.sort((a, b) => (a.timestamp - b.timestamp) || (a.type === 'bolus' ? -1 : 1));
  const sampledLabelItems = downsampleByCount(labelItems, 16);
  const labelPlacements = [];
  const msPerPixel = timeSpan / plotWidth;

  for (const item of sampledLabelItems) {
    const rawLabel = item.type === 'bolus'
      ? `${Number(item.data.volume || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}U`
      : String(item.data.title || item.data.text || 'Comentário').slice(0, 18);
    const widthPx = (rawLabel.length * 6) + 12;
    const widthMs = widthPx * msPerPixel;
    let level = 0;
    let collides = true;

    while (collides) {
      collides = false;
      for (const previous of labelPlacements) {
        if (previous.level !== level) continue;
        if (Math.abs(item.timestamp - previous.timestamp) < Math.max(widthMs, previous.widthMs)) {
          collides = true;
          level += 1;
          break;
        }
      }
    }

    labelPlacements.push({ ...item, label: rawLabel, widthMs, level: Math.min(level, 3) });
  }

  const backgroundBandTop = glucoseY(workout.targetLimits?.max ?? 180);
  const backgroundBandHeight = glucoseY(workout.targetLimits?.min ?? 70) - backgroundBandTop;

  const clippedChartLayers = [
    `<rect x="${margin.left}" y="${backgroundBandTop.toFixed(1)}" width="${plotWidth}" height="${backgroundBandHeight.toFixed(1)}" fill="#38BDF8" opacity="0.08" />`,
    `<line x1="${margin.left}" y1="${glucoseY(workout.targetGoal ?? 100).toFixed(1)}" x2="${plotRight}" y2="${glucoseY(workout.targetGoal ?? 100).toFixed(1)}" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="4 4" />`,
  ];
  const eventLayers = [];

  const glucosePath = buildSvgLinePath(glucosePoints, (point) => xScale(point.timestamp), (point) => glucoseY(point.value));
  if (glucosePath) {
    clippedChartLayers.push(`<path d="${glucosePath}" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  if (workout.chartSeries?.relativeLoad) {
    const loadPath = buildSvgLinePath(
      trackPoints.filter((point) => Number.isFinite(point.relativeLoad)),
      (point) => xScale(point.timestamp),
      (point) => loadY(point.relativeLoad)
    );
    if (loadPath) {
      clippedChartLayers.push(`<path d="${loadPath}" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`);
    }
  }

  if (workout.chartSeries?.heartRate) {
    const heartRatePath = buildSvgLinePath(
      trackPoints.filter((point) => Number.isFinite(point.heartRate)),
      (point) => xScale(point.timestamp),
      (point) => heartRateY(point.heartRate)
    );
    if (heartRatePath) {
      clippedChartLayers.push(`<path d="${heartRatePath}" fill="none" stroke="#F43F5E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`);
    }
  }

  if (workout.chartSeries?.pace) {
    const pacePath = buildSvgLinePath(
      trackPoints.filter((point) => Number.isFinite(point.pace)),
      (point) => xScale(point.timestamp),
      (point) => paceY(point.pace)
    );
    if (pacePath) {
      clippedChartLayers.push(`<path d="${pacePath}" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`);
    }
  }

  for (const label of labelPlacements) {
    const x = xScale(label.timestamp);
    const labelY = Math.max(4, margin.top - 25 + (label.level * 10));
    if (label.type === 'bolus') {
      eventLayers.push(`<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${plotBottom}" stroke="#7C3AED" stroke-width="2" stroke-dasharray="3 3" />`);
      eventLayers.push(`<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" fill="#7C3AED" text-anchor="middle" dominant-baseline="hanging" font-size="10" font-weight="700">${escapeHtml(label.label)}</text>`);
    } else {
      const tag = tags.find((item) => item.label === label.data.title);
      const color = tag?.color || '#F59E0B';
      eventLayers.push(`<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${plotBottom}" stroke="${escapeHtml(color)}" stroke-width="2" stroke-dasharray="4 3" />`);
      eventLayers.push(`<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${escapeHtml(color)}" text-anchor="middle" dominant-baseline="hanging" font-size="9" font-weight="700">${escapeHtml(label.label)}</text>`);
    }
  }

  const leftAxis = glucoseTicks.map((tick) => {
    const y = glucoseY(tick);
    return `<text x="${margin.left - 6}" y="${(y + 3).toFixed(1)}" fill="#2563EB" font-size="9" text-anchor="end">${tick}</text>`;
  }).join('');

  const xAxis = xTicks.map((tick) => {
    const x = xScale(tick);
    return `
      <line x1="${x.toFixed(1)}" y1="${plotBottom}" x2="${x.toFixed(1)}" y2="${(plotBottom + 6).toFixed(1)}" stroke="#6B7280" stroke-width="1" />
      <text x="${x.toFixed(1)}" y="${(plotBottom + 18).toFixed(1)}" fill="#6B7280" font-size="10" text-anchor="middle">${escapeHtml(formatTimeSPMain(tick))}</text>
    `;
  }).join('');

  const rightAxis = workout.chartSeries?.pace
    ? paceTickValues.map((tick) => {
      const y = paceY(tick);
      return `<text x="${plotRight + 8}" y="${(y + 3).toFixed(1)}" fill="#059669" font-size="10">${Math.floor(tick / 60)}'</text>`;
    }).join('')
    : '';

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="${clipId}">
          <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${plotBottom}" stroke="#2563EB" stroke-width="1.5" />
      <line x1="${margin.left}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#6B7280" stroke-width="1" />
      ${workout.chartSeries?.pace ? `<line x1="${plotRight}" y1="${margin.top}" x2="${plotRight}" y2="${plotBottom}" stroke="#059669" stroke-width="1.5" />` : ''}
      <text x="${margin.left - 2}" y="${margin.top - 12}" fill="#2563EB" font-size="9" text-anchor="start">mg/dL</text>
      ${leftAxis}
      ${rightAxis}
      ${xAxis}
      <g clip-path="url(#${clipId})">
        ${clippedChartLayers.join('')}
      </g>
      ${eventLayers.join('')}
    </svg>
  `;
}

function buildPrintWorkoutCardHtml(workout, tags) {
  const glucoseImpact = calculateGlucoseImpactMain(workout.carelink?.sgvReadings || [], workout.workoutStart, workout.workoutEnd);
  const insulin = buildInsulinSummaryMain(workout);
  const chartSvg = buildPrintChartSvg(workout, tags);

  const bolusHtml = insulin.bolus.length === 0
    ? `<p class="empty">Nenhum bolus no período</p>`
    : insulin.bolus.map((bolus, index) => {
      const bolusTs = typeof bolus.timestamp === 'object' ? bolus.timestamp.getTime() : bolus.timestamp;
      const phase = bolusTs > workout.workoutEnd ? 'Pós' : bolusTs >= workout.workoutStart ? 'Durante' : 'Pré';
      return `
        <div class="bolus-row" data-index="${index}">
          <div class="bolus-main">
            <span class="bolus-volume">${escapeHtml(formatMetricValueMain(bolus.volume, ' U'))}</span>
            <span class="bolus-meta">${escapeHtml(formatTimeSPMain(bolus.timestamp))} • ${escapeHtml(bolus.type || 'Bolus')}</span>
          </div>
          <span class="bolus-phase">${escapeHtml(phase)}</span>
        </div>
      `;
    }).join('');

  const commentsHtml = (workout.comments || []).length === 0
    ? `<p class="empty">Nenhum comentário</p>`
    : workout.comments.map((comment) => {
      const tag = tags.find((item) => item.label === comment.title);
      const color = tag?.color || '#F59E0B';
      return `
        <div class="comment-row">
          <div class="comment-head">
            <span class="comment-tag" style="color:${escapeHtml(color)}">${escapeHtml(comment.title || 'Comentário')}</span>
            <span class="comment-time">${escapeHtml(formatTimeSPMain(comment.timestamp))}</span>
          </div>
          <p class="comment-text">${escapeHtml(comment.text || '—')}</p>
        </div>
      `;
    }).join('');

  const metricRow = (label, value) => `
    <div class="metric-row">
      <span>${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(value)}</span>
    </div>
  `;

  return `
    <article class="pdf-card">
      <header class="card-header">
        <div>
          <p class="sport">${escapeHtml(formatSportLabel(workout.sport))}</p>
          <div class="date-line">
            <h2>${escapeHtml(formatDayMonthSPMain(workout.date))}</h2>
            <span class="date-meta">${escapeHtml(formatTimeSPMain(workout.date))}</span>
          </div>
        </div>
        <div class="header-stats">
          <div>
            <p class="stat-label">Tempo</p>
            <p class="stat-value">${escapeHtml(workout.metrics?.duration || '—')}</p>
          </div>
          <div>
            <p class="stat-label">Dist.</p>
            <p class="stat-value">${escapeHtml(formatMetricValueMain(workout.metrics?.distanceKm, ' km'))}</p>
          </div>
        </div>
      </header>

      <div class="chart-wrap">${chartSvg}</div>

      <div class="stats-grid">
        <section class="stat-block">
          <h3>Glicemia</h3>
          ${metricRow('1h antes', formatMetricValueMain(glucoseImpact?.preWorkout, ' mg/dL'))}
          ${metricRow('Início', formatMetricValueMain(glucoseImpact?.start, ' mg/dL'))}
          ${metricRow('Mínima', formatMetricValueMain(glucoseImpact?.min, ' mg/dL'))}
          ${metricRow('Fim', formatMetricValueMain(glucoseImpact?.end, ' mg/dL'))}
          ${metricRow('1h depois', formatMetricValueMain(glucoseImpact?.postWorkout, ' mg/dL'))}
        </section>

        <section class="stat-block">
          <h3>Treino</h3>
          ${metricRow('Pace médio', workout.metrics?.avgPace || '—')}
          ${metricRow('FC média', formatMetricValueMain(workout.metrics?.avgHR, ' bpm'))}
          ${metricRow('FC máxima', formatMetricValueMain(workout.metrics?.maxHR, ' bpm'))}
        </section>

        <section class="stat-block">
          <h3>Insulina</h3>
          ${metricRow('Insulina ativa', insulin.displayInsulin)}
          <div class="bolus-list">${bolusHtml}</div>
        </section>
      </div>

      <section class="stat-block comments-block">
        <h3>Comentários</h3>
        ${commentsHtml}
      </section>
    </article>
  `;
}

function buildPrintDocumentHtml(payload) {
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : [];
  const pages = [];
  for (let index = 0; index < workouts.length; index += 2) {
    pages.push(workouts.slice(index, index + 2));
  }

  const pagesHtml = pages.map((page, pageIndex) => `
    <section class="pdf-page">
      <div class="page-content">
        ${page.map((workout) => buildPrintWorkoutCardHtml(workout, payload.tags || [])).join('')}
      </div>
    </section>
  `).join('');

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Exportação PDF</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif; }
          body { padding: 0; }
          .pdf-page { width: 194mm; min-height: 281mm; margin: 0 auto; padding: 5mm; display: flex; flex-direction: column; gap: 5mm; page-break-after: always; }
          .pdf-page:last-child { page-break-after: auto; }
          .page-content { display: flex; flex-direction: column; gap: 5mm; }
          .pdf-card { display: flex; flex-direction: column; gap: 10px; break-inside: avoid; }
          .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 7px; border-bottom: 1px solid rgba(0,0,0,0.36); }
          .sport { margin: 0 0 3px; font-size: 10px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
          .date-line { display: flex; align-items: baseline; gap: 8px; }
          .card-header h2 { margin: 0; font-size: 18px; line-height: 1.1; font-weight: 700; }
          .date-meta { font-size: 11px; color: rgba(0,0,0,0.7); }
          .header-stats { display: grid; grid-template-columns: repeat(2, auto); gap: 8px 16px; text-align: right; }
          .stat-label { margin: 0 0 2px; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; color: rgba(0,0,0,0.7); text-transform: uppercase; }
          .stat-value { margin: 0; font-size: 14px; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 600; }
          .chart-wrap { height: 315px; width: 100%; }
          .stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
          .stat-block { padding-top: 4px; }
          .stat-block h3 { margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(0,0,0,0.36); font-size: 10px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; }
          .metric-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.08); font-size: 11px; color: rgba(0,0,0,0.7); }
          .metric-row:last-child { border-bottom: 0; }
          .metric-value { color: #111827; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700; text-align: right; }
          .bolus-list { padding-top: 4px; }
          .bolus-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.08); flex-wrap: nowrap; font-family: inherit; }
          .bolus-row:last-child { border-bottom: 0; }
          .bolus-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; white-space: nowrap; font-family: inherit; }
          .bolus-volume { font-size: 10px; font-family: inherit; font-weight: 700; color: #111827; white-space: nowrap; }
          .bolus-meta { font-size: 9px; font-family: inherit; color: rgba(0,0,0,0.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
          .bolus-phase { font-size: 9px; font-family: inherit; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(0,0,0,0.7); white-space: nowrap; flex: 0 0 auto; }
          .comments-block { padding-top: 0; }
          .comment-row { padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.08); }
          .comment-row:last-child { border-bottom: 0; }
          .comment-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
          .comment-tag { font-size: 10px; font-weight: 700; }
          .comment-time { font-size: 10px; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: rgba(0,0,0,0.7); white-space: nowrap; }
          .comment-text { margin: 0; font-size: 11px; line-height: 1.45; white-space: pre-wrap; color: #111827; }
          .empty { margin: 0; font-size: 11px; color: rgba(0,0,0,0.6); font-style: italic; }
        </style>
      </head>
      <body>${pagesHtml}</body>
    </html>
  `;
}

// --- Fim Funções Auxiliares ---

function loadRendererTarget(win, query = {}) {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    return win.loadURL(url.toString());
  }

  return win.loadFile(path.join(__dirname, '../dist/index.html'), { query });
}

function isPrintRouteUrl(urlString) {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    return parsed.searchParams.get('print') === '1';
  } catch {
    return false;
  }
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const currentUrl = mainWindow.webContents.getURL();
  if (!currentUrl || isPrintRouteUrl(currentUrl)) {
    loadRendererTarget(mainWindow);
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#F8FAFC',
    show: false,
    icon: path.join(__dirname, '../bs&g.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('render-process-gone', () => {
    restoreMainWindow();
  });

  mainWindow.on('unresponsive', () => {
    restoreMainWindow();
  });

  loadRendererTarget(mainWindow);
}

function createPrintWindow(printFilePath) {
  const printWindow = new BrowserWindow({
    width: 1240,
    height: 1754,
    backgroundColor: '#FFFFFF',
    show: false,
    paintWhenInitiallyHidden: true,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false,
    },
  });

  printWindow.setMenu(null);
  return printWindow.loadFile(printFilePath).then(() => printWindow);
}

function waitForPrintWindowReady(printWindow) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      printWindow.webContents.removeListener('did-finish-load', handleFinishLoad);
      printWindow.webContents.removeListener('did-fail-load', handleFailLoad);
    };

    const handleFinishLoad = () => {
      cleanup();
      resolve();
    };

    const handleFailLoad = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      cleanup();
      reject(new Error(`Falha ao carregar a janela de impressão: ${errorDescription} (${errorCode})`));
    };

    printWindow.webContents.once('did-finish-load', handleFinishLoad);
    printWindow.webContents.once('did-fail-load', handleFailLoad);

    if (!printWindow.webContents.isLoadingMainFrame()) {
      cleanup();
      resolve();
    }
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('list-workouts', async () => {
  if (!fs.existsSync(WORKOUTS_DIR)) return [];
  const files = fs.readdirSync(WORKOUTS_DIR);
  const workouts = [];
  for (const f of files) {
    if (f.endsWith('.json') && f.startsWith('garmin_')) {
      try {
        const content = fs.readFileSync(path.join(WORKOUTS_DIR, f), 'utf-8');
        const data = JSON.parse(content);
        workouts.push({
          id: data.id,
          fileName: f,
          sport: data.sport || 'other',
          date: data.date
        });
      } catch (e) {
        console.error("Erro ao ler treino otimizado", f, e);
      }
    }
  }
  return workouts.sort((a, b) => new Date(b.date) - new Date(a.date));
});

ipcMain.handle('load-workout', async (event, workoutId) => {
  const workoutFile = path.join(WORKOUTS_DIR, `garmin_${workoutId}.json`);
  const carelinkFile = path.join(CARELINK_DIR, `carelink_${workoutId}.json`);
  try {
    if (!fs.existsSync(workoutFile)) throw new Error(`Treino ${workoutId} não encontrado.`);
    const workoutData = JSON.parse(fs.readFileSync(workoutFile, 'utf-8'));
    let carelinkData = { sgvReadings: [], bolusEvents: [], basalChanges: [] };
    if (fs.existsSync(carelinkFile)) {
      carelinkData = JSON.parse(fs.readFileSync(carelinkFile, 'utf-8'));
    }
    return { workoutData, carelinkData };
  } catch (error) {
    console.error('Erro ao ler arquivos otimizados:', error);
    throw new Error('Falha ao carregar os dados do treino selecionado.');
  }
});

ipcMain.handle('check-garmin-auth', async () => {
  try {
    const credentialsStr = await keytar.getPassword(SERVICE_NAME, ACCOUNT_GARMIN);
    if (!credentialsStr) return { status: 'disconnected' };
    const { email } = JSON.parse(credentialsStr);
    return { status: 'connected', profileName: email };
  } catch (error) {
    return { status: 'disconnected' };
  }
});

ipcMain.handle('connect-garmin', async (event, email, password) => {
  try {
    if (!email || !password) throw new Error('E-mail e senha são obrigatórios.');
    gcClient = new GarminConnect({ username: email, password: password });
    await gcClient.login();
    const profile = await gcClient.getUserProfile();
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_GARMIN, JSON.stringify({ email, password }));
    return { status: 'success', profileName: profile.displayName || profile.userName || email };
  } catch (error) {
    let msg = 'Falha na autenticação com Garmin.';
    if (error.message.includes('403')) msg = 'Acesso negado (403). Verifique suas credenciais.';
    return { status: 'error', message: msg };
  }
});

ipcMain.handle('logout-garmin', async () => {
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_GARMIN);
  gcClient = null;
  return { status: 'success' };
});

ipcMain.handle('sync-garmin', async () => {
  try {
    const credentialsStr = await keytar.getPassword(SERVICE_NAME, ACCOUNT_GARMIN);
    if (!credentialsStr) throw new Error("Usuário não autenticado no Garmin.");
    const { email, password } = JSON.parse(credentialsStr);
    
    if (!gcClient) {
      gcClient = new GarminConnect({ username: email, password: password });
      try {
        await gcClient.login();
      } catch (loginErr) {
        if (loginErr.message.includes('403')) {
          await keytar.deletePassword(SERVICE_NAME, ACCOUNT_GARMIN);
          throw new Error("Sessão expirada ou acesso negado (403). Por favor, reconecte sua conta Garmin.");
        }
        throw loginErr;
      }
    }

    let activities;
    try {
      activities = await gcClient.getActivities(0, 50); // Aumentado para 50 para garantir pegar mais treinos recentes
    } catch (actErr) {
      if (actErr.message.includes('403')) {
         await keytar.deletePassword(SERVICE_NAME, ACCOUNT_GARMIN);
         gcClient = null;
         throw new Error("Acesso negado pelo Garmin (403). Conta desconectada para sua segurança.");
      }
      throw actErr;
    }

    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const tempDir = path.join(app.getPath('temp'), 'bsg_temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    let downloadedCount = 0;
    for (const activity of activities) {
      // Filtro de 90 dias
      const activityDate = new Date(activity.startTimeLocal).getTime();
      if (activityDate < ninetyDaysAgo) continue;

      const activityId = activity.activityId.toString();
      const finalJsonPath = path.join(WORKOUTS_DIR, `garmin_${activityId}.json`);
      
      // Forçar re-processamento se o JSON existente ainda usa métricas calculadas pelos trackpoints reduzidos.
      let shouldProcess = !fs.existsSync(finalJsonPath);
      if (!shouldProcess) {
        const existing = JSON.parse(fs.readFileSync(finalJsonPath, 'utf-8'));
        if (!existing.metrics || existing.metrics.avgHR === undefined || existing.importVersion !== 2) {
          shouldProcess = true;
        }
      }

      if (!shouldProcess) continue;

      try {
        await gcClient.downloadOriginalActivityData(activity, tempDir, 'tcx');
        const tempTcxPath = path.join(tempDir, `${activityId}.tcx`);
        if (fs.existsSync(tempTcxPath)) {
          const tcxContent = fs.readFileSync(tempTcxPath, 'utf-8');
          const optimizedJson = processTCXtoOptimizedJSON(tcxContent, activityId, activity.activityType?.typeKey);
          fs.writeFileSync(finalJsonPath, JSON.stringify(optimizedJson));
          fs.unlinkSync(tempTcxPath);
          downloadedCount++;
        }
      } catch (err) { console.error('Erro ao processar atividade:', activityId, err); }
    }
    
    if (downloadedCount > 0) {
      const fullHistory = getFullCarelinkHistory();
      sliceAndSaveCareLinkData(fullHistory);
    }
    
    return { status: 'success', downloaded: downloadedCount };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
});

ipcMain.handle('upload-carelink-csv', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return { status: 'canceled' };

  try {
    const csvContent = fs.readFileSync(result.filePaths[0], 'utf-8');
    const carelinkData = parseCareLinkCSV(csvContent);
    const fullHistory = mergeAndSaveFullCarelinkHistory(carelinkData);
    const savedCount = sliceAndSaveCareLinkData(fullHistory);
    return { status: 'success', readings: carelinkData.sgvReadings.length, workoutsUpdated: savedCount };
  } catch (error) {
    console.error('Erro ao processar CSV:', error);
    return { status: 'error', message: 'Falha ao processar o arquivo CSV do CareLink.' };
  }
});

// --- Tags ---

const TAGS_FILE = path.join(DATA_DIR, 'tags.json');

function readTags() {
  if (!fs.existsSync(TAGS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
  } catch { return []; }
}

function writeTags(tags) {
  fs.writeFileSync(TAGS_FILE, JSON.stringify(tags));
}

ipcMain.handle('load-tags', async () => {
  return readTags();
});

ipcMain.handle('save-tag', async (event, tag) => {
  const tags = readTags();
  const existingIndex = tags.findIndex(t => t.id === tag.id);
  if (existingIndex >= 0) {
    tags[existingIndex] = { ...tags[existingIndex], ...tag };
  } else {
    tags.push(tag);
  }
  writeTags(tags);
  return tags;
});

ipcMain.handle('delete-tag', async (event, tagId) => {
  let tags = readTags();
  tags = tags.filter(t => t.id !== tagId);
  writeTags(tags);
  return tags;
});

// --- Comentários ---

function getCommentsPath(workoutId) {
  return path.join(COMMENTS_DIR, `comments_${workoutId}.json`);
}

function readComments(workoutId) {
  const filePath = getCommentsPath(workoutId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return []; }
}

function writeComments(workoutId, comments) {
  fs.writeFileSync(getCommentsPath(workoutId), JSON.stringify(comments));
}

ipcMain.handle('load-comments', async (event, workoutId) => {
  return readComments(workoutId);
});

ipcMain.handle('save-comment', async (event, workoutId, comment) => {
  const comments = readComments(workoutId);
  const existingIndex = comments.findIndex(c => c.id === comment.id);
  if (existingIndex >= 0) {
    comments[existingIndex] = { ...comments[existingIndex], ...comment };
  } else {
    comments.push(comment);
  }
  comments.sort((a, b) => a.timestamp - b.timestamp);
  writeComments(workoutId, comments);
  return comments;
});

ipcMain.handle('delete-comment', async (event, workoutId, commentId) => {
  let comments = readComments(workoutId);
  comments = comments.filter(c => c.id !== commentId);
  writeComments(workoutId, comments);
  return comments;
});

ipcMain.handle('get-print-job', async (event, jobId) => {
  const job = printJobs.get(jobId);
  return job ? job.payload : null;
});

ipcMain.handle('notify-print-ready', async (event, jobId) => {
  const job = printJobs.get(jobId);
  if (!job) return { status: 'missing' };
  if (job.ready) return { status: 'ok' };
  job.ready = true;
  if (job.resolveReady) job.resolveReady();
  return { status: 'ok' };
});

ipcMain.handle('export-workouts-pdf', async (event, payload) => {
  if (!payload || !Array.isArray(payload.workouts) || payload.workouts.length === 0) {
    return { status: 'error', message: 'Nenhum treino selecionado para exportação.' };
  }

  const result = await dialog.showSaveDialog({
    title: 'Exportar PDF',
    defaultPath: `treinos-${new Date().toISOString().slice(0, 10)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (result.canceled || !result.filePath) {
    return { status: 'canceled' };
  }

  const jobId = `print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let printWindow = null;
  const tempPrintPath = path.join(app.getPath('temp'), `${jobId}.html`);
  const startedAt = Date.now();

  const logStage = (stage) => {
    console.log(`[PDF export] ${stage} (${Date.now() - startedAt}ms)`);
  };

  try {
    logStage(`preparando dados de ${payload.workouts.length} treino(s)`);
    const preparedPayload = {
      ...payload,
      workouts: payload.workouts.map((workout) => (
        loadWorkoutForPdfExport(workout, payload.targetLimits, payload.targetGoal)
      )),
    };

    logStage('montando HTML');
    const printHtml = buildPrintDocumentHtml(preparedPayload);
    fs.writeFileSync(tempPrintPath, printHtml, 'utf-8');

    logStage('abrindo janela de impressão');
    printWindow = await withTimeout(
      createPrintWindow(tempPrintPath),
      15000,
      'Tempo limite ao abrir a janela de impressão.'
    );

    logStage('gerando PDF');
    const pdfBuffer = await withTimeout(
      printWindow.webContents.printToPDF({
        pageSize: 'A4',
        landscape: false,
        printBackground: true,
        marginsType: 0,
        preferCSSPageSize: true,
      }),
      90000,
      'Tempo limite ao gerar o PDF.'
    );

    logStage('salvando arquivo');
    fs.writeFileSync(result.filePath, pdfBuffer);
    logStage('concluído');
    return { status: 'success', filePath: result.filePath };
  } catch (error) {
    console.error('Erro ao exportar PDF:', error);
    return { status: 'error', message: error?.message || 'Falha ao gerar o PDF.' };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.close();
    }
    if (fs.existsSync(tempPrintPath)) {
      try {
        fs.unlinkSync(tempPrintPath);
      } catch (unlinkError) {
        console.error('Erro ao remover HTML temporário do PDF:', unlinkError);
      }
    }
    restoreMainWindow();
  }
});

function loadWorkoutForPdfExport(workoutRequest, targetLimits, targetGoal) {
  const workoutId = workoutRequest.id;
  const workoutFile = path.join(WORKOUTS_DIR, `garmin_${workoutId}.json`);
  const carelinkFile = path.join(CARELINK_DIR, `carelink_${workoutId}.json`);

  if (!fs.existsSync(workoutFile)) {
    throw new Error(`Treino ${workoutId} não encontrado para exportação.`);
  }

  const workoutData = JSON.parse(fs.readFileSync(workoutFile, 'utf-8'));
  let carelinkData = { sgvReadings: [], bolusEvents: [], basalChanges: [] };
  if (fs.existsSync(carelinkFile)) {
    carelinkData = JSON.parse(fs.readFileSync(carelinkFile, 'utf-8'));
  }

  return {
    id: workoutId,
    sport: workoutRequest.sport || workoutData.sport || 'Atividade',
    date: workoutRequest.date || workoutData.date,
    trackpoints: workoutData.trackpoints || [],
    carelink: carelinkData,
    metrics: workoutData.metrics || {},
    workoutStart: workoutData.workoutStart,
    workoutEnd: workoutData.workoutEnd,
    comments: readComments(workoutId),
    customInsulin: workoutRequest.customInsulin || '',
    chartSeries: workoutRequest.chartSeries || {
      glucose: true,
      bolus: true,
      pace: false,
      relativeLoad: false,
      heartRate: false,
    },
    targetLimits,
    targetGoal,
  };
}
