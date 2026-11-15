import { icon } from './icons.js';
import { escapeHtml as e, VITALS, timeAgo, filterPatients } from './helpers.js';
import * as views from './views.js';
import { drawer, patientForm, readingForm, dischargeForm, chartData } from './detail.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const main = $('#main-content');
const drawerElement = $('#patient-drawer');
const modal = $('#modal');
const validViews = new Set(Object.keys(views.labels));
const defaults = { theme: 'light', autoRefresh: true, sound: false, patientView: 'grid' };

function readPreferences() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('mediwatch.preferences') || '{}') };
  } catch {
    return { ...defaults };
  }
}

const preferences = readPreferences();
const state = {
  patients: [],
  alerts: [],
  config: {},
  summary: {},
  preferences,
  view: validViews.has(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  query: '',
  statusFilter: '',
  wardFilter: '',
  sort: 'priority',
  patientView: preferences.patientView,
  chartMetric: 'heart_rate',
  alertFilter: 'open',
  alertSeverity: '',
  bannerDismissed: false,
  selectedId: null,
  selectedPatient: null,
  drawerTab: 'overview',
  drawerMetric: 'heart_rate',
  drawerSummary: null,
  summaryLoading: false,
  notes: [],
  notesLoading: false,
  token: '',
  authorized: true,
  loaded: false,
  lastSync: null,
};

let inFlight = null;
let queuedSync = null;
let sessionGeneration = 0;
let refreshTimer;
let lastFocus;
let lastCriticalIds = new Set();
let audioContext;
let drawerRequest = 0;

function savePreferences() {
  try {
    localStorage.setItem('mediwatch.preferences', JSON.stringify(state.preferences));
  } catch {
    /* Preferences remain usable in memory. */
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.preferences.theme === 'dark' ? 'dark' : 'light';
  const dark = state.preferences.theme === 'dark';
  $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  $('meta[name="theme-color"]').content = dark ? '#10232d' : '#102d3a';
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.innerHTML = `${icon(type === 'error' ? 'alert' : 'checkCircle')}<span>${e(message)}</span><button class="icon-button" aria-label="Dismiss notification">${icon('close')}</button>`;
  $('button', item).addEventListener('click', () => item.remove());
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), type === 'error' ? 8000 : 5000);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, timeout = 15000, raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      let message = `The request could not be completed (${response.status}).`;
      try {
        const error = await response.json();
        message =
          typeof error.detail === 'string'
            ? error.detail
            : Array.isArray(error.detail)
              ? error.detail
                  .map((issue) => `${issue.loc?.slice(1).join(' ') || 'Input'}: ${issue.msg}`)
                  .join('. ')
              : message;
      } catch {
        /* Keep the safe default for non-JSON errors. */
      }
      throw new ApiError(message, response.status);
    }
    return raw ? response : await response.json();
  } catch (error) {
    if (error.name === 'AbortError')
      throw new Error('The server took too long to respond. Please try again.');
    if (error instanceof TypeError)
      throw new Error('Cannot reach the server. Check the connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function openAlerts() {
  return state.alerts.filter((alert) => alert.active !== false && !alert.acknowledged);
}

function setConnection(connected) {
  const badge = $('#connection-badge');
  badge.classList.toggle('disconnected', !connected);
  $('#connection-label').textContent = connected
    ? state.preferences.autoRefresh
      ? 'Connected'
      : 'Refresh paused'
    : 'Connection interrupted';
}

function updateChrome() {
  $('#nav-patient-count').textContent = state.patients.length;
  $('#nav-alert-count').textContent = openAlerts().length;
  $('#nav-alert-count').hidden = openAlerts().length === 0;
  $('#notification-dot').hidden = !openAlerts().some((alert) => alert.severity === 'critical');
  $('#last-synced').textContent = state.lastSync
    ? `Last synced ${new Date(state.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'Waiting for first sync';
  $('#breadcrumb-current').textContent = views.labels[state.view];
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (!state.config.demo_mode) {
    $('#workspace-name').textContent = 'Protected workspace';
    $('#workspace-caption').textContent = 'Access is limited to this authenticated session.';
    $('#workspace-badge').innerHTML = `${icon('lock')} Token protected`;
    $('#operator-role').textContent = 'Protected session';
  }
  document.title = `${views.labels[state.view]} · MediWatch`;
}

function render() {
  const focused = document.activeElement;
  const focusData = focused?.dataset?.action ? { ...focused.dataset } : null;
  updateChrome();
  if (!state.authorized) {
    main.innerHTML = views.lockedView();
    return;
  }
  if (!state.loaded) return;
  main.innerHTML = views[state.view](state);
  if (focusData && focused && main.contains(focused) === false) {
    const match = $$('[data-action]', main).find((element) =>
      Object.entries(focusData).every(([key, value]) => element.dataset[key] === value),
    );
    match?.focus({ preventScroll: true });
  }
}

function safeToRender() {
  return !modal.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
}

function renderPatientArea() {
  const target = $('#patient-area');
  if (target) target.innerHTML = views.patientArea(state, state.view === 'overview' ? 6 : null);
  const count = $('#results-count');
  if (count)
    count.textContent = `Showing ${filterPatients(state).length} of ${state.patients.length} active patients`;
}

function setView(view, focus = true) {
  if (!validViews.has(view)) return;
  state.view = view;
  if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
  closeSidebar();
  render();
  if (focus) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

function criticalTone() {
  if (!state.preferences.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state !== 'running') return;
    const oscillator = audioContext.createOscillator(),
      gain = audioContext.createGain();
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch {
    /* Audio is an optional enhancement; visual alerts always remain. */
  }
}

function configureRefresh() {
  clearInterval(refreshTimer);
  if (state.preferences.autoRefresh && state.authorized) {
    refreshTimer = setInterval(
      () => {
        if (!document.hidden) void sync({ quiet: true });
      },
      (state.config.refresh_interval || 10) * 1000,
    );
  }
}

function sync({ quiet = false, force = false } = {}) {
  if (inFlight) {
    if (!force) return inFlight;
    // Mutations need one fresh snapshot after any older fetch has completed.
    // Coalesce concurrent callers instead of racing several forced refreshes.
    if (!queuedSync)
      queuedSync = inFlight.then(() => {
        queuedSync = null;
        return sync({ quiet });
      });
    return queuedSync;
  }
  const generation = sessionGeneration;
  const work = (async () => {
    $$('[data-action="refresh"]').forEach((button) => {
      button.disabled = true;
      button.classList.add('is-refreshing');
    });
    try {
      if (!state.config.version) state.config = await request('/api/config');
      if (state.config.auth_required && !state.token) {
        state.authorized = false;
        updateChrome();
        main.innerHTML = views.lockedView();
        return false;
      }
      const [patients, alerts, summary] = await Promise.all([
        request('/api/patients'),
        request('/api/alerts'),
        request('/api/summary'),
      ]);
      if (generation !== sessionGeneration) return false;
      const criticalIds = new Set(
        alerts
          .filter((alert) => alert.active !== false && !alert.acknowledged && alert.severity === 'critical')
          .map((alert) => alert.alert_id),
      );
      const hasNewCritical = [...criticalIds].some((id) => !lastCriticalIds.has(id));
      if (state.loaded && hasNewCritical) {
        criticalTone();
        toast('A new critical threshold alert needs review.', 'error');
      }
      lastCriticalIds = criticalIds;
      state.patients = patients;
      state.alerts = alerts;
      state.summary = summary;
      state.lastSync = new Date().toISOString();
      state.authorized = true;
      state.loaded = true;
      if (state.selectedId) {
        const updated = patients.find((patient) => patient.patient_id === state.selectedId);
        if (updated) {
          if (state.selectedPatient?.updated_at !== updated.updated_at) state.drawerSummary = null;
          state.selectedPatient = updated;
        } else {
          closeDrawer();
          toast('This patient is no longer in the active workspace.');
        }
      }
      updateChrome();
      setConnection(true);
      if (safeToRender()) render();
      if (state.selectedId && state.drawerTab !== 'notes' && safeToRender() && !state.summaryLoading)
        renderDrawer();
      return true;
    } catch (error) {
      if (generation !== sessionGeneration) return false;
      setConnection(false);
      if (error.status === 401) {
        state.authorized = false;
        state.token = '';
        state.patients = [];
        state.alerts = [];
        state.loaded = false;
        clearInterval(refreshTimer);
        closeModal();
        closeDrawer();
        main.innerHTML = views.lockedView('The access token was rejected. Enter a valid token to reconnect.');
        updateChrome();
      } else if (!state.loaded) main.innerHTML = views.errorView(error.message);
      else if (!quiet) toast(error.message, 'error');
      return false;
    } finally {
      $$('[data-action="refresh"]').forEach((button) => {
        button.disabled = false;
        button.classList.remove('is-refreshing');
      });
    }
  })();
  const tracked = work.finally(() => {
    if (inFlight === tracked) inFlight = null;
  });
  inFlight = tracked;
  return tracked;
}

function renderDrawer() {
  const previousScroll = $('.drawer-body', drawerElement)?.scrollTop || 0;
  const activeTab = document.activeElement?.closest('[role="tab"]')?.dataset.tab;
  drawerElement.innerHTML = drawer(state);
  const body = $('.drawer-body', drawerElement);
  if (body) body.scrollTop = previousScroll;
  if (activeTab) $(`[data-tab="${activeTab}"]`, drawerElement)?.focus();
}

async function openPatient(id) {
  const requestNumber = ++drawerRequest;
  if (!state.selectedId) lastFocus = document.activeElement;
  state.selectedId = id;
  state.selectedPatient = state.patients.find((patient) => patient.patient_id === id) || null;
  state.drawerTab = 'overview';
  state.drawerMetric = 'heart_rate';
  state.drawerSummary = null;
  state.summaryLoading = false;
  state.notes = [];
  state.notesLoading = true;
  drawerElement.hidden = false;
  $('#drawer-backdrop').hidden = false;
  drawerElement.classList.add('open');
  document.body.classList.add('drawer-is-open');
  $('.app-shell').inert = true;
  renderDrawer();
  $('button[data-action="close-drawer"]', drawerElement)?.focus();
  try {
    const [patient, notes] = await Promise.all([
      request(`/api/patients/${encodeURIComponent(id)}`),
      request(`/api/patients/${encodeURIComponent(id)}/notes`),
    ]);
    if (requestNumber !== drawerRequest || state.selectedId !== id) return;
    state.selectedPatient = patient;
    state.notes = notes;
    state.notesLoading = false;
    renderDrawer();
    $('button[data-action="close-drawer"]', drawerElement)?.focus();
  } catch (error) {
    if (requestNumber !== drawerRequest) return;
    state.notesLoading = false;
    closeDrawer();
    toast(error.message, 'error');
  }
}

function closeDrawer() {
  if (!state.selectedId && drawerElement.hidden) return;
  drawerRequest++;
  state.selectedId = null;
  state.selectedPatient = null;
  state.summaryLoading = false;
  state.drawerSummary = null;
  state.notes = [];
  drawerElement.classList.remove('open');
  drawerElement.hidden = true;
  drawerElement.replaceChildren();
  $('#drawer-backdrop').hidden = true;
  document.body.classList.remove('drawer-is-open');
  $('.app-shell').inert = false;
  if (lastFocus?.isConnected) lastFocus.focus();
  else main.focus({ preventScroll: true });
}

function openModal(content) {
  modal.innerHTML = content;
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => $('input:not([type="hidden"]), select, textarea', modal)?.focus());
}

function closeModal() {
  if (modal.open) modal.close();
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  $('.sidebar-scrim').hidden = true;
  $('.mobile-menu').setAttribute('aria-expanded', 'false');
}

async function exportCsv(button) {
  if (button) button.disabled = true;
  try {
    const response = await request('/api/export', { raw: true });
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mediwatch-patients-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Patient snapshot downloaded.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function acknowledgeAlert(id, target) {
  target.disabled = true;
  try {
    const alert = await request(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
      body: { acknowledged_by: 'Workspace operator' },
    });
    state.alerts = state.alerts.map((item) => (item.alert_id === id ? alert : item));
    render();
    toast('Alert marked as reviewed.');
  } catch (error) {
    toast(error.message, 'error');
    if (target.isConnected) target.disabled = false;
  }
}

async function generateSummary(target) {
  const id = state.selectedId;
  if (!id || state.summaryLoading) return;
  const generation = drawerRequest;
  const readingVersion = state.selectedPatient?.updated_at;
  state.summaryLoading = true;
  target.disabled = true;
  target.innerHTML = `${icon('refresh')} Generating…`;
  try {
    const summary = await request(`/api/patients/${encodeURIComponent(id)}/summary`, {
      method: 'POST',
      timeout: 25000,
    });
    if (state.selectedId === id && drawerRequest === generation) {
      if (
        state.selectedPatient?.updated_at === readingVersion &&
        (!summary.reading_at || summary.reading_at === readingVersion)
      )
        state.drawerSummary = summary;
      else toast('A newer reading arrived. Generate a fresh summary to include it.');
      state.summaryLoading = false;
      renderDrawer();
    }
  } catch (error) {
    if (state.selectedId === id && drawerRequest === generation) {
      toast(error.message, 'error');
      state.summaryLoading = false;
      renderDrawer();
    }
  }
}

function resetPreferences() {
  state.preferences = { ...defaults };
  state.patientView = 'grid';
  state.query = '';
  state.statusFilter = '';
  state.wardFilter = '';
  state.sort = 'priority';
  state.bannerDismissed = false;
  savePreferences();
  applyTheme();
  configureRefresh();
  render();
  toast('Workspace preferences reset.');
}

document.addEventListener('click', async (event) => {
  const navigation = event.target.closest('[data-view]');
  if (navigation) {
    event.preventDefault();
    setView(navigation.dataset.view);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  switch (action) {
    case 'refresh': {
      const success = await sync({ force: true });
      if (success) toast('Workspace is up to date.');
      break;
    }
    case 'toggle-theme':
      state.preferences.theme = state.preferences.theme === 'dark' ? 'light' : 'dark';
      savePreferences();
      applyTheme();
      if (state.view === 'settings') render();
      break;
    case 'view-alerts':
      setView('alerts');
      break;
    case 'view-patients':
      setView('patients');
      break;
    case 'stat-filter':
      state.statusFilter = target.dataset.status || '';
      state.query = '';
      state.wardFilter = '';
      setView('patients');
      break;
    case 'ward-patients':
      state.wardFilter = target.dataset.ward;
      state.statusFilter = '';
      state.query = '';
      setView('patients');
      break;
    case 'add-patient':
      openModal(patientForm());
      break;
    case 'open-patient':
      await openPatient(target.dataset.id);
      break;
    case 'close-drawer':
      closeDrawer();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'record-reading':
      if (state.selectedPatient) openModal(readingForm(state.selectedPatient));
      break;
    case 'discharge-patient':
      if (state.selectedPatient) openModal(dischargeForm(state.selectedPatient));
      break;
    case 'generate-summary':
      await generateSummary(target);
      break;
    case 'drawer-tab':
      state.drawerTab = target.dataset.tab;
      renderDrawer();
      $(`[data-tab="${state.drawerTab}"]`, drawerElement)?.focus();
      break;
    case 'chart-metric':
      state.chartMetric = target.dataset.metric;
      render();
      break;
    case 'view-chart-data':
      openModal(chartData(state));
      break;
    case 'patient-view':
      state.patientView = target.dataset.mode;
      state.preferences.patientView = state.patientView;
      savePreferences();
      render();
      break;
    case 'clear-filters':
      state.query = '';
      state.statusFilter = '';
      state.wardFilter = '';
      render();
      $('#patient-search')?.focus();
      break;
    case 'alert-filter':
      state.alertFilter = target.dataset.filter;
      render();
      break;
    case 'acknowledge-alert':
      await acknowledgeAlert(target.dataset.id, target);
      break;
    case 'export':
      await exportCsv(target);
      break;
    case 'dismiss-banner':
      state.bannerDismissed = true;
      target.closest('.demo-banner').remove();
      break;
    case 'toggle-sidebar': {
      const open = document.body.classList.toggle('sidebar-open');
      $('.sidebar-scrim').hidden = !open;
      $('.mobile-menu').setAttribute('aria-expanded', String(open));
      break;
    }
    case 'close-sidebar':
      closeSidebar();
      break;
    case 'reset-preferences':
      resetPreferences();
      break;
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'patient-search') {
    state.query = event.target.value;
    renderPatientArea();
  }
});

document.addEventListener('change', async (event) => {
  switch (event.target.id) {
    case 'status-filter':
      state.statusFilter = event.target.value;
      renderPatientArea();
      break;
    case 'ward-filter':
      state.wardFilter = event.target.value;
      renderPatientArea();
      break;
    case 'sort-filter':
      state.sort = event.target.value;
      renderPatientArea();
      break;
    case 'alert-severity':
      state.alertSeverity = event.target.value;
      render();
      break;
    case 'drawer-metric':
      state.drawerMetric = event.target.value;
      renderDrawer();
      $('#drawer-metric')?.focus();
      break;
    case 'setting-refresh':
      state.preferences.autoRefresh = event.target.checked;
      savePreferences();
      configureRefresh();
      setConnection(true);
      break;
    case 'setting-dark':
      state.preferences.theme = event.target.checked ? 'dark' : 'light';
      savePreferences();
      applyTheme();
      break;
    case 'setting-sound':
      state.preferences.sound = event.target.checked;
      savePreferences();
      if (event.target.checked) {
        try {
          audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
          await audioContext.resume();
          criticalTone();
        } catch {
          toast('This browser does not support sound alerts. Visual alerts remain available.', 'error');
        }
      }
      break;
  }
});

function formError(form, message) {
  const field = $('[data-form-error]', form);
  if (field) {
    field.textContent = message;
    field.hidden = false;
    field.scrollIntoView({ block: 'nearest' });
  } else toast(message, 'error');
}

function readingPayload(data) {
  return Object.fromEntries(VITALS.map((vital) => [vital.key, Number(data.get(vital.key))]));
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!['patient-form', 'reading-form', 'discharge-form', 'note-form', 'token-form'].includes(form.id))
    return;
  event.preventDefault();
  if (form.dataset.submitting) return;
  const submit = $('button[type="submit"]', form);
  const data = new FormData(form);
  const errorField = $('[data-form-error]', form);
  if (errorField) errorField.hidden = true;
  form.dataset.submitting = 'true';
  if (submit) {
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
  }
  try {
    if (form.id === 'token-form') {
      if (inFlight) await inFlight;
      sessionGeneration++;
      state.token = String(data.get('token')).trim();
      const success = await sync({ force: true });
      if (success) {
        configureRefresh();
        render();
        toast('Workspace connected.');
      }
      return;
    }
    if (form.id === 'patient-form') {
      const patient = await request('/api/patients', {
        method: 'POST',
        body: {
          ...readingPayload(data),
          name: String(data.get('name')).trim(),
          age: Number(data.get('age')),
          sex: data.get('sex'),
          ward: data.get('ward'),
          bed: String(data.get('bed')).trim(),
          condition: String(data.get('condition')).trim() || 'General observation',
        },
      });
      closeModal();
      state.query = '';
      state.statusFilter = '';
      state.wardFilter = '';
      await sync({ force: true });
      toast(`${patient.name} added to the workspace.`);
      await openPatient(patient.patient_id);
    } else if (form.id === 'reading-form') {
      const patient = await request(`/api/patients/${encodeURIComponent(form.dataset.id)}/readings`, {
        method: 'POST',
        body: readingPayload(data),
      });
      closeModal();
      state.selectedPatient = patient;
      state.drawerSummary = null;
      renderDrawer();
      await sync({ force: true });
      toast('Reading saved. Patient status updated.');
    } else if (form.id === 'discharge-form') {
      await request(`/api/patients/${encodeURIComponent(form.dataset.id)}/discharge`, { method: 'POST' });
      closeModal();
      closeDrawer();
      await sync({ force: true });
      toast('Patient discharged. Their record is retained in the database.');
    } else if (form.id === 'note-form') {
      const id = state.selectedId;
      const note = await request(`/api/patients/${encodeURIComponent(id)}/notes`, {
        method: 'POST',
        body: { content: String(data.get('content')).trim(), author: String(data.get('author')).trim() },
      });
      if (state.selectedId === id) {
        state.notes.unshift(note);
        renderDrawer();
        $('textarea', drawerElement)?.focus();
      }
      toast('Observation saved to the patient record.');
    }
  } catch (error) {
    formError(form, error.message);
  } finally {
    delete form.dataset.submitting;
    if (submit?.isConnected) {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  }
});

// A real dialog provides native keyboard semantics. The patient drawer uses the
// same focus boundaries; the background workspace is inert while it is open.
document.addEventListener('keydown', (event) => {
  const typing =
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable;
  if (event.key === 'Escape') {
    if (modal.open) return;
    if (state.selectedId) closeDrawer();
    closeSidebar();
    return;
  }
  if (state.selectedId && !modal.open && event.key === 'Tab') {
    const focusable = $$(
      'button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]',
      drawerElement,
    ).filter((element) => element.getClientRects().length);
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  if (
    event.target.matches('[role="tab"]') &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  ) {
    event.preventDefault();
    const tabs = ['overview', 'notes', 'history'];
    const index = tabs.indexOf(state.drawerTab);
    state.drawerTab =
      event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs[2]
          : tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    renderDrawer();
    $(`[data-tab="${state.drawerTab}"]`, drawerElement)?.focus();
  }
  if (typing || modal.open || state.selectedId || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '/') {
    event.preventDefault();
    if (!$('#patient-search')) setView('patients', false);
    $('#patient-search')?.focus();
  } else if (event.key.toLowerCase() === 'n' && state.loaded && state.authorized) {
    event.preventDefault();
    openModal(patientForm());
  }
});

modal.addEventListener('click', (event) => {
  if (event.target !== modal) return;
  const rect = modal.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    closeModal();
});
window.addEventListener('popstate', () => {
  const view = location.hash.slice(1);
  if (validViews.has(view)) setView(view);
});
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (validViews.has(view) && state.view !== view) setView(view);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.loaded && state.authorized && state.preferences.autoRefresh)
    void sync({ quiet: true });
});

async function initialize() {
  $$('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
  applyTheme();
  try {
    state.config = await request('/api/config');
    if (state.config.auth_required) {
      state.authorized = false;
      updateChrome();
      main.innerHTML = views.lockedView();
      return;
    }
    await sync();
    configureRefresh();
  } catch (error) {
    setConnection(false);
    main.innerHTML = views.errorView(error.message);
  }
}

void initialize();
