import express from 'express';
import cors from 'cors';
import type { Response } from 'express';
import {
  buildNewPatientRecord,
  getDailyIdStatus,
  getAllPatientsLocal,
  getPatientById,
  getPendingSyncPatients,
  markPatientSynced,
  savePatientLocal,
  updateStationData,
} from './db.js';
import {
  RegisterPatientPayload,
  StationKey,
  StationPayloadMap,
} from './shared-types.js';
import {
  fetchPatientsFromGoogleSheet,
  getGoogleSheetsConfigStatus,
  syncPatientRegistration,
  syncStationData,
  syncPendingPatientsToGoogleSheets,
} from './googleSheets.js';

const app = express();
app.use(cors());
app.use(express.json());

const STATION_NUMBER_BY_KEY: Record<StationKey, number> = {
  fibroscan: 2,
  bca: 3,
  video: 4,
  retinal: 5,
  blood: 6,
};

type ClinicEvent = {
  type: 'patient-registered' | 'patient-updated';
  patient: {
    tempId: string;
    visitDate: string;
    name: string;
    updatedAt: string;
  };
};

const sseClients = new Set<Response>();

const sendSseEvent = (client: Response, event: ClinicEvent) => {
  client.write(`data: ${JSON.stringify(event)}\n\n`);
};

const broadcastEvent = (event: ClinicEvent) => {
  for (const client of sseClients) {
    sendSseEvent(client, event);
  }
};

const VALID_STATIONS: StationKey[] = ['fibroscan', 'bca', 'video', 'retinal', 'blood'];
const VALID_STATION_NUMBERS = [1, 2, 3, 4, 5, 6];

type StationAuthInfo = {
  stationNumber: number;
  operatorName: string;
};

const parseStationNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
};

const extractStationAuthFromHeaders = (req: express.Request): StationAuthInfo | null => {
  const stationNumber = parseStationNumber(req.header('x-station-number') || undefined);
  const operatorName = req.header('x-operator-name') || undefined;

  if (!stationNumber || !operatorName) {
    return null;
  }

  return { stationNumber, operatorName };
};

const extractStationAuthFromQuery = (req: express.Request): StationAuthInfo | null => {
  const rawStation = req.query.station;
  const rawOperatorName = req.query.operatorName;

  const stationString = typeof rawStation === 'string' ? rawStation : undefined;
  const operatorName = typeof rawOperatorName === 'string' ? rawOperatorName : undefined;
  const stationNumber = parseStationNumber(stationString);

  if (!stationNumber || !operatorName) {
    return null;
  }

  return { stationNumber, operatorName };
};

const isStationAllowed = (stationNumber: number, allowedStations: number[]): boolean => {
  return allowedStations.includes(stationNumber);
};

const isValidStation = (stationNumber: number, expectedStation: number): boolean => {
  return stationNumber === expectedStation && VALID_STATION_NUMBERS.includes(stationNumber);
};

const normalizeRegisterPayload = (body: unknown): RegisterPatientPayload | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const input = body as Partial<RegisterPatientPayload> & { age?: number | string };
  const normalizedName = typeof input.name === 'string' ? input.name.trim() : '';
  const normalizedGender = typeof input.gender === 'string' ? input.gender.trim() : '';
  const normalizedPhone =
    typeof input.phone === 'string' ? input.phone.replace(/[^0-9+]/g, '') : '';
  const normalizedOccupation =
    typeof input.occupation === 'string' ? input.occupation.trim() : '';
  const normalizedEducation =
    typeof input.education === 'string' ? input.education.trim() : '';
  const normalizedReligion =
    typeof input.religion === 'string' ? input.religion.trim() : '';
  const normalizedMaritalStatus =
    typeof input.maritalStatus === 'string' ? input.maritalStatus.trim() : '';
  const normalizedFamilyType =
    typeof input.familyType === 'string' ? input.familyType.trim() : '';
  const parsedAge =
    typeof input.age === 'number'
      ? input.age
      : typeof input.age === 'string'
        ? Number(input.age)
        : NaN;

  if (
    !normalizedName ||
    !normalizedGender ||
    !normalizedPhone ||
    !normalizedOccupation ||
    !normalizedEducation ||
    !normalizedReligion ||
    !normalizedMaritalStatus ||
    !normalizedFamilyType ||
    normalizedPhone.length < 8 ||
    !Number.isFinite(parsedAge) ||
    parsedAge <= 0
  ) {
    return null;
  }

  return {
    name: normalizedName,
    age: Math.floor(parsedAge),
    gender: normalizedGender,
    phone: normalizedPhone,
    occupation: normalizedOccupation,
    education: normalizedEducation,
    religion: normalizedReligion,
    maritalStatus: normalizedMaritalStatus,
    familyType: normalizedFamilyType,
  };
};

