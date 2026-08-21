// MDCentralMonitor Client Application
document.addEventListener('DOMContentLoaded', () => {
  let ws = null;
  let monitorsData = [];
  let currentFilter = 'all';
  let searchTerm = '';
  
  // Group Selection State (Set of monitorId strings)
  let selectedGroupIds = new Set();
  let tempSelectedGroupIds = new Set();
  let quickGroupFilter = 'ALL';

  const waveforms = new Map(); // bedKey -> { canvas, ctx, phase, hr }

  // DOM Elements
  const statMonitors = document.getElementById('stat-monitors');
  const statSensors = document.getElementById('stat-sensors');
  const statAlarms = document.getElementById('stat-alarms');
  const alarmBox = document.getElementById('alarm-box');
  const capacityProgress = document.getElementById('capacity-progress');
  const pendingBadge = document.getElementById('pending-badge');
  const groupSelectedBadge = document.getElementById('group-selected-badge');
  const wsStatus = document.getElementById('ws-status');
  const groupsContainer = document.getElementById('groups-container');
  const emptyState = document.getElementById('empty-state');
  const inputSearch = document.getElementById('input-search');
  const selectQuickGroup = document.getElementById('select-quick-group');
  const selectionBanner = document.getElementById('selection-banner');
  const bannerGroupCount = document.getElementById('banner-group-count');
  const btnBannerReset = document.getElementById('btn-banner-reset');

  // Modals
  const modalGroups = document.getElementById('modal-groups');
  const modalPending = document.getElementById('modal-pending');
  const modalSimulator = document.getElementById('modal-simulator');
  const modalPatient = document.getElementById('modal-patient');
  
  const groupCheckboxContainer = document.getElementById('group-checkbox-container');
  const groupsModalSummary = document.getElementById('groups-modal-summary');
  const pendingListContainer = document.getElementById('pending-list-container');
  const patientDetailBody = document.getElementById('patient-detail-body');

  // Load saved group selection from localStorage if present
  try {
    const saved = localStorage.getItem('mdcentral_selected_groups');
    if (saved) {
      selectedGroupIds = new Set(JSON.parse(saved));
    }
  } catch (e) {
    console.error('Failed to load group selection:', e);
  }

  // --- WebSocket Connection ---
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsStatus.innerHTML = '<span class="status-dot online"></span> WebSocket接続中';
      loadAllData();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    ws.onclose = () => {
      wsStatus.innerHTML = '<span class="status-dot offline"></span> 切断 (再接続中...)';
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('WS Error:', err);
      ws.close();
    };
  }

  function handleServerMessage(msg) {
    if (msg.type === 'VITALS_UPDATE') {
      const { monitorId, bedKey, bedState } = msg.data;
      updateSingleBed(monitorId, bedKey, bedState);
      updateGlobalStats();
    } else if (msg.type === 'MONITOR_REGISTER_REQUEST' || msg.type === 'MONITOR_APPROVED' || msg.type === 'MONITOR_REJECTED' || msg.type === 'SIMULATOR_SYNC') {
      loadAllData();
    }
  }

  // --- Data Fetching ---
  async function loadAllData() {
    try {
      const [monitorsRes, statsRes, pendingRes] = await Promise.all([
        fetch('/api/monitors'),
        fetch('/api/stats'),
        fetch('/api/admin/pending')
      ]);

      monitorsData = await monitorsRes.json();
      const stats = await statsRes.json();
      const pending = await pendingRes.json();

      // If selectedGroupIds is empty, default to selecting all approved groups
      const approvedIds = monitorsData.filter(m => m.status === 'APPROVED').map(m => m.monitorId);
      if (selectedGroupIds.size === 0 && approvedIds.length > 0) {
        approvedIds.forEach(id => selectedGroupIds.add(id));
      }

      updateHeaderStats(stats, pending.length);
      updateQuickGroupDropdown();
      updateGroupBadges();
      renderGroups();
      renderPendingList(pending);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }

  function updateHeaderStats(stats, pendingCount) {
    statMonitors.textContent = stats.totalActiveMonitors || 0;
    statSensors.textContent = stats.totalSensors || 0;
    statAlarms.textContent = stats.activeAlarmsCount || 0;
    capacityProgress.style.width = `${stats.capacityPercent || 0}%`;

    if (stats.activeAlarmsCount > 0) {
      alarmBox.classList.add('has-alarm');
    } else {
      alarmBox.classList.remove('has-alarm');
    }

    pendingBadge.textContent = pendingCount;
    pendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }

  function updateGlobalStats() {
    let activeSensors = 0;
    let activeAlarms = 0;
    let approvedMonitors = 0;

    monitorsData.forEach(m => {
      if (m.status === 'APPROVED' && m.beds) {
        approvedMonitors++;
        m.beds.forEach(bed => {
          activeSensors++;
          if (bed.activeAlarms && bed.activeAlarms.length > 0) {
            activeAlarms += bed.activeAlarms.length;
          }
        });
      }
    });

    statMonitors.textContent = approvedMonitors;
    statSensors.textContent = activeSensors;
    statAlarms.textContent = activeAlarms;
    const pct = ((activeSensors / 1000) * 100).toFixed(1);
    capacityProgress.style.width = `${pct}%`;

    if (activeAlarms > 0) {
      alarmBox.classList.add('has-alarm');
    } else {
      alarmBox.classList.remove('has-alarm');
    }
  }

  function updateGroupBadges() {
    const approvedMonitors = monitorsData.filter(m => m.status === 'APPROVED');
    const totalApproved = approvedMonitors.length;
    const selectedCount = approvedMonitors.filter(m => selectedGroupIds.has(m.monitorId)).length;

    if (selectedCount === totalApproved) {
      groupSelectedBadge.textContent = '全表示';
      groupSelectedBadge.style.background = 'rgba(255, 255, 255, 0.2)';
      selectionBanner.style.display = 'none';
    } else {
      groupSelectedBadge.textContent = `${selectedCount}/${totalApproved} 選択中`;
      groupSelectedBadge.style.background = 'var(--primary)';
      selectionBanner.style.display = 'flex';
      bannerGroupCount.textContent = `${selectedCount} / ${totalApproved}`;
    }
  }

  function updateQuickGroupDropdown() {
    const approvedMonitors = monitorsData.filter(m => m.status === 'APPROVED');
    const prevVal = selectQuickGroup.value;

    selectQuickGroup.innerHTML = '<option value="ALL">すべての選択グループ (ALL)</option>';
    approvedMonitors.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.monitorId;
      opt.textContent = `🏥 ${m.groupName} (${m.beds ? m.beds.length : 0}台)`;
      selectQuickGroup.appendChild(opt);
    });

    if ([...selectQuickGroup.options].some(o => o.value === prevVal)) {
      selectQuickGroup.value = prevVal;
    } else {
      selectQuickGroup.value = 'ALL';
      quickGroupFilter = 'ALL';
    }
  }

  // --- Rendering Groups & Patient Cards ---
  function renderGroups() {
    const approvedMonitors = monitorsData.filter(m => m.status === 'APPROVED');
    
    if (approvedMonitors.length === 0) {
      emptyState.style.display = 'block';
      groupsContainer.innerHTML = '';
      groupsContainer.appendChild(emptyState);
      return;
    }

    // Filter by selected groups and quick dropdown
    const visibleMonitors = approvedMonitors.filter(m => {
      const isSelected = selectedGroupIds.has(m.monitorId);
      const matchesQuick = quickGroupFilter === 'ALL' || m.monitorId === quickGroupFilter;
      return isSelected && matchesQuick;
    });

    if (visibleMonitors.length === 0) {
      groupsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>選択されたグループに表示対象がありません</h3>
          <p>「表示グループ選択」ボタンからグループにチェックを入れるか、フィルタ条件を変更してください。</p>
          <button class="btn btn-primary" style="margin-top: 16px;" id="btn-empty-reset">すべてのグループを表示</button>
        </div>
      `;
      document.getElementById('btn-empty-reset')?.addEventListener('click', resetGroupSelection);
      return;
    }

    emptyState.style.display = 'none';
    groupsContainer.innerHTML = '';

    visibleMonitors.forEach(monitor => {
      const beds = monitor.beds || [];
      const filteredBeds = beds.filter(bed => {
        const matchesAlarm = currentFilter !== 'alarm' || (bed.activeAlarms && bed.activeAlarms.length > 0);
        const searchLow = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm || 
          monitor.groupName.toLowerCase().includes(searchLow) ||
          bed.patientName.toLowerCase().includes(searchLow) ||
          bed.bedNumber.toLowerCase().includes(searchLow);
        return matchesAlarm && matchesSearch;
      });

      if (filteredBeds.length === 0 && (searchTerm || currentFilter === 'alarm')) {
        return;
      }

      const groupSection = document.createElement('div');
      groupSection.className = 'group-section';
      groupSection.id = `group-${monitor.monitorId}`;

      groupSection.innerHTML = `
        <div class="group-header">
          <div class="group-title-box">
            <span class="group-name">🏥 ${monitor.groupName}</span>
            <span class="group-badge">${monitor.monitorId}</span>
            <span class="group-location">📍 ${monitor.location}</span>
          </div>
          <div class="group-meta">
            <span class="group-bed-count">MDSensor数: ${filteredBeds.length} 台</span>
          </div>
        </div>
        <div class="group-body">
          <div class="patient-grid" id="grid-${monitor.monitorId}">
          </div>
        </div>
      `;

      const grid = groupSection.querySelector('.patient-grid');
      filteredBeds.forEach(bed => {
        const card = createPatientCard(monitor.monitorId, bed);
        grid.appendChild(card);
      });

      groupsContainer.appendChild(groupSection);
    });

    requestAnimationFrame(renderWaveforms);
  }

  function createPatientCard(monitorId, bed) {
    const card = document.createElement('div');
    const bedKey = `${monitorId}_${bed.socketFd}_${bed.bedNumber}`;
    const inAlarm = bed.activeAlarms && bed.activeAlarms.length > 0;
    
    card.className = `patient-card ${inAlarm ? 'in-alarm' : ''}`;
    card.id = `card-${bedKey}`;
    card.dataset.monitorId = monitorId;
    card.dataset.patientName = bed.patientName;

    const alarmHtml = inAlarm 
      ? bed.activeAlarms.map(a => `<span class="alarm-tag">${a}</span>`).join('') 
      : '';

    card.innerHTML = `
      <div class="card-header">
        <span class="patient-bed">${bed.bedNumber}</span>
        <span class="patient-name">${bed.patientName}</span>
      </div>
      <div class="vitals-grid">
        <div class="vital-metric hr">
          <span class="metric-name">HR (bpm)</span>
          <span class="metric-val val-hr">${Math.round(bed.hr) || '--'}</span>
        </div>
        <div class="vital-metric spo2">
          <span class="metric-name">SpO2 (%)</span>
          <span class="metric-val val-spo2">${Math.round(bed.spo2) || '--'}</span>
        </div>
        <div class="vital-metric bp">
          <span class="metric-name">BP (mmHg)</span>
          <span class="metric-val val-bp">${Math.round(bed.sys)}/${Math.round(bed.dia)}</span>
        </div>
      </div>
      <canvas class="waveform-canvas" id="canvas-${bedKey}" width="280" height="38"></canvas>
      <div class="alarm-tags">${alarmHtml}</div>
    `;

    card.addEventListener('click', () => openPatientModal(monitorId, bed));

    setTimeout(() => {
      const canvas = document.getElementById(`canvas-${bedKey}`);
      if (canvas) {
        waveforms.set(bedKey, {
          canvas,
          ctx: canvas.getContext('2d'),
          phase: Math.random() * 100,
          hr: bed.hr || 75
        });
      }
    }, 0);

    return card;
  }

  function updateSingleBed(monitorId, bedKey, bedState) {
    const monitor = monitorsData.find(m => m.monitorId === monitorId);
    if (!monitor) return;

    if (!monitor.beds) monitor.beds = [];
    const idx = monitor.beds.findIndex(b => b.socketFd === bedState.socketFd && b.bedNumber === bedState.bedNumber);
    if (idx >= 0) {
      monitor.beds[idx] = bedState;
    } else {
      monitor.beds.push(bedState);
    }

    const fullBedKey = `${monitorId}_${bedState.socketFd}_${bedState.bedNumber}`;
    const card = document.getElementById(`card-${fullBedKey}`);
    if (card) {
      const hrVal = card.querySelector('.val-hr');
      const spo2Val = card.querySelector('.val-spo2');
      const bpVal = card.querySelector('.val-bp');
      const alarmTags = card.querySelector('.alarm-tags');

      if (hrVal) hrVal.textContent = Math.round(bedState.hr);
      if (spo2Val) spo2Val.textContent = Math.round(bedState.spo2);
      if (bpVal) bpVal.textContent = `${Math.round(bedState.sys)}/${Math.round(bedState.dia)}`;

      const inAlarm = bedState.activeAlarms && bedState.activeAlarms.length > 0;
      if (inAlarm) {
        card.classList.add('in-alarm');
        alarmTags.innerHTML = bedState.activeAlarms.map(a => `<span class="alarm-tag">${a}</span>`).join('');
      } else {
        card.classList.remove('in-alarm');
        alarmTags.innerHTML = '';
      }

      const wave = waveforms.get(fullBedKey);
      if (wave) wave.hr = bedState.hr;
    } else {
      renderGroups();
    }
  }

  // --- Real-time ECG Waveform Animation ---
  function renderWaveforms() {
    waveforms.forEach((wave) => {
      const { canvas, ctx } = wave;
      if (!canvas || !ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      wave.phase += (wave.hr / 60) * 0.8;
      if (wave.phase > 100) wave.phase = 0;

      for (let x = 0; x < w; x++) {
        const relX = (x + wave.phase * 2) % 60;
        let y = midY;

        if (relX > 20 && relX < 24) y -= 3; // P
        else if (relX >= 24 && relX < 26) y += 2; // Q
        else if (relX >= 26 && relX < 30) y -= 14; // R peak
        else if (relX >= 30 && relX < 33) y += 6; // S
        else if (relX >= 37 && relX < 45) y -= 4; // T

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    requestAnimationFrame(renderWaveforms);
  }

  // --- Group Selection Modal Logic ---
  function openGroupSelectorModal() {
    const approvedMonitors = monitorsData.filter(m => m.status === 'APPROVED');
    tempSelectedGroupIds = new Set(selectedGroupIds);

    renderGroupCheckboxGrid(approvedMonitors);
    updateModalSummary(approvedMonitors.length);
    modalGroups.style.display = 'flex';
  }

  function renderGroupCheckboxGrid(monitors) {
    if (monitors.length === 0) {
      groupCheckboxContainer.innerHTML = '<p class="modal-description">承認済みの MDMonitor グループはまだありません。</p>';
      return;
    }

    groupCheckboxContainer.innerHTML = monitors.map(m => {
      const isChecked = tempSelectedGroupIds.has(m.monitorId);
      const bedCount = m.beds ? m.beds.length : 0;
      let alarms = 0;
      if (m.beds) {
        m.beds.forEach(b => { if (b.activeAlarms && b.activeAlarms.length > 0) alarms += b.activeAlarms.length; });
      }

      return `
        <div class="group-check-card ${isChecked ? 'checked' : ''}" data-id="${m.monitorId}">
          <input type="checkbox" id="chk-${m.monitorId}" ${isChecked ? 'checked' : ''}>
          <div class="group-check-info">
            <span class="group-check-title">🏥 ${m.groupName}</span>
            <span class="group-check-meta">ID: ${m.monitorId} | 📍 ${m.location}</span>
            <div class="group-check-stats">
              <span class="group-check-pill">${bedCount} 台</span>
              ${alarms > 0 ? `<span class="alarm-tag">${alarms} アラーム</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    groupCheckboxContainer.querySelectorAll('.group-check-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const id = card.dataset.id;
        const chk = card.querySelector('input[type="checkbox"]');
        if (e.target !== chk) {
          chk.checked = !chk.checked;
        }
        if (chk.checked) {
          tempSelectedGroupIds.add(id);
          card.classList.add('checked');
        } else {
          tempSelectedGroupIds.delete(id);
          card.classList.remove('checked');
        }
        updateModalSummary(monitors.length);
      });
    });
  }

  function updateModalSummary(total) {
    groupsModalSummary.textContent = `選択中: ${tempSelectedGroupIds.size} / ${total} グループ`;
  }

  function applyGroupSelection() {
    selectedGroupIds = new Set(tempSelectedGroupIds);
    try {
      localStorage.setItem('mdcentral_selected_groups', JSON.stringify([...selectedGroupIds]));
    } catch (e) {}

    updateGroupBadges();
    renderGroups();
    modalGroups.style.display = 'none';
  }

  function resetGroupSelection() {
    const approvedMonitors = monitorsData.filter(m => m.status === 'APPROVED');
    selectedGroupIds = new Set(approvedMonitors.map(m => m.monitorId));
    quickGroupFilter = 'ALL';
    selectQuickGroup.value = 'ALL';
    try {
      localStorage.setItem('mdcentral_selected_groups', JSON.stringify([...selectedGroupIds]));
    } catch (e) {}
    updateGroupBadges();
    renderGroups();
  }

  // --- Manual Approval Management ---
  function renderPendingList(pending) {
    if (!pendingListContainer) return;
    
    if (pending.length === 0) {
      pendingListContainer.innerHTML = '<p class="modal-description">現在、承認待ちの MDMonitor リクエストはありません。</p>';
      return;
    }

    pendingListContainer.innerHTML = pending.map(m => `
      <div class="pending-card">
        <div class="pending-info">
          <h4>🏥 ${m.groupName} (${m.monitorId})</h4>
          <p>📍 設置場所: ${m.location} | IP: ${m.ip} | 要求時刻: ${new Date(m.registeredAt).toLocaleTimeString()}</p>
        </div>
        <div class="pending-actions">
          <button class="btn btn-success btn-approve" data-id="${m.monitorId}">✓ 承認</button>
          <button class="btn btn-danger btn-reject" data-id="${m.monitorId}">✗ 拒否</button>
        </div>
      </div>
    `).join('');

    pendingListContainer.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        try {
          await fetch(`/api/admin/approve/${id}`, { method: 'POST' });
          selectedGroupIds.add(id);
          loadAllData();
        } catch (err) {
          console.error(err);
        }
      });
    });

    pendingListContainer.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        try {
          await fetch(`/api/admin/reject/${id}`, { method: 'POST' });
          selectedGroupIds.delete(id);
          loadAllData();
        } catch (err) {
          console.error(err);
        }
      });
    });
  }

  // --- Patient Detail & HL7 Modal ---
  async function openPatientModal(monitorId, bed) {
    try {
      const hl7Res = await fetch(`/api/ehr/oru/${encodeURIComponent(bed.patientName)}?duration=300`);
      const hl7Text = await hl7Res.text();

      patientDetailBody.innerHTML = `
        <div class="patient-summary">
          <h3>患者名: ${bed.patientName} (ベッド: ${bed.bedNumber})</h3>
          <p>所属MDMonitor: ${monitorId} | 現在値: HR ${Math.round(bed.hr)} bpm, SpO2 ${Math.round(bed.spo2)}%, BP ${Math.round(bed.sys)}/${Math.round(bed.dia)} mmHg</p>
        </div>
        <div>
          <h4>EHR HL7 ORU^R01 観察メッセージ出力 (Port 8081 互換)</h4>
          <pre class="hl7-preview">${hl7Text}</pre>
        </div>
      `;
      modalPatient.style.display = 'flex';
    } catch (err) {
      console.error(err);
    }
  }

  // --- Event Listeners ---
  document.getElementById('btn-group-modal').addEventListener('click', openGroupSelectorModal);

  document.getElementById('btn-groups-select-all').addEventListener('click', () => {
    monitorsData.filter(m => m.status === 'APPROVED').forEach(m => tempSelectedGroupIds.add(m.monitorId));
    renderGroupCheckboxGrid(monitorsData.filter(m => m.status === 'APPROVED'));
    updateModalSummary(monitorsData.filter(m => m.status === 'APPROVED').length);
  });

  document.getElementById('btn-groups-deselect-all').addEventListener('click', () => {
    tempSelectedGroupIds.clear();
    renderGroupCheckboxGrid(monitorsData.filter(m => m.status === 'APPROVED'));
    updateModalSummary(monitorsData.filter(m => m.status === 'APPROVED').length);
  });

  document.getElementById('btn-groups-apply').addEventListener('click', applyGroupSelection);
  btnBannerReset.addEventListener('click', resetGroupSelection);

  selectQuickGroup.addEventListener('change', (e) => {
    quickGroupFilter = e.target.value;
    renderGroups();
  });

  document.getElementById('btn-pending-modal').addEventListener('click', () => {
    modalPending.style.display = 'flex';
    loadAllData();
  });

  document.getElementById('btn-sim-modal').addEventListener('click', () => {
    modalSimulator.style.display = 'flex';
  });

  document.getElementById('btn-refresh').addEventListener('click', loadAllData);

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = e.target.dataset.close;
      document.getElementById(modalId).style.display = 'none';
    });
  });

  // Simulator actions
  document.getElementById('btn-sim-run').addEventListener('click', async () => {
    const monitors = document.getElementById('sim-monitors').value;
    const sensorsPerMonitor = document.getElementById('sim-sensors').value;
    
    await fetch('/api/simulator/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monitors, sensorsPerMonitor })
    });
    modalSimulator.style.display = 'none';
    loadAllData();
  });

  document.getElementById('btn-sim-clear').addEventListener('click', async () => {
    await fetch('/api/simulator/clear', { method: 'POST' });
    selectedGroupIds.clear();
    modalSimulator.style.display = 'none';
    loadAllData();
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderGroups();
    });
  });

  inputSearch.addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderGroups();
  });

  // Initialize
  connectWebSocket();
  setInterval(loadAllData, 10000);
});
