import { XMLParser } from 'fast-xml-parser';

const MAX_HR = 200; // Como definido no prompt para o mockup

export function parseTCX(xmlString) {
  const parser = new XMLParser({ 
    ignoreAttributes: false, 
    attributeNamePrefix: '@_',
    parseAttributeValue: true
  });
  const result = parser.parse(xmlString);
  
  const activity = result.TrainingCenterDatabase.Activities.Activity;
  // Lap pode ser um objeto ou um array
  const laps = Array.isArray(activity.Lap) ? activity.Lap : [activity.Lap];
  
  let allTrackpoints = [];
  
  laps.forEach(lap => {
    const track = lap.Track;
    if (!track) return;
    
    const points = Array.isArray(track.Trackpoint) ? track.Trackpoint : [track.Trackpoint];
    
    points.forEach(tp => {
      const extensions = tp.Extensions?.['ns3:TPX'];
      const heartRate = tp.HeartRateBpm?.Value ? parseInt(tp.HeartRateBpm.Value) : null;
      const speed = extensions?.['ns3:Speed'] ? parseFloat(extensions['ns3:Speed']) : 0;
      
      allTrackpoints.push({
        timestamp: new Date(tp.Time), // ISO 8601 UTC ("Z")
        distanceMeters: parseFloat(tp.DistanceMeters) || 0,
        heartRate: heartRate,
        speed: speed,
        cadence: extensions?.['ns3:RunCadence'] ? parseInt(extensions['ns3:RunCadence']) * 2 : 0, // x2 para spm real
        watts: extensions?.['ns3:Watts'] ? parseInt(extensions['ns3:Watts']) : 0,
        // Campos derivados
        paceSecondsPerKm: speed > 0.1 ? 1000 / speed : null,
        relativeLoad: heartRate ? (heartRate / MAX_HR) * 100 : null,
      });
    });
  });
  
  if (allTrackpoints.length > 0) {
    let firstValidPaceTs = null;
    for (const tp of allTrackpoints) {
      if (tp.paceSecondsPerKm !== null) {
        firstValidPaceTs = tp.timestamp.getTime();
        break;
      }
    }

    if (firstValidPaceTs !== null) {
      const initialWindowMs = 150000; // Analisar primeiros 2m30s a partir do primeiro pace válido
      
      let minPace = Infinity;
      
      // Descobre o melhor pace real nos primeiros 2m30s
      for (const tp of allTrackpoints) {
        if (tp.timestamp.getTime() - firstValidPaceTs > initialWindowMs) break;
        if (tp.timestamp.getTime() >= firstValidPaceTs && tp.paceSecondsPerKm !== null && tp.paceSecondsPerKm < minPace) {
          minPace = tp.paceSecondsPerKm;
        }
      }
      
      // Se encontrou um pace, apaga os que são > 2' mais lentos que o melhor pace nesse início
      if (minPace !== Infinity) {
        for (const tp of allTrackpoints) {
          if (tp.timestamp.getTime() - firstValidPaceTs > initialWindowMs) break;
          if (tp.timestamp.getTime() >= firstValidPaceTs && tp.paceSecondsPerKm !== null && tp.paceSecondsPerKm - minPace > 120) {
            tp.paceSecondsPerKm = null;
          }
        }
      }
    }
  }
  
  return allTrackpoints;
}

export function downsample(trackpoints, intervalSeconds = 10) {
  const result = [];
  let lastTimestamp = null;
  for (const tp of trackpoints) {
    if (!lastTimestamp || (tp.timestamp.getTime() - lastTimestamp.getTime()) >= intervalSeconds * 1000) {
      result.push(tp);
      lastTimestamp = tp.timestamp;
    }
  }
  return result;
}
