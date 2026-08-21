const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const _ = require('lodash');
const moment = require('moment');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const MAX_SENSORS_CAPACITY = 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data Models ---
// monitors: monitorId -> { monitorId, groupName, location, ip, port, status, registeredAt, approvedAt, lastSeen, beds: Map<bedKey, BedState> }
const monitors = new Map();
// vitalsHistory: Array<{ monitorId, patientName, bedNumber, hr, spo2, sys, dia, timestamp }>
const vitalsHistory = [];
// eventsHistory: Array<{ monitorId, patientName, bedNumber, level, message, timestamp }>
const eventsHistory = [];

// Helper: Broadcast to all connected dashboard WebSockets
function broadcast(eventType, payload) {
    const message = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Calculate total active MDSensors
function getTotalActiveSensors() {
    let total = 0;
    for (const monitor of monitors.values()) {
        if (monitor.status === 'APPROVED' && monitor.beds) {
            total += monitor.beds.size;
        }
    }
    return total;
}

// Clean old historical data (> 1 hour)
setInterval(() => {
    const oneHourAgo = Date.now() - 3600 * 1000;
    while (vitalsHistory.length > 0 && vitalsHistory[0].timestamp < oneHourAgo) {
        vitalsHistory.shift();
    }
    while (eventsHistory.length > 0 && eventsHistory[0].timestamp < oneHourAgo) {
        eventsHistory.shift();
    }
}, 30000);

// --- REST API Endpoints ---

// 1. MDMonitor Registration Endpoint
app.post('/api/monitors/register', (req, res) => {
    const { monitorId, groupName, location, ip, port } = req.body;
    if (!monitorId) {
        return res.status(400).json({ error: 'monitorId is required' });
    }

    const existing = monitors.get(monitorId);
    if (existing && existing.status === 'APPROVED') {
        existing.lastSeen = Date.now();
        existing.groupName = groupName || existing.groupName;
        existing.location = location || existing.location;
        return res.json({ status: 'APPROVED', message: 'Already approved' });
    }

    const monitorData = {
        monitorId,
        groupName: groupName || `Group-${monitorId}`,
        location: location || 'General Ward',
        ip: ip || req.ip,
        port: port || 8080,
        status: existing ? existing.status : 'PENDING',
        registeredAt: existing ? existing.registeredAt : moment().toISOString(),
        approvedAt: existing ? existing.approvedAt : null,
        lastSeen: Date.now(),
        beds: existing ? existing.beds : new Map()
    };

    monitors.set(monitorId, monitorData);
    broadcast('MONITOR_REGISTER_REQUEST', {
        monitorId,
        groupName: monitorData.groupName,
        location: monitorData.location,
        status: monitorData.status,
        registeredAt: monitorData.registeredAt
    });

    console.log(`[MDCentral] Registration request from monitor '${monitorId}' (${monitorData.groupName}) - Status: ${monitorData.status}`);
    res.json({ status: monitorData.status, message: 'Registration request submitted. Awaiting manual approval.' });
});

// 2. Query Monitor Status (used by MDMonitor client polling)
app.get('/api/monitors/status/:monitorId', (req, res) => {
    const monitor = monitors.get(req.params.monitorId);
    if (!monitor) {
        return res.status(404).json({ status: 'UNREGISTERED' });
    }
    monitor.lastSeen = Date.now();
    res.json({ status: monitor.status, groupName: monitor.groupName });
});

// 3. List All Monitors & Groups
app.get('/api/monitors', (req, res) => {
    const list = [];
    monitors.forEach(m => {
        const bedsList = [];
        if (m.beds) {
            m.beds.forEach((bed, key) => {
                bedsList.push({
                    key,
                    socketFd: bed.socketFd,
                    patientName: bed.patientName,
                    bedNumber: bed.bedNumber,
                    hr: bed.hr,
                    spo2: bed.spo2,
                    sys: bed.sys,
                    dia: bed.dia,
                    activeAlarms: bed.activeAlarms || [],
                    lastUpdate: bed.lastUpdate
                });
            });
        }
        list.push({
            monitorId: m.monitorId,
            groupName: m.groupName,
            location: m.location,
            ip: m.ip,
            port: m.port,
            status: m.status,
            registeredAt: m.registeredAt,
            approvedAt: m.approvedAt,
            lastSeen: m.lastSeen,
            sensorCount: bedsList.length,
            beds: bedsList
        });
    });
    res.json(list);
});

// 4. Admin: Get Pending Approvals
app.get('/api/admin/pending', (req, res) => {
    const pending = [];
    monitors.forEach(m => {
        if (m.status === 'PENDING') {
            pending.push({
                monitorId: m.monitorId,
                groupName: m.groupName,
                location: m.location,
                registeredAt: m.registeredAt,
                ip: m.ip
            });
        }
    });
    res.json(pending);
});

// 5. Admin: Approve Registration (Manual Button Click in UI)
app.post('/api/admin/approve/:monitorId', (req, res) => {
    const monitor = monitors.get(req.params.monitorId);
    if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
    }
    monitor.status = 'APPROVED';
    monitor.approvedAt = moment().toISOString();
    monitor.lastSeen = Date.now();

    console.log(`[MDCentral] Operator APPROVED monitor '${monitor.monitorId}' (${monitor.groupName})`);
    broadcast('MONITOR_APPROVED', {
        monitorId: monitor.monitorId,
        groupName: monitor.groupName,
        approvedAt: monitor.approvedAt
    });

    res.json({ success: true, status: 'APPROVED', monitorId: monitor.monitorId });
});

