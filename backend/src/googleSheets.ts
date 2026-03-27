import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import { PatientRecord, StationKey } from './shared-types.js';

// Tab names for each station
const STATION_TABS = {
	patients: 'patients',      // Station 1 - Registration
	fibroscan: 'fibroscan',    // Station 2
	bca: 'bca',                // Station 3
	video: 'video',            // Station 4
	retinal: 'retinal',        // Station 5
	blood: 'blood',            // Station 6
} as const;

// Headers for each tab
const TAB_HEADERS: Record<string, string[]> = {
	patients: [
		'TempID', 'VisitDate', 'Name', 'Age', 'Gender', 'Phone',
		'Occupation', 'Education', 'Religion', 'MaritalStatus', 'FamilyType',
		'CreatedAt', 'UpdatedAt'
	],
	fibroscan: ['TempID', 'VisitDate', 'Name', 'LSM', 'CAP', 'Notes', 'UpdatedAt'],
	bca: ['TempID', 'VisitDate', 'Name', 'Result', 'Notes', 'UpdatedAt'],
	video: ['TempID', 'VisitDate', 'Name', 'Status', 'Notes', 'UpdatedAt'],
	retinal: ['TempID', 'VisitDate', 'Name', 'Result', 'Notes', 'UpdatedAt'],
	blood: ['TempID', 'VisitDate', 'Name', 'SampleCollected', 'Notes', 'UpdatedAt'],
};

const getGoogleEnv = () => {
	return {
		googleSheetsId: process.env.GOOGLE_SHEETS_ID,
		googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
		googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
		googleUseAdc: process.env.GOOGLE_USE_ADC === 'true',
		googleClientId: process.env.GOOGLE_CLIENT_ID,
		googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
		googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
	};
};

const isGoogleSheetsConfigured = (): boolean => {
	const env = getGoogleEnv();
	const hasServiceAccountKey = Boolean(
		env.googleServiceAccountEmail && env.googlePrivateKey,
	);
	const hasAdc = env.googleUseAdc;
	const hasOAuth2 = Boolean(
		env.googleClientId && env.googleClientSecret && env.googleRefreshToken,
	);

	return Boolean(env.googleSheetsId && (hasServiceAccountKey || hasAdc || hasOAuth2));
};

export const getGoogleSheetsConfigStatus = (): {
	configured: boolean;
	missing: string[];
	authMethod: string;
} => {
	const env = getGoogleEnv();
	const missing: string[] = [];

	if (!env.googleSheetsId) {
		missing.push('GOOGLE_SHEETS_ID');
	}

	const hasOAuth2 = Boolean(
		env.googleClientId && env.googleClientSecret && env.googleRefreshToken,
	);

	if (hasOAuth2) {
		return {
			configured: Boolean(env.googleSheetsId),
			missing: env.googleSheetsId ? [] : ['GOOGLE_SHEETS_ID'],
			authMethod: 'oauth2',
		};
	}

	if (env.googleUseAdc) {
		return {
			configured: missing.length === 0,
			missing,
			authMethod: 'adc',
		};
	}

	if (!env.googleServiceAccountEmail) {
		missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
	}
	if (!env.googlePrivateKey) {
		missing.push('GOOGLE_PRIVATE_KEY');
	}

	return {
		configured: missing.length === 0,
		missing,
		authMethod: 'service_account',
	};
};

const getSheetsClient = (): sheets_v4.Sheets | null => {
	if (!isGoogleSheetsConfigured()) {
		return null;
	}

	const env = getGoogleEnv();

	if (env.googleClientId && env.googleClientSecret && env.googleRefreshToken) {
		const oauth2Client = new google.auth.OAuth2(
			env.googleClientId,
			env.googleClientSecret,
		);
		oauth2Client.setCredentials({
			refresh_token: env.googleRefreshToken,
		});
		return google.sheets({ version: 'v4', auth: oauth2Client });
	}

	if (env.googleUseAdc) {
		const auth = new google.auth.GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/spreadsheets'],
		});
		return google.sheets({ version: 'v4', auth });
	}

	const auth = new google.auth.JWT({
		email: env.googleServiceAccountEmail,
		key: env.googlePrivateKey,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	});

	return google.sheets({ version: 'v4', auth });
};

