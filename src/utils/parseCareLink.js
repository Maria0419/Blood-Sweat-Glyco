export function parseCareLink(csvString) {
  try {
    const text = csvString.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    
    // Localizar a linha do header dinamicamente (procurar por "Index;Date;Time")
    const headerIndex = lines.findIndex(l => l.includes('Index;Date;Time'));
    if (headerIndex === -1) {
      console.error("Header 'Index;Date;Time' não encontrado no CSV");
      return { sgvReadings: [], bolusEvents: [], basalChanges: [] };
    }

    const dataLines = lines.slice(headerIndex + 1);
    const sgvReadings = [];
    const bolusEvents = [];
    const basalChanges = [];
    
    for (const line of dataLines) {
      const cols = line.split(';').map(c => c.trim().replace(/"/g, ''));
      
      // Se a linha não tem data/hora, pular
      if (!cols[1] || !cols[2]) continue;
      
      // Parse do timestamp local BRT (UTC-3)
      const dateStr = cols[1]; // "2026/04/08"
      const timeStr = cols[2]; // "13:19:46"
      
      // Garantir que a data está no formato esperado antes de processar
      if (!dateStr.includes('/') || !timeStr.includes(':')) continue;

      const iso = `${dateStr.replace(/\//g, '-')}T${timeStr}-03:00`;
      const timestamp = new Date(iso);
      
      if (isNaN(timestamp.getTime())) continue;

      // Sensor Glucose (col 35, index 34)
      if (cols[34] && cols[34] !== '') {
        sgvReadings.push({
          timestamp,
          glucose: parseFloat(cols[34].replace(',', '.')),
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
    
    sgvReadings.sort((a, b) => a.timestamp - b.timestamp);
    bolusEvents.sort((a, b) => a.timestamp - b.timestamp);
    basalChanges.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`CareLink parsed: ${sgvReadings.length} SGV, ${bolusEvents.length} Bolus`);
    return { sgvReadings, bolusEvents, basalChanges };
  } catch (err) {
    console.error("Erro no parseCareLink:", err);
    throw err;
  }
}