// 6. Admin: Reject Registration
app.post('/api/admin/reject/:monitorId', (req, res) => {
    const monitor = monitors.get(req.params.monitorId);
    if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
    }
    monitor.status = 'REJECTED';
    console.log(`[MDCentral] Operator REJECTED monitor '${monitor.monitorId}'`);
    broadcast('MONITOR_REJECTED', { monitorId: monitor.monitorId });
    res.json({ success: true, status: 'REJECTED', monitorId: monitor.monitorId });
});

// 7. Admin: Delete Monitor
app.delete('/api/admin/monitors/:monitorId', (req, res) => {
    monitors.delete(req.params.monitorId);
    broadcast('MONITOR_DELETED', { monitorId: req.params.monitorId });
    res.json({ success: true });
});

// 8. Telemetry Ingestion: Vitals Update
app.post('/api/telemetry/vitals', (req, res) => {
    const { monitorId, socketFd, patientName, bedNumber, hr, spo2, sys, dia, alarms } = req.body;
    const monitor = monitors.get(monitorId);

    if (!monitor || monitor.status !== 'APPROVED') {
        return res.status(403).json({ error: 'Monitor is not registered or not yet approved.' });
    }

    monitor.lastSeen = Date.now();
    const bedKey = `${socketFd || 0}_${bedNumber || 'N/A'}`;
    const bedState = {
        socketFd: socketFd || 0,
        patientName: patientName || 'Unadmitted',
        bedNumber: bedNumber || 'N/A',
        hr: Number(hr) || 0,
        spo2: Number(spo2) || 0,
        sys: Number(sys) || 0,
        dia: Number(dia) || 0,
        activeAlarms: Array.isArray(alarms) ? alarms : [],
        lastUpdate: Date.now()
    };

    monitor.beds.set(bedKey, bedState);

    // Save to historical buffer
    vitalsHistory.push({
        monitorId,
        patientName: bedState.patientName,
        bedNumber: bedState.bedNumber,
        hr: bedState.hr,
        spo2: bedState.spo2,
        sys: bedState.sys,
        dia: bedState.dia,
        timestamp: Date.now()
    });

    broadcast('VITALS_UPDATE', {
        monitorId,
        groupName: monitor.groupName,
        bedKey,
        bedState
    });

    res.json({ success: true });
});

// 9. Telemetry Ingestion: Event / Alarm Log
app.post('/api/telemetry/events', (req, res) => {
    const { monitorId, patientName, bedNumber, level, message } = req.body;
    const monitor = monitors.get(monitorId);
    if (!monitor || monitor.status !== 'APPROVED') {
        return res.status(403).json({ error: 'Monitor not approved' });
    }

    const eventRecord = {
        monitorId,
        groupName: monitor.groupName,
        patientName: patientName || 'All',
        bedNumber: bedNumber || 'N/A',
        level: level || 'INFO',
        message: message || '',
        timestamp: Date.now(),
        timeStr: moment().format('YYYY-MM-DD HH:mm:ss')
    };

    eventsHistory.push(eventRecord);
    broadcast('EVENT_LOGGED', eventRecord);
    res.json({ success: true });
});

// 10. Telemetry Ingestion: Patient Disconnect
app.post('/api/telemetry/disconnect', (req, res) => {
    const { monitorId, socketFd, bedNumber } = req.body;
    const monitor = monitors.get(monitorId);
    if (monitor && monitor.beds) {
        const bedKey = `${socketFd || 0}_${bedNumber || 'N/A'}`;
        monitor.beds.delete(bedKey);
        broadcast('BED_DISCONNECTED', { monitorId, bedKey });
    }
    res.json({ success: true });
});

// 11. System Statistics
app.get('/api/stats', (req, res) => {
    let approvedMonitors = 0;
    let pendingMonitors = 0;
    let totalSensors = 0;
    let activeAlarmsCount = 0;

    monitors.forEach(m => {
        if (m.status === 'APPROVED') {
            approvedMonitors++;
            if (m.beds) {
                totalSensors += m.beds.size;
                m.beds.forEach(bed => {
                    if (bed.activeAlarms && bed.activeAlarms.length > 0) {
                        activeAlarmsCount += bed.activeAlarms.length;
                    }
                });
            }
        } else if (m.status === 'PENDING') {
            pendingMonitors++;
        }
    });

    res.json({
        totalActiveMonitors: approvedMonitors,
        pendingApprovals: pendingMonitors,
        totalSensors,
        maxCapacity: MAX_SENSORS_CAPACITY,
        capacityPercent: ((totalSensors / MAX_SENSORS_CAPACITY) * 100).toFixed(1),
        activeAlarmsCount
    });
});

