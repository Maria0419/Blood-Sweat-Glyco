export function formatPace(speed) {
  if (!speed || speed < 0.1) return "—";
  const paceSecondsPerKm = 1000 / speed;
  const min = Math.floor(paceSecondsPerKm / 60);
  const sec = Math.round(paceSecondsPerKm % 60);
  return `${min}'${String(sec).padStart(2, '0')}''`;
}

export function calculateWorkoutMetrics(trackpoints) {
  if (!trackpoints.length) return null;
  
  const totalTimeSeconds = (trackpoints[trackpoints.length - 1].timestamp - trackpoints[0].timestamp) / 1000;
  const totalDistance = trackpoints[trackpoints.length - 1].distanceMeters;
  
  const heartRates = trackpoints.map(tp => tp.heartRate).filter(hr => hr !== null);
  const avgHR = heartRates.length ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : 0;
  const maxHR = heartRates.length ? Math.max(...heartRates) : 0;
  
  const watts = trackpoints.map(tp => tp.watts).filter(w => w > 0);
  const avgWatts = watts.length ? watts.reduce((a, b) => a + b, 0) / watts.length : 0;
  const maxWatts = watts.length ? Math.max(...watts) : 0;
  
  const relativeLoads = trackpoints.map(tp => tp.relativeLoad).filter(rl => rl !== null);
  const avgRelativeLoad = relativeLoads.length ? relativeLoads.reduce((a, b) => a + b, 0) / relativeLoads.length : 0;
  
  const avgPaceSpeed = totalDistance / totalTimeSeconds;
  
  return {
    duration: formatDuration(totalTimeSeconds),
    distanceKm: (totalDistance / 1000).toFixed(2),
    avgPace: formatPace(avgPaceSpeed),
    avgHR: Math.round(avgHR),
    maxHR: Math.round(maxHR),
    avgRelativeLoad: Math.round(avgRelativeLoad),
    avgWatts: Math.round(avgWatts),
    maxWatts: Math.round(maxWatts),
  };
}

function formatDuration(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function calculateGlucoseImpact(sgvReadings, workoutStart, workoutEnd) {
  if (!sgvReadings || !sgvReadings.length) return null;
  
  const hourMs = 60 * 60 * 1000;
  const startTs = typeof workoutStart === 'object' ? workoutStart.getTime() : workoutStart;
  const endTs = typeof workoutEnd === 'object' ? workoutEnd.getTime() : workoutEnd;
  const normalizedReadings = sgvReadings
    .map(r => ({
      ...r,
      timestamp: typeof r.timestamp === 'object' ? r.timestamp.getTime() : r.timestamp,
    }))
    .filter(r => Number.isFinite(r.timestamp) && Number.isFinite(r.glucose))
    .sort((a, b) => a.timestamp - b.timestamp);
  
  const findClosest = (time) => {
    const targetTs = typeof time === 'object' ? time.getTime() : time;
    let closest = normalizedReadings[0];
    let minDiff = Math.abs((closest?.timestamp ?? 0) - targetTs);
    
    for (const r of normalizedReadings) {
      const diff = Math.abs(r.timestamp - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }
    return minDiff < 15 * 60 * 1000 ? closest?.glucose ?? null : null; // Limite de 15 min
  };

  const startGlucose = findClosest(startTs);
  const endGlucose = findClosest(endTs);
  const preGlucose = findClosest(startTs - hourMs);
  const postGlucose = findClosest(endTs + hourMs);
  
  const workoutGlucoseValues = normalizedReadings
    .filter(r => r.timestamp >= startTs && r.timestamp <= endTs)
    .map(r => r.glucose);
  const minGlucose = workoutGlucoseValues.length ? Math.round(Math.min(...workoutGlucoseValues)) : null;
  
  return {
    preWorkout: preGlucose,
    start: startGlucose,
    min: minGlucose,
    end: endGlucose,
    postWorkout: postGlucose,
    variation: (startGlucose && endGlucose) ? endGlucose - startGlucose : null,
  };
}