// Station 1: Submit initial form
app.post('/api/register', (req, res) => {
  const auth = extractStationAuthFromHeaders(req);
  if (!auth || !isValidStation(auth.stationNumber, 1)) {
    res.status(403).json({ message: 'Station 1 with operator name is required.' });
    return;
  }

  const payload = normalizeRegisterPayload(req.body);
  if (!payload) {
    res.status(400).json({
      message:
        'Invalid payload. name, age, gender, phone, occupation, education, religion, maritalStatus, and familyType are required.',
    });
    return;
  }

  let patient;
  try {
    patient = buildNewPatientRecord(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to register patient.';
    if (message.includes('Daily capacity reached')) {
      res.status(409).json({ message });
      return;
    }

    res.status(500).json({ message: 'Unable to create patient record.' });
    return;
  }

  savePatientLocal(patient);

  broadcastEvent({
    type: 'patient-registered',
    patient: {
      tempId: patient.tempId,
      visitDate: patient.visitDate,
      name: patient.name,
      updatedAt: patient.updatedAt,
    },
  });

  // Sync to Google Sheets patients tab
  void syncPatientRegistration(patient)
    .then((synced: boolean) => {
      if (synced) {
        markPatientSynced(patient.tempId, patient.visitDate);
      }
    })
    .catch(() => {
      // Intentionally swallow sync errors to avoid impacting station flow.
    });

  res.status(201).json(patient);
});

// Stations 2-6: Fetch patient by ID
app.get('/api/patient/:id', (req, res) => {
  const auth = extractStationAuthFromHeaders(req);
  if (!auth || !isStationAllowed(auth.stationNumber, [2, 3, 4, 5, 6])) {
    res.status(403).json({ message: 'Valid station (2-6) with operator name is required.' });
    return;
  }

  const id = req.params.id;
  const row = getPatientById(id);

  if (!row) {
    res.status(404).json({ message: 'Patient not found for today.' });
    return;
  }

  res.json(row);
});

app.put('/api/patient/:id/station/:station', (req, res) => {
  const id = req.params.id;
  const station = req.params.station as StationKey;

  if (!VALID_STATIONS.includes(station)) {
    res.status(400).json({ message: 'Invalid station key.' });
    return;
  }

  const expectedStationNumber = STATION_NUMBER_BY_KEY[station];
  const auth = extractStationAuthFromHeaders(req);

  if (!auth || !isValidStation(auth.stationNumber, expectedStationNumber)) {
    res.status(403).json({
      message: `Station ${expectedStationNumber} with operator name is required.`,
    });
    return;
  }

  const payload = req.body as StationPayloadMap[typeof station];
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ message: 'Station payload is required.' });
    return;
  }

  const updated = updateStationData(id, station, payload);
  if (!updated) {
    res.status(404).json({ message: 'Patient not found for today.' });
    return;
  }

  broadcastEvent({
    type: 'patient-updated',
    patient: {
      tempId: updated.tempId,
      visitDate: updated.visitDate,
      name: updated.name,
      updatedAt: updated.updatedAt,
    },
  });

  // Sync to station-specific tab in Google Sheets
  void syncStationData(updated, station)
    .then((synced: boolean) => {
      if (synced) {
        markPatientSynced(updated.tempId, updated.visitDate);
      }
    })
    .catch(() => {
      // Ignore transient sync failures.
    });

  res.status(200).json(updated);
});

