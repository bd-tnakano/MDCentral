# MDCentralMonitor - Wide-Area Central Telemetry Web Monitor

## Overview
**MDCentralMonitor** is a web-based, wide-area central clinical monitoring system built with **Node.js and JavaScript**. It aggregates real-time vital sign telemetry from multiple **`MDMonitor`** instances (1 MDMonitor per group / ward), scaling up to **1,000 active `MDSensor` devices**.

---

## Features

- **Wide-Area Scale**: Architected to ingest and render telemetry for up to **1,000 MDSensors** across hospital departments.
- **Grouped Ward Management**: Groups are organized by MDMonitor (e.g. ICU Ward 1, Cardiology 3F, Emergency Dept) with live status summaries.
- **Manual Registration Approval**:
  - `MDMonitor` submits a registration request to `MDCentral`.
  - `MDCentral` places the monitor in a `PENDING` queue.
  - Operators manually review and click **"Approve"** in the web UI before telemetry ingestion begins.
- **Real-Time Web Dashboard**:
  - Live vital signs indicators (HR, SpO2, Blood Pressure Sys/Dia).
  - Real-time ECG Canvas waveform animations.
  - Visual high-contrast alert cues with active alarm counters.
- **EHR & HL7 Gateway**:
  - Exposes `/api/ehr/oru/:patientName` to generate standard HL7 ORU^R01 observation messages compatible with hospital EHR systems.
- **1,000-Sensor Scale Simulator**:
  - Built-in load testing tool to spawn mock MDMonitors and scale up to 1,000 MDSensors with realistic vitals.

---

## Build & Run

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
./build.sh
```

### Running
```bash
./run.sh
```
Access the dashboard in your web browser:
**`http://localhost:3000`**

---

## API Endpoints

- `POST /api/monitors/register` - Register a new MDMonitor instance (enters `PENDING` state).
- `GET /api/monitors/status/:monitorId` - Check approval status (`PENDING`, `APPROVED`, `REJECTED`).
- `GET /api/admin/pending` - List pending registration requests.
- `POST /api/admin/approve/:monitorId` - Manually approve monitor registration.
- `POST /api/admin/reject/:monitorId` - Manually reject monitor registration.
- `POST /api/telemetry/vitals` - Ingest real-time vital signs from approved MDMonitors.
- `POST /api/telemetry/events` - Ingest event and alarm logs.
- `GET /api/ehr/oru/:patientName` - Export patient observations in HL7 ORU^R01 format.