// Ensure tab exists and has headers
const ensureTabWithHeaders = async (
	sheets: sheets_v4.Sheets,
	spreadsheetId: string,
	tabName: string,
): Promise<boolean> => {
	try {
		// Check if tab exists
		const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
		const existingSheets = spreadsheet.data.sheets || [];
		const tabExists = existingSheets.some(
			(s) => s.properties?.title?.toLowerCase() === tabName.toLowerCase()
		);

		// Create tab if it doesn't exist
		if (!tabExists) {
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId,
				requestBody: {
					requests: [{
						addSheet: {
							properties: { title: tabName }
						}
					}]
				}
			});
		}

		// Check if headers exist (read first row)
		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `${tabName}!A1:Z1`,
		});

		const firstRow = response.data.values?.[0] || [];
		const expectedHeaders = TAB_HEADERS[tabName] || [];

		// If no headers or headers don't match, add them
		if (firstRow.length === 0 || firstRow[0] !== expectedHeaders[0]) {
			await sheets.spreadsheets.values.update({
				spreadsheetId,
				range: `${tabName}!A1`,
				valueInputOption: 'RAW',
				requestBody: {
					values: [expectedHeaders]
				}
			});
		}

		return true;
	} catch (error) {
		console.error(`Error ensuring tab ${tabName}:`, error);
		return false;
	}
};

// Convert patient registration to row for patients tab
const patientToRegistrationRow = (patient: PatientRecord): string[] => {
	return [
		patient.tempId,
		patient.visitDate,
		patient.name,
		String(patient.age),
		patient.gender,
		patient.phone,
		patient.occupation,
		patient.education,
		patient.religion,
		patient.maritalStatus,
		patient.familyType,
		patient.createdAt,
		patient.updatedAt,
	];
};

// Convert station data to row for station-specific tabs
const stationDataToRow = (
	patient: PatientRecord,
	station: StationKey,
): string[] | null => {
	const baseInfo = [patient.tempId, patient.visitDate, patient.name];
	const timestamp = new Date().toISOString();

	switch (station) {
		case 'fibroscan':
			if (!patient.fibroscan) return null;
			return [...baseInfo,
				String(patient.fibroscan.lsm || ''),
				String(patient.fibroscan.cap || ''),
				patient.fibroscan.notes || '',
				timestamp
			];
		case 'bca':
			if (!patient.bca) return null;
			return [...baseInfo,
				patient.bca.result || '',
				patient.bca.notes || '',
				timestamp
			];
		case 'video':
			if (!patient.video) return null;
			return [...baseInfo,
				patient.video.status || '',
				patient.video.notes || '',
				timestamp
			];
		case 'retinal':
			if (!patient.retinal) return null;
			return [...baseInfo,
				patient.retinal.result || '',
				patient.retinal.notes || '',
				timestamp
			];
		case 'blood':
			if (!patient.blood) return null;
			return [...baseInfo,
				patient.blood.sampleCollected ? 'Yes' : 'No',
				patient.blood.notes || '',
				timestamp
			];
		default:
			return null;
	}
};

// Sync new patient registration to patients tab
export const syncPatientRegistration = async (patient: PatientRecord): Promise<boolean> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) return false;

	const sheets = getSheetsClient();
	if (!sheets) return false;

	try {
		await ensureTabWithHeaders(sheets, env.googleSheetsId, STATION_TABS.patients);

		await sheets.spreadsheets.values.append({
			spreadsheetId: env.googleSheetsId,
			range: `${STATION_TABS.patients}!A:M`,
			valueInputOption: 'RAW',
			requestBody: {
				values: [patientToRegistrationRow(patient)],
			},
		});

		return true;
	} catch (error) {
		console.error('Error syncing patient registration:', error);
		return false;
	}
};

// Sync station-specific data to its tab
export const syncStationData = async (
	patient: PatientRecord,
	station: StationKey,
): Promise<boolean> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) return false;

	const sheets = getSheetsClient();
	if (!sheets) return false;

	const tabName = STATION_TABS[station];
	if (!tabName) return false;

	try {
		await ensureTabWithHeaders(sheets, env.googleSheetsId, tabName);

		const row = stationDataToRow(patient, station);
		if (!row) return false;

		// Check if this patient already has an entry in this station's tab
		const existing = await sheets.spreadsheets.values.get({
			spreadsheetId: env.googleSheetsId,
			range: `${tabName}!A:C`,
		});

		const rows = existing.data.values || [];
		let rowIndex = -1;

		// Find existing row for this patient (match tempId and visitDate)
		for (let i = 1; i < rows.length; i++) {
			if (rows[i][0] === patient.tempId && rows[i][1] === patient.visitDate) {
				rowIndex = i + 1; // 1-indexed for sheets
				break;
			}
		}

		if (rowIndex > 0) {
			// Update existing row
			await sheets.spreadsheets.values.update({
				spreadsheetId: env.googleSheetsId,
				range: `${tabName}!A${rowIndex}`,
				valueInputOption: 'RAW',
				requestBody: {
					values: [row],
				},
			});
		} else {
			// Append new row
			await sheets.spreadsheets.values.append({
				spreadsheetId: env.googleSheetsId,
				range: `${tabName}!A:G`,
				valueInputOption: 'RAW',
				requestBody: {
					values: [row],
				},
			});
		}

		return true;
	} catch (error) {
		console.error(`Error syncing station ${station} data:`, error);
		return false;
	}
};

