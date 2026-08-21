# MDCentralMonitor Architecture

## 1. System Context

```mermaid
graph TD
    subgraph Hospital Wards
        S1[MDSensors 1..N] --> M1[MDMonitor - ICU]
        S2[MDSensors 1..M] --> M2[MDMonitor - Cardiology]
    end

    subgraph MDCentral Wide-Area Web Station (:3000)
        Server[Node.js Express + WebSocket Server]
        Store[(In-Memory Partitioned Buffer: Max 1,000 Sensors)]
        ApprovalEngine[Manual Registration Approval Engine]
        WebUI[Modern Responsive Dashboard]
        HL7Engine[HL7 ORU^R01 Gateway]
    end

    M1 -- "1. POST /api/monitors/register" --> ApprovalEngine
    ApprovalEngine -- "2. Operator Clicks 'Approve'" --> Server
    M1 -- "3. POST /api/telemetry/vitals (Streaming)" --> Store
    M2 -- "3. POST /api/telemetry/vitals (Streaming)" --> Store
    
    Store --> WebUI
    Store --> HL7Engine
```

## 2. Manual Approval Flow

```mermaid
sequenceDiagram
    participant MM as MDMonitor (Qt C++)
    participant MC as MDCentral Server (Node.js)
    participant UI as Web Dashboard Operator

    MM->>MC: POST /api/monitors/register { monitorId, groupName, location }
    MC->>MC: Set status = 'PENDING'
    MC->>UI: Broadcast 'MONITOR_REGISTER_REQUEST'
    UI->>UI: Display Notification Badge & Modal
    
    Note over UI: Operator reviews location & monitor ID
    UI->>MC: POST /api/admin/approve/:monitorId
    MC->>MC: Set status = 'APPROVED'
    MC->>UI: Broadcast 'MONITOR_APPROVED'
    
    MM->>MC: GET /api/monitors/status/:monitorId (or WS sync)
    MC-->>MM: { status: 'APPROVED' }
    
    loop Real-Time Telemetry Streaming
        MM->>MC: POST /api/telemetry/vitals { hr, spo2, sys, dia, alarms }
        MC->>UI: WebSocket Broadcast VITALS_UPDATE
        UI->>UI: Render live metrics & ECG waveforms
    end
```
