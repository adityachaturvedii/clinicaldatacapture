import {
	PatientRecord,
	RegisterPatientPayload,
	StationKey,
	StationPayloadMap,
} from './shared-types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

export type StationAuth = {
	stationNumber: number;
	operatorId: string;
	password: string;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
	const mergedHeaders: HeadersInit = {
		'Content-Type': 'application/json',
		...(init?.headers || {}),
	};

	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: mergedHeaders,
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || 'Request failed');
	}

	return response.json() as Promise<T>;
};

export const registerPatient = (payload: RegisterPatientPayload): Promise<PatientRecord> => {
	return request<PatientRecord>('/api/register', {
		method: 'POST',
		body: JSON.stringify(payload),
	});
};

export const registerPatientFromStation = (
	payload: RegisterPatientPayload,
	auth: StationAuth,
): Promise<PatientRecord> => {
	return request<PatientRecord>('/api/register', {
		method: 'POST',
		headers: {
			'x-station-number': String(auth.stationNumber),
			'x-station-id': auth.operatorId,
			'x-station-password': auth.password,
		},
		body: JSON.stringify(payload),
	});
};

export const fetchPatientById = (id: string, auth: StationAuth): Promise<PatientRecord> => {
	return request<PatientRecord>(`/api/patient/${encodeURIComponent(id)}`, {
		headers: {
			'x-station-number': String(auth.stationNumber),
			'x-station-id': auth.operatorId,
			'x-station-password': auth.password,
		},
	});
};

export const fetchTodayPatients = (auth: StationAuth): Promise<PatientRecord[]> => {
	return request<PatientRecord[]>('/api/patients/today', {
		headers: {
			'x-station-number': String(auth.stationNumber),
			'x-station-id': auth.operatorId,
			'x-station-password': auth.password,
		},
	});
};

export const verifyStationAccess = (auth: StationAuth): Promise<{ ok: boolean; station: number }> => {
	return request<{ ok: boolean; station: number }>('/api/station/auth-check', {
		headers: {
			'x-station-number': String(auth.stationNumber),
			'x-station-id': auth.operatorId,
			'x-station-password': auth.password,
		},
	});
};

export const updateStation = <K extends StationKey>(
	id: string,
	station: K,
	payload: StationPayloadMap[K],
	auth?: StationAuth,
): Promise<PatientRecord> => {
	return request<PatientRecord>(
		`/api/patient/${encodeURIComponent(id)}/station/${encodeURIComponent(station)}`,
		{
			method: 'PUT',
			headers: auth
				? {
					'x-station-number': String(auth.stationNumber),
					'x-station-id': auth.operatorId,
					'x-station-password': auth.password,
				}
				: undefined,
			body: JSON.stringify(payload),
		},
	);
};

export const openClinicEventsStream = (auth: StationAuth): EventSource => {
	const params = new URLSearchParams({
		station: String(auth.stationNumber),
		operatorId: auth.operatorId,
		password: auth.password,
	});
	return new EventSource(`${API_BASE}/api/events?${params.toString()}`);
};
