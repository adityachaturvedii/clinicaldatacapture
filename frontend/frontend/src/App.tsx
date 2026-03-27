import React, { useEffect, useState } from 'react';
import {
  PatientRecord,
  RegisterPatientPayload,
  StationKey,
  StationPayloadMap,
} from './shared-types';
import {
  fetchTodayPatients,
  fetchPatientById,
  registerPatientFromStation,
  StationAuth,
  verifyStationAccess,
  updateStation,
} from './api';
import backgroundImage from './pictures/ILBS.jpg';
import logoImage from './pictures/bg.png';
import './App.css';

type IncomingPatientOption = {
  tempId: string;
  visitDate: string;
  name: string;
};

const StationWrapper = ({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`station-wrapper ${className}`.trim()}>
    <h2 className="section-title">{title}</h2>
    {children}
  </div>
);

const stationMap: Record<number, StationKey | null> = {
  1: null,
  2: 'fibroscan',
  3: 'bca',
  4: 'video',
  5: 'retinal',
  6: 'blood',
};

const stationLabels: Array<{ number: number; key: StationKey; label: string }> = [
  { number: 2, key: 'fibroscan', label: 'Station 2 (Fibroscan)' },
  { number: 3, key: 'bca', label: 'Station 3 (BCA)' },
  { number: 4, key: 'video', label: 'Station 4 (Video)' },
  { number: 5, key: 'retinal', label: 'Station 5 (Retinal)' },
  { number: 6, key: 'blood', label: 'Station 6 (Blood)' },
];

