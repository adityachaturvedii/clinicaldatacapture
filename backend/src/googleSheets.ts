import 'dotenv/config';
import { google } from 'googleapis';
import { PatientRecord } from './shared-types.js';

const getGoogleEnv = () => {
	return {
		googleSheetsId: process.env.GOOGLE_SHEETS_ID,
		googleSheetsTab: process.env.GOOGLE_SHEETS_TAB || 'Patients',
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

	// Check OAuth2 credentials first (preferred for organizations without service account keys)
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

	// Fall back to service account
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

const getSheetsClient = () => {
	if (!isGoogleSheetsConfigured()) {
		return null;
	}

	const env = getGoogleEnv();

	// Priority 1: OAuth2 with refresh token (for organizations without service account keys)
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

	// Priority 2: Application Default Credentials
	if (env.googleUseAdc) {
		const auth = new google.auth.GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/spreadsheets'],
		});
		return google.sheets({ version: 'v4', auth });
	}

	// Priority 3: Service Account JWT
	const auth = new google.auth.JWT({
		email: env.googleServiceAccountEmail,
		key: env.googlePrivateKey,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	});

	return google.sheets({ version: 'v4', auth });
};

const patientToRow = (patient: PatientRecord): string[] => {
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
		patient.fibroscan ? JSON.stringify(patient.fibroscan) : '',
		patient.bca ? JSON.stringify(patient.bca) : '',
		patient.video ? JSON.stringify(patient.video) : '',
		patient.retinal ? JSON.stringify(patient.retinal) : '',
		patient.blood ? JSON.stringify(patient.blood) : '',
		patient.createdAt,
		patient.updatedAt,
		patient.syncedAt || '',
	];
};

export const syncPatientToGoogleSheet = async (patient: PatientRecord): Promise<boolean> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) {
		return false;
	}

	const sheets = getSheetsClient();
	if (!sheets) {
		return false;
	}

	try {
		await sheets.spreadsheets.values.append({
			spreadsheetId: env.googleSheetsId,
			range: `${env.googleSheetsTab}!A:S`,
			valueInputOption: 'RAW',
			requestBody: {
				values: [patientToRow(patient)],
			},
		});

		return true;
	} catch (_error) {
		return false;
	}
};

export const syncPendingPatientsToGoogleSheets = async (
	patients: PatientRecord[],
): Promise<{ syncedKeys: string[]; failedKeys: string[] }> => {
	const syncedKeys: string[] = [];
	const failedKeys: string[] = [];

	for (const patient of patients) {
		const synced = await syncPatientToGoogleSheet(patient);
		const key = `${patient.tempId}:${patient.visitDate}`;
		if (synced) {
			syncedKeys.push(key);
		} else {
			failedKeys.push(key);
		}
	}

	return { syncedKeys, failedKeys };
};

const rowToPatient = (row: string[]): PatientRecord | null => {
	if (!row || row.length < 14) {
		return null;
	}

	const age = Number(row[3]);
	if (!row[0] || !row[1] || !row[2] || !Number.isFinite(age)) {
		return null;
	}

	const parseJsonField = <T>(value: string | undefined): T | undefined => {
		if (!value) {
			return undefined;
		}

		try {
			return JSON.parse(value) as T;
		} catch {
			return undefined;
		}
	};

	const hasExtendedDemographics = row.length >= 19;

	if (hasExtendedDemographics) {
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
			fibroscan: parseJsonField(row[11]),
			bca: parseJsonField(row[12]),
			video: parseJsonField(row[13]),
			retinal: parseJsonField(row[14]),
			blood: parseJsonField(row[15]),
			createdAt: row[16] || new Date().toISOString(),
			updatedAt: row[17] || new Date().toISOString(),
			syncedAt: row[18] || undefined,
		};
	}

	return {
		tempId: row[0],
		visitDate: row[1],
		name: row[2],
		age,
		gender: row[4] || '',
		phone: row[5] || '',
		occupation: '',
		education: '',
		religion: '',
		maritalStatus: '',
		familyType: '',
		fibroscan: parseJsonField(row[6]),
		bca: parseJsonField(row[7]),
		video: parseJsonField(row[8]),
		retinal: parseJsonField(row[9]),
		blood: parseJsonField(row[10]),
		createdAt: row[11] || new Date().toISOString(),
		updatedAt: row[12] || new Date().toISOString(),
		syncedAt: row[13] || undefined,
	};
};

export const fetchPatientsFromGoogleSheet = async (): Promise<PatientRecord[]> => {
	const env = getGoogleEnv();
	if (!env.googleSheetsId) {
		return [];
	}

	const sheets = getSheetsClient();
	if (!sheets) {
		return [];
	}

	try {
		const response = await sheets.spreadsheets.values.get({
			spreadsheetId: env.googleSheetsId,
			range: `${env.googleSheetsTab}!A:S`,
		});

		const rows = (response.data.values || []) as string[][];
		const records: PatientRecord[] = [];

		for (const row of rows) {
			const patient = rowToPatient(row);
			if (patient) {
				records.push(patient);
			}
		}

		return records;
	} catch {
		return [];
	}
};
