export type StationKey =
  | 'fibroscan'
  | 'bca'
  | 'video'
  | 'retinal'
  | 'blood';

export interface FibroscanData {
  lsm: number;
  cap: number;
  notes?: string;
}

export interface BcaData {
  result: string;
  notes?: string;
}

export interface VideoData {
  status: string;
  notes?: string;
}

export interface RetinalData {
  result: string;
  notes?: string;
}

export interface BloodData {
  sampleCollected: boolean;
  notes?: string;
}

export interface RegisterPatientPayload {
  name: string;
  age: number;
  gender: string;
  phone: string;
  occupation: string;
  education: string;
  religion: string;
  maritalStatus: string;
  familyType: string;
}

export interface PatientRecord {
  tempId: string; // 3-digit daily ID
  visitDate: string; // YYYY-MM-DD
  name: string;
  age: number;
  gender: string;
  phone: string;
  occupation: string;
  education: string;
  religion: string;
  maritalStatus: string;
  familyType: string;
  registeredBy?: string; // Operator who registered the patient at Station 1
  fibroscan?: FibroscanData;
  fibroscanBy?: string; // Operator who filled Station 2
  bca?: BcaData;
  bcaBy?: string; // Operator who filled Station 3
  video?: VideoData;
  videoBy?: string; // Operator who filled Station 4
  retinal?: RetinalData;
  retinalBy?: string; // Operator who filled Station 5
  blood?: BloodData;
  bloodBy?: string; // Operator who filled Station 6
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

export type StationPayloadMap = {
  fibroscan: FibroscanData;
  bca: BcaData;
  video: VideoData;
  retinal: RetinalData;
  blood: BloodData;
};