app.post('/api/sync/pending', async (_req, res) => {
  const pending = getPendingSyncPatients();
  const result = await syncPendingPatientsToGoogleSheets(pending);

  if (result.syncedKeys.length > 0) {
    for (const patient of pending) {
      const key = `${patient.tempId}:${patient.visitDate}`;
      if (result.syncedKeys.includes(key)) {
        markPatientSynced(patient.tempId, patient.visitDate);
      }
    }
  }

  res.status(200).json({
    pending: pending.length,
    synced: result.syncedKeys.length,
    failed: result.failedKeys.length,
  });
});

app.get('/api/patients', (_req, res) => {
  res.status(200).json(getAllPatientsLocal());
});

// Cache for Google Sheets data (updated every 2 seconds by background job)
let cachedSheetPatients: import('./shared-types.js').PatientRecord[] = [];
let cacheLastUpdated = 0;

const refreshSheetCache = async () => {
  try {
    const records = await fetchPatientsFromGoogleSheet();
    cachedSheetPatients = records;
    cacheLastUpdated = Date.now();
    // Also save to local DB as backup
    for (const record of records) {
      savePatientLocal(record);
    }
  } catch {
    // Keep using old cache on error
  }
};

app.get('/api/patients/today', async (req, res) => {
  const auth = extractStationAuthFromHeaders(req);
  if (!auth || !isStationAllowed(auth.stationNumber, [2, 3, 4, 5, 6])) {
    res.status(403).json({ message: 'Valid station (2-6) with operator name is required.' });
    return;
  }

  // If cache is empty or stale (>15 seconds), refresh it
  if (cachedSheetPatients.length === 0 || Date.now() - cacheLastUpdated > 15000) {
    await refreshSheetCache();
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = cachedSheetPatients.filter((r) => r.visitDate === today);

  res.status(200).json(todayRecords);
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'clinical-workflow-backend' });
});

app.get('/api/id-status', (_req, res) => {
  res.status(200).json(getDailyIdStatus());
});

app.get('/api/sync/config', (_req, res) => {
  const config = getGoogleSheetsConfigStatus();
  res.status(200).json(config);
});

app.post('/api/sync/pull', async (_req, res) => {
  const records = await fetchPatientsFromGoogleSheet();
  let imported = 0;

  for (const record of records) {
    savePatientLocal(record);
    imported += 1;
  }

  res.status(200).json({ imported });
});

app.get('/api/events', (req, res) => {
  const auth = extractStationAuthFromQuery(req);
  if (!auth || !isStationAllowed(auth.stationNumber, [2, 3, 4, 5, 6])) {
    res.status(403).json({ message: 'Valid station (2-6) with operator name is required.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Keep-alive comment for proxies and idle connections.
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  res.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    res.end();
  });
});

app.get('/api/station/auth-check', (req, res) => {
  const auth = extractStationAuthFromHeaders(req);
  if (!auth) {
    res.status(403).json({ message: 'Station number and operator name are required.' });
    return;
  }

  if (!isStationAllowed(auth.stationNumber, [1, 2, 3, 4, 5, 6])) {
    res.status(403).json({ message: 'Invalid station number.' });
    return;
  }

  res.status(200).json({ ok: true, station: auth.stationNumber, operator: auth.operatorName });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  res.status(500).json({ message });
});

const PORT = Number(process.env.PORT || 5001);

const GOOGLE_PULL_INTERVAL_MS = Number(process.env.GOOGLE_PULL_INTERVAL_MS || 10000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Initial cache load
  void refreshSheetCache();

  // Background job to keep cache updated
  setInterval(() => {
    void refreshSheetCache();
  }, GOOGLE_PULL_INTERVAL_MS);
});