// Legacy function for backward compatibility - syncs to patients tab
export const syncPatientToGoogleSheet = async (patient: PatientRecord): Promise<boolean> => {
	return syncPatientRegistration(patient);
};

export const syncPendingPatientsToGoogleSheets = async (
	patients: PatientRecord[],
): Promise<{ syncedKeys: string[]; failedKeys: string[] }> => {
	const syncedKeys: string[] = [];
	const failedKeys: string[] = [];

	for (const patient of patients) {
		const synced = await syncPatientRegistration(patient);
		const key = `${patient.tempId}:${patient.visitDate}`;
		if (synced) {
			syncedKeys.push(key);
		} else {
			failedKeys.push(key);
		}
	}

	return { syncedKeys, failedKeys };
};

// Parse row from patients tab
const rowToPatient = (row: string[]): PatientRecord | null => {
	if (!row || row.length < 6) return null;

	const age = Number(row[3]);
	if (!row[0] || !row[1] || !row[2] || !Number.isFinite(age)) {
		return null;
	}

	return {
		tempId: row[0],
		visitDate: row[1],
		name: row[2],
		age,
		gender: row[4] || '',
		phone: row[5] || '',
		occupation: row[6] || '',
		education: row[7] || '',
		religion: row[8] || '',
		maritalStatus: row[9] || '',
		familyType: row[10] || '',
		createdAt: row[11] || new Date().toISOString(),
		updatedAt: row[12] || new Date().toISOString(),
	};
};

// Fetch patients from patients tab (for stations 2-6 to see registered patients)
export const fetchPatientsFromGoogleSheet = async (): Promise<PatientRecord[]> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) return [];

	const sheets = getSheetsClient();
	if (!sheets) return [];

	try {
		await ensureTabWithHeaders(sheets, env.googleSheetsId, STATION_TABS.patients);

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId: env.googleSheetsId,
			range: `${STATION_TABS.patients}!A:M`,
		});

		const rows = (response.data.values || []) as string[][];
		const records: PatientRecord[] = [];

		// Skip header row (index 0)
		for (let i = 1; i < rows.length; i++) {
			const patient = rowToPatient(rows[i]);
			if (patient) {
				records.push(patient);
			}
		}

		return records;
	} catch (error) {
		console.error('Error fetching patients from sheet:', error);
		return [];
	}
};

// Fetch station-specific data for a patient
export const fetchStationDataFromSheet = async (
	tempId: string,
	visitDate: string,
	station: StationKey,
): Promise<Record<string, unknown> | null> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) return null;

	const sheets = getSheetsClient();
	if (!sheets) return null;

	const tabName = STATION_TABS[station];
	if (!tabName) return null;

	try {
		await ensureTabWithHeaders(sheets, env.googleSheetsId, tabName);

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId: env.googleSheetsId,
			range: `${tabName}!A:G`,
		});

		const rows = (response.data.values || []) as string[][];

		// Skip header, find matching patient
		for (let i = 1; i < rows.length; i++) {
			if (rows[i][0] === tempId && rows[i][1] === visitDate) {
				const row = rows[i];
				switch (station) {
					case 'fibroscan':
						return { lsm: Number(row[3]) || 0, cap: Number(row[4]) || 0, notes: row[5] || '' };
					case 'bca':
						return { result: row[3] || '', notes: row[4] || '' };
					case 'video':
						return { status: row[3] || '', notes: row[4] || '' };
					case 'retinal':
						return { result: row[3] || '', notes: row[4] || '' };
					case 'blood':
						return { sampleCollected: row[3] === 'Yes', notes: row[4] || '' };
				}
			}
		}

		return null;
	} catch (error) {
		console.error(`Error fetching ${station} data:`, error);
		return null;
	}
};