// 12. Patient History & HL7 ORU^R01 Endpoint
app.get('/api/ehr/oru/:patientName', (req, res) => {
    const patientName = req.params.patientName;
    const duration = parseInt(req.query.duration || '60', 10);
    const since = Date.now() - duration * 1000;

    const patientRecords = vitalsHistory.filter(v => v.patientName === patientName && v.timestamp >= since);
    const nowStr = moment().format('YYYYMMDDHHmmss');

    let hl7 = `MSH|^~\\&|MDCentralMonitor||EHR||${nowStr}||ORU^R01^ORU_R01|MSG${nowStr}|P|2.5\r`;
    hl7 += `PID|1||PID12345||${patientName}|||||||||||||\r`;
    hl7 += `PV1|1|I|MDCentral^WideArea|||||||||||||||||\r`;

    if (patientRecords.length === 0) {
        hl7 += `ERR|1|||E|^No data found for the requested period\r`;
    } else {
        patientRecords.slice(-10).forEach((rec, idx) => {
            const obxTime = moment(rec.timestamp).format('YYYYMMDDHHmmss');
            hl7 += `OBR|${idx + 1}|ORD${idx + 1}||883-9^VITAL SIGNS^LN|||${obxTime}\r`;
            hl7 += `OBX|1|NM|8867-4^HEART RATE^LN||${rec.hr.toFixed(1)}|/min|60-100|N|||F|||${obxTime}\r`;
            hl7 += `OBX|2|NM|2708-6^SpO2^LN||${rec.spo2.toFixed(1)}|%|95-100|N|||F|||${obxTime}\r`;
            hl7 += `OBX|3|NM|8480-6^BP SYSTOLIC^LN||${rec.sys.toFixed(1)}|mmHg|90-140|N|||F|||${obxTime}\r`;
            hl7 += `OBX|4|NM|8462-4^BP DIASTOLIC^LN||${rec.dia.toFixed(1)}|mmHg|60-90|N|||F|||${obxTime}\r`;
        });
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(hl7);
});

// 13. Test Scale Simulator Endpoint (generate N mock monitors and M sensors)
app.post('/api/simulator/generate', (req, res) => {
    const monitorCount = parseInt(req.body.monitors || '10', 10);
    const sensorsPerMonitor = parseInt(req.body.sensorsPerMonitor || '50', 10);

    for (let i = 1; i <= monitorCount; i++) {
        const mId = `Sim-MDMonitor-Ward${i}`;
        const groupName = `Ward ${i} (${['ICU', 'Cardiology', 'Pulmonology', 'General', 'Neurology'][i % 5]})`;
        
        let mon = monitors.get(mId);
        if (!mon) {
            mon = {
                monitorId: mId,
                groupName,
                location: `Building ${String.fromCharCode(65 + (i % 4))} - Floor ${(i % 6) + 1}`,
                ip: `192.168.1.${100 + i}`,
                port: 8080,
                status: 'APPROVED',
                registeredAt: moment().toISOString(),
                approvedAt: moment().toISOString(),
                lastSeen: Date.now(),
                beds: new Map()
            };
            monitors.set(mId, mon);
        }

        for (let j = 1; j <= sensorsPerMonitor; j++) {
            const socketFd = (i * 1000) + j;
            const bedNumber = `Bed-${i}0${j}`;
            const patientName = `Patient_${i}_${j}`;
            const hr = 60 + Math.floor(Math.random() * 40);
            const spo2 = 94 + Math.floor(Math.random() * 6);
            const sys = 110 + Math.floor(Math.random() * 30);
            const dia = 70 + Math.floor(Math.random() * 20);

            const alarms = [];
            if (hr > 95) alarms.push('HIGH_HR');
            if (spo2 < 95) alarms.push('LOW_SPO2');

            mon.beds.set(`${socketFd}_${bedNumber}`, {
                socketFd,
                patientName,
                bedNumber,
                hr,
                spo2,
                sys,
                dia,
                activeAlarms: alarms,
                lastUpdate: Date.now()
            });
        }
    }

    broadcast('SIMULATOR_SYNC', { count: getTotalActiveSensors() });
    res.json({ success: true, totalActiveSensors: getTotalActiveSensors() });
});

app.post('/api/simulator/clear', (req, res) => {
    monitors.clear();
    vitalsHistory.length = 0;
    eventsHistory.length = 0;
    broadcast('SIMULATOR_SYNC', { count: 0 });
    res.json({ success: true });
});

// --- WebSocket Handling ---
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        timestamp: new Date().toISOString(),
        stats: {
            totalSensors: getTotalActiveSensors(),
            maxCapacity: MAX_SENSORS_CAPACITY
        }
    }));
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  MDCentralMonitor Web Application Running on Port ${PORT}`);
    console.log(`  Dashboard URL:  http://localhost:${PORT}`);
    console.log(`  Capacity:       Up to ${MAX_SENSORS_CAPACITY} MDSensors across MDMonitor Groups`);
    console.log(`=======================================================`);
});
