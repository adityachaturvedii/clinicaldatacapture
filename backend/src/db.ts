import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import {
  PatientRecord,
  RegisterPatientPayload,
  StationKey,
  StationPayloadMap,
} from './shared-types';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const dbFilePath = join(currentDir, '../clinic_backup.db');
const offlineExcelPath = join(currentDir, '../clinic_backup_offline.xlsx');

const db = new Database(dbFilePath);

// Initialize table
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    tempId TEXT NOT NULL,
    visitDate TEXT NOT NULL,
    name TEXT,
    data TEXT NOT NULL,
    synced INTEGER DEFAULT 0,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (tempId, visitDate)
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_patients_visit_date ON patients(visitDate)');

const todayDateString = (): string => new Date().toISOString().slice(0, 10);

const getUsedIdsForDate = (visitDate: string): Set<number> => {
  const rows = db
    .prepare(
      `
      SELECT tempId
      FROM patients
      WHERE visitDate = ?
      `,
    )
    .all(visitDate) as Array<{ tempId: string }>;

  const usedIds = new Set<number>();
  for (const row of rows) {
    const parsed = Number(row.tempId);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 999) {
      usedIds.add(parsed);
    }
  }

  return usedIds;
};

const parseRowToPatient = (row: { data: string } | undefined): PatientRecord | null => {
  if (!row) {
    return null;
  }
  return JSON.parse(row.data) as PatientRecord;
};

export const isTempIdTakenForDate = (tempId: string, visitDate: string): boolean => {
  const row = db
    .prepare('SELECT tempId FROM patients WHERE tempId = ? AND visitDate = ? LIMIT 1')
    .get(tempId, visitDate);
  return Boolean(row);
};

export const generateUniqueDailyTempId = (visitDate: string): string => {
  const usedIds = getUsedIdsForDate(visitDate);

  for (let candidate = 1; candidate <= 999; candidate += 1) {
    if (!usedIds.has(candidate)) {
      return String(candidate).padStart(3, '0');
    }
  }

  throw new Error('Unable to generate unique 3-digit ID for the selected day.');
};

export const getDailyIdStatus = (visitDate = todayDateString()) => {
  const usedIds = getUsedIdsForDate(visitDate);

  let nextId: string | null = null;
  for (let candidate = 1; candidate <= 999; candidate += 1) {
    if (!usedIds.has(candidate)) {
      nextId = String(candidate).padStart(3, '0');
      break;
    }
  }

  const usedCount = usedIds.size;
  const remainingCount = Math.max(0, 999 - usedCount);

  return {
    visitDate,
    nextId,
    usedCount,
    remainingCount,
    capacity: 999,
  };
};

export const buildNewPatientRecord = (payload: RegisterPatientPayload): PatientRecord => {
  const now = new Date().toISOString();
  const visitDate = todayDateString();

  return {
    tempId: generateUniqueDailyTempId(visitDate),
    visitDate,
    name: payload.name.trim(),
    age: payload.age,
    gender: payload.gender.trim(),
    phone: payload.phone.trim(),
    occupation: payload.occupation.trim(),
    education: payload.education.trim(),
    religion: payload.religion.trim(),
    maritalStatus: payload.maritalStatus.trim(),
    familyType: payload.familyType.trim(),
    createdAt: now,
    updatedAt: now,
  };
};

const exportPatientsToOfflineExcel = () => {
  const records = getAllPatientsLocal();

  const rows = records.map((record) => ({
    tempId: record.tempId,
    visitDate: record.visitDate,
    name: record.name,
    age: record.age,
    gender: record.gender,
    phone: record.phone,
    occupation: record.occupation,
    education: record.education,
    religion: record.religion,
    maritalStatus: record.maritalStatus,
    familyType: record.familyType,
    fibroscan: record.fibroscan ? JSON.stringify(record.fibroscan) : '',
    bca: record.bca ? JSON.stringify(record.bca) : '',
    video: record.video ? JSON.stringify(record.video) : '',
    retinal: record.retinal ? JSON.stringify(record.retinal) : '',
    blood: record.blood ? JSON.stringify(record.blood) : '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    syncedAt: record.syncedAt || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Patients');
  XLSX.writeFile(workbook, offlineExcelPath);
};

export const savePatientLocal = (patient: PatientRecord) => {
  const stmt = db.prepare(
    `
      INSERT OR REPLACE INTO patients (tempId, visitDate, name, data, synced, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  );

  stmt.run(
    patient.tempId,
    patient.visitDate,
    patient.name,
    JSON.stringify(patient),
    patient.syncedAt ? 1 : 0,
    patient.updatedAt,
  );

  try {
    exportPatientsToOfflineExcel();
  } catch (error) {
    // Keep local DB write as source of truth if Excel backup write fails.
    console.error('Offline Excel backup write failed:', error);
  }
};

export const getPatientById = (tempId: string, visitDate = todayDateString()): PatientRecord | null => {
  const row = db
    .prepare(
      'SELECT data FROM patients WHERE tempId = ? AND visitDate = ? ORDER BY updatedAt DESC LIMIT 1',
    )
    .get(tempId, visitDate) as { data: string } | undefined;
  return parseRowToPatient(row);
};

export const updateStationData = <K extends StationKey>(
  tempId: string,
  station: K,
  payload: StationPayloadMap[K],
): PatientRecord | null => {
  const patient = getPatientById(tempId);
  if (!patient) {
    return null;
  }

  const updated: PatientRecord = {
    ...patient,
    [station]: payload,
    updatedAt: new Date().toISOString(),
    syncedAt: undefined,
  };

  savePatientLocal(updated);
  return updated;
};

export const markPatientSynced = (
  tempId: string,
  visitDate = todayDateString(),
): PatientRecord | null => {
  const patient = getPatientById(tempId, visitDate);
  if (!patient) {
    return null;
  }

  const updated: PatientRecord = {
    ...patient,
    syncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  savePatientLocal(updated);
  return updated;
};

export const getPendingSyncPatients = (): PatientRecord[] => {
  const rows = db
    .prepare('SELECT data FROM patients WHERE synced = 0 ORDER BY updatedAt ASC')
    .all() as Array<{ data: string }>;

  return rows.map((row) => JSON.parse(row.data) as PatientRecord);
};

export const getAllPatientsLocal = (): PatientRecord[] => {
  const rows = db.prepare('SELECT data FROM patients ORDER BY updatedAt DESC').all() as Array<{
    data: string;
  }>;
  return rows.map((row) => JSON.parse(row.data) as PatientRecord);
};

export const getPatientsForDate = (visitDate = todayDateString()): PatientRecord[] => {
  const rows = db
    .prepare('SELECT data FROM patients WHERE visitDate = ? ORDER BY updatedAt DESC')
    .all(visitDate) as Array<{ data: string }>;

  return rows.map((row) => JSON.parse(row.data) as PatientRecord);
};
