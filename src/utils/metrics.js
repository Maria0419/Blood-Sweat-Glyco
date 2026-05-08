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
  
  const findClosest = (time) => {
    let closest = sgvReadings[0];
    const targetTs = typeof time === 'object' ? time.getTime() : time;
    let minDiff = Math.abs((typeof sgvReadings[0].timestamp === 'object' ? sgvReadings[0].timestamp.getTime() : sgvReadings[0].timestamp) - targetTs);
    
    for (const r of sgvReadings) {
      const rTs = typeof r.timestamp === 'object' ? r.timestamp.getTime() : r.timestamp;
      const diff = Math.abs(rTs - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }
    return minDiff < 15 * 60 * 1000 ? closest.glucose : null; // Limite de 15 min
  };
  
  const startGlucose = findClosest(startTs);
  const endGlucose = findClosest(endTs);
  const preGlucose = findClosest(startTs - hourMs);
  const postGlucose = findClosest(endTs + hourMs);
  
  const workoutReadings = sgvReadings.filter(r => {
    const rTs = typeof r.timestamp === 'object' ? r.timestamp.getTime() : r.timestamp;
    return rTs >= startTs && rTs <= endTs;
  });
  const minGlucose = workoutReadings.length ? Math.min(...workoutReadings.map(r => r.glucose)) : null;
  
  return {
    preWorkout: preGlucose,
    start: startGlucose,
    min: minGlucose,
    end: endGlucose,
    postWorkout: postGlucose,
    variation: (startGlucose && endGlucose) ? endGlucose - startGlucose : null,
  };
}