export default function App() {
  const currentYear = new Date().getFullYear();
  const [activeStation, setActiveStation] = useState(1);
  const [stationLocked, setStationLocked] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [searchId, setSearchId] = useState('');
  const [stationOperatorName, setStationOperatorName] = useState('');
  const [stationOperatorId, setStationOperatorId] = useState('');
  const [stationPassword, setStationPassword] = useState('');
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [stationAuthorized, setStationAuthorized] = useState(false);
  const [currentPatient, setCurrentPatient] = useState<PatientRecord | null>(null);
  const [incomingPatients, setIncomingPatients] = useState<IncomingPatientOption[]>([]);
  const [registerForm, setRegisterForm] = useState<RegisterPatientPayload>({
    name: '',
    age: 0,
    gender: '',
    phone: '',
    occupation: '',
    education: '',
    religion: '',
    maritalStatus: '',
    familyType: '',
  });

  const [fibroscanForm, setFibroscanForm] = useState({ lsm: '', cap: '', notes: '' });
  const [bcaForm, setBcaForm] = useState({ result: '', notes: '' });
  const [videoForm, setVideoForm] = useState({ status: '', notes: '' });
  const [retinalForm, setRetinalForm] = useState({ result: '', notes: '' });
  const [bloodForm, setBloodForm] = useState({ sampleCollected: false, notes: '' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stationParam = Number(params.get('station'));

    if (Number.isInteger(stationParam) && stationParam >= 1 && stationParam <= 6) {
      setActiveStation(stationParam);
      setStationLocked(true);
    }
  }, []);

  useEffect(() => {
    const nameKey = `station-operator-name-${activeStation}`;
    const idKey = `station-id-${activeStation}`;
    const passwordKey = `station-password-${activeStation}`;
    const storedOperatorName = window.localStorage.getItem(nameKey) || '';
    const storedOperatorId = window.localStorage.getItem(idKey) || '';
    const storedPassword = window.localStorage.getItem(passwordKey) || '';

    setStationOperatorName(storedOperatorName);
    setStationOperatorId(storedOperatorId);
    setStationPassword(storedPassword);
    setCredentialsSaved(Boolean(storedOperatorName && storedOperatorId && storedPassword));
    setStationAuthorized(false);
    setSearchId('');
    setCurrentPatient(null);
    setIncomingPatients([]);
  }, [activeStation]);

  const getOperatorDisplayName = (): string => {
    const normalizedName = stationOperatorName.trim();
    if (!normalizedName) {
      return 'Operator not set';
    }

    return normalizedName;
  };

  const getStationAuth = (): StationAuth | null => {
    const normalizedOperatorId = stationOperatorId.trim();
    const normalizedPassword = stationPassword.trim();

    if (!normalizedOperatorId || !normalizedPassword) {
      return null;
    }

    return {
      stationNumber: activeStation,
      operatorId: normalizedOperatorId,
      password: normalizedPassword,
    };
  };

  const handleStationLogin = async () => {
    const auth = getStationAuth();
    if (!stationOperatorName.trim()) {
      setStationAuthorized(false);
      setStatus('Operator name is required.');
      return;
    }

    if (!auth) {
      setStationAuthorized(false);
      setStatus('Station ID and password are required.');
      return;
    }

    try {
      await verifyStationAccess(auth);
      setStationAuthorized(true);
      setStatus(`Station ${activeStation} login successful.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid station credentials.';
      setStationAuthorized(false);
      setIncomingPatients([]);
      setCurrentPatient(null);
      setStatus(message);
    }
  };

  const hydratePatientState = (patient: PatientRecord) => {
    setCurrentPatient(patient);
    setFibroscanForm({
      lsm: patient.fibroscan?.lsm?.toString() || '',
      cap: patient.fibroscan?.cap?.toString() || '',
      notes: patient.fibroscan?.notes || '',
    });
    setBcaForm({
      result: patient.bca?.result || '',
      notes: patient.bca?.notes || '',
    });
    setVideoForm({
      status: patient.video?.status || '',
      notes: patient.video?.notes || '',
    });
    setRetinalForm({
      result: patient.retinal?.result || '',
      notes: patient.retinal?.notes || '',
    });
    setBloodForm({
      sampleCollected: patient.blood?.sampleCollected || false,
      notes: patient.blood?.notes || '',
    });
  };

  const refreshTodayPatients = async () => {
    try {
      const auth = getStationAuth();
      if (!stationAuthorized || !auth || auth.stationNumber < 2 || auth.stationNumber > 6) {
        setIncomingPatients([]);
        return;
      }

      const records = await fetchTodayPatients(auth);
      setIncomingPatients(
        records.map((patient) => ({
          tempId: patient.tempId,
          visitDate: patient.visitDate,
          name: patient.name,
        })),
      );
    } catch {
      // Ignore transient refresh failures.
    }
  };

  useEffect(() => {
    void refreshTodayPatients();

    const intervalId = setInterval(() => {
      void refreshTodayPatients();
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeStation, stationOperatorId, stationPassword, stationAuthorized]);

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const auth = getStationAuth();
    if (!stationAuthorized || !auth || auth.stationNumber !== 1) {
      setStatus('Login to Station 1 with valid ID/password first.');
      return;
    }

    try {
      const payload = {
        ...registerForm,
        name: registerForm.name.trim(),
        gender: registerForm.gender.trim(),
        phone: registerForm.phone.trim(),
        occupation: registerForm.occupation.trim(),
        education: registerForm.education.trim(),
        religion: registerForm.religion.trim(),
        maritalStatus: registerForm.maritalStatus.trim(),
        familyType: registerForm.familyType.trim(),
      };
      const patient = await registerPatientFromStation(payload, auth);
      hydratePatientState(patient);
      setSearchId(patient.tempId);
      setStatus(
        `Patient registered. Temp ID: ${patient.tempId}. Stay on Station 1 and use Station 2 URL separately.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed.';
      setStatus(message);
    }
  };

  const submitStationUpdate = async () => {
    if (!currentPatient) {
      setStatus('Load a patient first.');
      return;
    }

    const station = stationMap[activeStation];
    if (!station) {
      setStatus('Station 1 does not use update flow.');
      return;
    }

    const auth = getStationAuth();
    if (!stationAuthorized || !auth) {
      setStatus(`Login to Station ${activeStation} with valid ID/password first.`);
      return;
    }

    let payload: StationPayloadMap[typeof station];

    switch (station) {
      case 'fibroscan':
        payload = {
          lsm: Number(fibroscanForm.lsm),
          cap: Number(fibroscanForm.cap),
          notes: fibroscanForm.notes || undefined,
        };
        break;
      case 'bca':
        payload = { result: bcaForm.result, notes: bcaForm.notes || undefined };
        break;
      case 'video':
        payload = { status: videoForm.status, notes: videoForm.notes || undefined };
        break;
      case 'retinal':
        payload = { result: retinalForm.result, notes: retinalForm.notes || undefined };
        break;
      case 'blood':
        payload = { sampleCollected: bloodForm.sampleCollected, notes: bloodForm.notes || undefined };
        break;
      default:
        setStatus('Unsupported station.');
        return;
    }

    try {
      const updated = await updateStation(currentPatient.tempId, station, payload, auth);
      setCurrentPatient(updated);
      setStatus(`Station ${activeStation} updated successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed.';
      setStatus(message);
    }
  };

  const renderStationForm = () => {
    if (activeStation === 2) {
      return (
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <input
            value={fibroscanForm.lsm}
            onChange={(event) => setFibroscanForm((prev) => ({ ...prev, lsm: event.target.value }))}
            placeholder="LSM"
          />
          <input
            value={fibroscanForm.cap}
            onChange={(event) => setFibroscanForm((prev) => ({ ...prev, cap: event.target.value }))}
            placeholder="CAP"
          />
          <input
            value={fibroscanForm.notes}
            onChange={(event) => setFibroscanForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
          />
        </div>
      );
    }

    if (activeStation === 3) {
      return (
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <input
            value={bcaForm.result}
            onChange={(event) => setBcaForm((prev) => ({ ...prev, result: event.target.value }))}
            placeholder="BCA Result"
          />
          <input
            value={bcaForm.notes}
            onChange={(event) => setBcaForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
          />
        </div>
      );
    }

    if (activeStation === 4) {
      return (
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <input
            value={videoForm.status}
            onChange={(event) => setVideoForm((prev) => ({ ...prev, status: event.target.value }))}
            placeholder="Video Status"
          />
          <input
            value={videoForm.notes}
            onChange={(event) => setVideoForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
          />
        </div>
      );
    }

    if (activeStation === 5) {
      return (
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <input
            value={retinalForm.result}
            onChange={(event) => setRetinalForm((prev) => ({ ...prev, result: event.target.value }))}
            placeholder="Retinal Result"
          />
          <input
            value={retinalForm.notes}
            onChange={(event) => setRetinalForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
          />
        </div>
      );
    }

    if (activeStation === 6) {
      return (
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <label>
            <input
              type="checkbox"
              checked={bloodForm.sampleCollected}
              onChange={(event) =>
                setBloodForm((prev) => ({ ...prev, sampleCollected: event.target.checked }))
              }
            />
            Sample Collected
          </label>
          <input
            value={bloodForm.notes}
            onChange={(event) => setBloodForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Notes"
          />
        </div>
      );
    }

    return null;
  };

  const getStationDone = (patient: PatientRecord, stationKey: StationKey): boolean => {
    return Boolean(patient[stationKey]);
  };

  return (
    <div
      className="app-bg"
      style={{
        backgroundImage: `linear-gradient(rgba(3, 14, 30, 0.68), rgba(3, 14, 30, 0.52)), url(${backgroundImage})`,
      }}
    >
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <div className="app-shell">
        <header className="hero-header">
          <div className="brand-row">
            <img src={logoImage} alt="ILBS Logo" className="brand-logo" />
            <div>
              <h1 className="hero-title">Clinical Multi-Station Workflow</h1>
              <p className="hero-subtitle">Live patient routing, station updates, and progress at a glance</p>
            </div>
          </div>

          <p className="status-badge">{status}</p>
          {stationLocked && (
            <p className="station-lock-message">
              This screen is locked to Station {activeStation} from URL parameter.
            </p>
          )}
        </header>

        <section className="pin-card">
          <div className="pin-row">
            <input
              value={stationOperatorName}
              onChange={(event) => {
                setStationOperatorName(event.target.value);
                setCredentialsSaved(false);
                setStationAuthorized(false);
              }}
              placeholder={`Station ${activeStation} Operator Name`}
              className="field-pin"
            />
            <input
              value={stationOperatorId}
              onChange={(event) => {
                setStationOperatorId(event.target.value);
                setCredentialsSaved(false);
                setStationAuthorized(false);
              }}
              placeholder={`Station ${activeStation} ID`}
              className="field-pin"
            />
            <input
              type="password"
              value={stationPassword}
              onChange={(event) => {
                setStationPassword(event.target.value);
                setCredentialsSaved(false);
                setStationAuthorized(false);
              }}
              placeholder={`Station ${activeStation} Password`}
              className="field-pin"
            />
            <button
              onClick={() => {
                const normalizedOperatorName = stationOperatorName.trim();
                const normalizedOperatorId = stationOperatorId.trim();
                const normalizedPassword = stationPassword.trim();

                if (!normalizedOperatorName || !normalizedOperatorId || !normalizedPassword) {
                  setStatus('Enter operator name, station ID, and password first.');
                  return;
                }

                window.localStorage.setItem(
                  `station-operator-name-${activeStation}`,
                  normalizedOperatorName,
                );
                window.localStorage.setItem(`station-id-${activeStation}`, normalizedOperatorId);
                window.localStorage.setItem(`station-password-${activeStation}`, normalizedPassword);
                setCredentialsSaved(true);
                setStatus(`Station ${activeStation} credentials saved for this browser.`);
              }}
            >
              Save Credentials
            </button>
            <button onClick={() => void handleStationLogin()}>Login Station</button>
            <span className={`pin-state ${credentialsSaved ? 'saved' : 'unsaved'}`}>
              {credentialsSaved ? 'Credentials saved' : 'Credentials not saved'}
            </span>
            <span className={`pin-state ${stationAuthorized ? 'saved' : 'unsaved'}`}>
              {stationAuthorized ? 'Logged in' : 'Not logged in'}
            </span>
          </div>
        </section>

        <nav className="station-nav">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <button
              key={i}
              onClick={() => setActiveStation(i)}
              disabled={stationLocked}
              className={`station-tab ${activeStation === i ? 'active' : ''}`}
            >
              Station {i}
            </button>
          ))}
        </nav>

        {stationAuthorized && (
          <p className="operator-chip">
            Station {activeStation} operator: <strong>{getOperatorDisplayName()}</strong>
          </p>
        )}

        {activeStation === 1 && stationAuthorized && (
          <StationWrapper title="Station 1: Form Filling" className="station-one-wrapper">
            <form onSubmit={handleRegister} className="form-grid registration-form">
              <input
                value={registerForm.name}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Name"
                required
              />
              <input
                type="number"
                value={registerForm.age || ''}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, age: Number(event.target.value) || 0 }))
                }
                placeholder="Age"
                required
              />
              <select
                value={registerForm.gender}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, gender: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select Gender
                </option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
              <input
                type="tel"
                value={registerForm.phone}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder="Phone Number"
                required
              />
              <input
                value={registerForm.occupation}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, occupation: event.target.value }))
                }
                placeholder="Occupation"
                required
              />
              <select
                value={registerForm.education}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, education: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select Education
                </option>
                <option value="No Formal Education">No Formal Education</option>
                <option value="Primary">Primary</option>
                <option value="Secondary">Secondary</option>
                <option value="Higher Secondary">Higher Secondary</option>
                <option value="Graduate">Graduate</option>
                <option value="Postgraduate">Postgraduate</option>
                <option value="Other">Other</option>
              </select>
              <input
                value={registerForm.religion}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, religion: event.target.value }))
                }
                placeholder="Religion"
                required
              />
              <select
                value={registerForm.maritalStatus}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, maritalStatus: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select Marital Status
                </option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Widowed">Widowed</option>
                <option value="Divorced">Divorced</option>
                <option value="Separated">Separated</option>
              </select>
              <select
                value={registerForm.familyType}
                onChange={(event) =>
                  setRegisterForm((prev) => ({ ...prev, familyType: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select Type of Family
                </option>
                <option value="Nuclear">Nuclear</option>
                <option value="Joint">Joint</option>
                <option value="Extended">Extended</option>
                <option value="Other">Other</option>
              </select>
              <button type="submit">Generate ID and Save</button>
            </form>
          </StationWrapper>
        )}

        {activeStation >= 2 && stationAuthorized && (
          <StationWrapper title={`Station ${activeStation}`}>
            <div className="station-layout">
              <div className="sub-card">
                <p className="sub-card-title">Incoming Temp ID</p>
                {incomingPatients.length === 0 && <p className="muted">No records available yet.</p>}
                <select
                  value={searchId}
                  onChange={(event) => {
                    const auth = getStationAuth();
                    if (!stationAuthorized || !auth || auth.stationNumber < 2 || auth.stationNumber > 6) {
                      setStatus('Valid station login is required for patient access.');
                      return;
                    }

                    const selectedId = event.target.value;
                    setSearchId(selectedId);
                    if (!selectedId) {
                      return;
                    }

                    void fetchPatientById(selectedId, auth)
                      .then((patient) => {
                        hydratePatientState(patient);
                        setStatus(`Loaded patient ${selectedId} from dropdown.`);
                      })
                      .catch(() => {
                        setStatus(`Unable to load patient ${selectedId}.`);
                      });
                  }}
                >
                  <option value="">Select Incoming Temp ID</option>
                  {incomingPatients.map((entry) => (
                    <option key={`${entry.tempId}-${entry.visitDate}`} value={entry.tempId}>
                      {entry.tempId} - {entry.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {currentPatient && (
              <div className="patient-card">
                <div className="patient-grid">
                  <p><strong>ID:</strong> {currentPatient.tempId}</p>
                  <p><strong>Name:</strong> {currentPatient.name}</p>
                  <p><strong>Phone:</strong> {currentPatient.phone || '-'}</p>
                  <p><strong>Occupation:</strong> {currentPatient.occupation || '-'}</p>
                  <p><strong>Education:</strong> {currentPatient.education || '-'}</p>
                  <p><strong>Religion:</strong> {currentPatient.religion || '-'}</p>
                  <p><strong>Marital Status:</strong> {currentPatient.maritalStatus || '-'}</p>
                  <p><strong>Type of Family:</strong> {currentPatient.familyType || '-'}</p>
                </div>

                <div className="progress-panel">
                  <p className="sub-card-title">Station Progress</p>
                  {stationLabels.map((station) => {
                    const done = getStationDone(currentPatient, station.key);
                    return (
                      <div key={station.key} className="progress-row">
                        <span>{station.label}</span>
                        <span className={done ? 'done' : 'pending'}>{done ? 'Done' : 'Pending'}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="form-grid station-form">{renderStationForm()}</div>

                <button className="update-btn" style={{ marginTop: '12px' }} onClick={submitStationUpdate}>
                  Update Record
                </button>
              </div>
            )}
          </StationWrapper>
        )}

        {!stationAuthorized && (
          <StationWrapper title={`Station ${activeStation}: Access Required`}>
            <p className="muted">
              Enter operator name, Station {activeStation} ID, and password, then click Login
              Station to open this station.
            </p>
          </StationWrapper>
        )}

        <footer className="app-footer">
          &copy; Md Ashraf, {currentYear}, Institute Of Liver And Billiary Science, New Delhi
        </footer>
      </div>
    </div>
  );
}