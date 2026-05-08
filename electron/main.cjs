const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const keytar = require('keytar');
const { GarminConnect } = require('garmin-connect');
const { XMLParser } = require('fast-xml-parser');

const SERVICE_NAME = 'BloodSweatGlyco';
const ACCOUNT_GARMIN = 'GarminConnect';

let gcClient = null;

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

  const workoutStart = downsampled[0].timestamp;
  const workoutEnd = downsampled[downsampled.length - 1].timestamp;
  
  // Cálculo de Métricas (Fix para Undefined)
  const totalTimeSeconds = (workoutEnd - workoutStart) / 1000;
  const totalDistance = downsampled[downsampled.length - 1].distanceMeters;
  
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

// --- Fim Funções Auxiliares ---

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#121212',
    show: false,
    icon: path.join(__dirname, '../bs&g.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenu(null);

  win.once('ready-to-show', () => {
    win.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
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
      
      // Forçar re-processamento se as métricas estiverem faltando no JSON existente
      let shouldProcess = !fs.existsSync(finalJsonPath);
      if (!shouldProcess) {
        const existing = JSON.parse(fs.readFileSync(finalJsonPath, 'utf-8'));
        if (!existing.metrics || existing.metrics.avgHR === undefined) {
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


