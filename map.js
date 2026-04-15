/* === MAP, ROUTING & LEAFLET ENGINE === */
if (!document.getElementById('route-anim-style')) {
    const style = document.createElement('style');
    style.id = 'route-anim-style';
    // -20 lässt die Striche der Linie vorwärts (Richtung Ziel) fließen
    style.innerHTML = `@keyframes routeDashAnim { to { stroke-dashoffset: -20; } } .animated-route-line { animation: routeDashAnim 1.5s linear infinite; }`;
    document.head.appendChild(style);
}
/* =========================================================
   7. KARTE (LEAFLET, KARTENTISCH & MESS-WERKZEUG)
   ========================================================= */
const hitBoxHtml = (color) => `<div class="pin-hitbox"><div class="pin-dot" style="background-color: ${color};"></div></div>`;
const hitBoxIcon = (color) => L.divIcon({ className: 'custom-pin', html: hitBoxHtml(color), iconSize: [34, 34], iconAnchor: [17, 17] });

const startIcon = hitBoxIcon('#44ff44'), destIcon = hitBoxIcon('#ff4444');
const wpIcon = L.divIcon({ className: 'custom-pin', html: `<div class="pin-hitbox" style="cursor: move;"><div class="pin-dot" style="background-color: #fdfd86;"></div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
const poiIcon = L.divIcon({ className: 'custom-pin', html: `<div class="pin-hitbox" style="cursor: move;"><div class="pin-dot" style="background-color: #b266ff; border: 2px solid #fff;"></div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
const measureIcon = L.divIcon({ className: 'custom-pin', html: `<div class="pin-hitbox" style="cursor: move;"><div class="pin-dot" style="background-color: #fff; width: 12px; height: 12px; min-width: 12px; min-height: 12px;"></div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
let routeLegLabelMarkers = [];
const AIP_POPUP_ROUTES = {
    AT: '/at/en/vfr/',
    DE: '/de/en/vfr/',
    FR: '/fr/aeroports/',
    GB: '/uk/vfr/',
    NL: '/nl/en/vfr/'
};
const MAP_HINT_DEFAULTS = {
    magentaLine: true,
    weather: true,
    windBarbs: true,
    cloudFields: true,
    traffic: true,
    telemetry: true,
    nextLeg: true
};
window.mapHints = window.mapHints || { ...MAP_HINT_DEFAULTS };

function loadMapHintSettings() {
    Object.keys(MAP_HINT_DEFAULTS).forEach(key => {
        const saved = localStorage.getItem(`ga_map_hint_${key}`);
        if (saved === null) window.mapHints[key] = MAP_HINT_DEFAULTS[key];
        else window.mapHints[key] = saved !== 'false';
    });
    // Wetter-/Traffic-Flags mit bestehenden Zuständen synchronisieren
    if (typeof window.vpShowMapMetar === 'boolean') window.mapHints.weather = window.vpShowMapMetar;
    if (typeof window.vpTrafficMapVisible === 'boolean') window.mapHints.traffic = window.vpTrafficMapVisible;
}

function saveMapHintSetting(key) {
    if (!(key in MAP_HINT_DEFAULTS)) return;
    localStorage.setItem(`ga_map_hint_${key}`, String(Boolean(window.mapHints[key])));
}

window.isMapHintEnabled = function(key) {
    if (!(key in MAP_HINT_DEFAULTS)) return true;
    return window.mapHints[key] !== false;
};

function applyMapHintEffects(key) {
    if (key === 'weather') {
        window.vpShowMapMetar = window.mapHints.weather !== false;
        localStorage.setItem('ga_show_map_metar', window.vpShowMapMetar);
        if (typeof renderWeatherMarkers === 'function') renderWeatherMarkers();
        if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(true);
    }
    if (key === 'windBarbs' || key === 'cloudFields') {
        if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(true);
    }
    if (key === 'traffic') {
        window.vpTrafficMapVisible = window.mapHints.traffic !== false;
        if (typeof window.applyTrafficVisibility === 'function') window.applyTrafficVisibility();
    }
    if (key === 'telemetry') {
        const box = document.getElementById('liveTelemetryBox');
        if (box && !window.mapHints.telemetry) box.style.display = 'none';
    }
    if (key === 'nextLeg') {
        const box = document.getElementById('liveNextWpBox');
        if (box && !window.mapHints.nextLeg) box.style.display = 'none';
    }
    if (key === 'magentaLine' && window.mapHints.magentaLine === false) {
        if (typeof window.clearLiveToWpLine === 'function') window.clearLiveToWpLine();
    }
}

function refreshMapHintMenuUi() {
    const labels = {
        magentaLine: '🟣 Direkt-Linie',
        weather: '🌤️ Wetter',
        windBarbs: '🪁 Windbarben',
        cloudFields: '☁️ Wolkenfelder',
        traffic: '✈️ Traffic',
        telemetry: '📟 Telemetrie',
        nextLeg: '🧭 Wegpunkt-Info'
    };
    const ids = {
        magentaLine: 'hintToggleMagentaLine',
        weather: 'hintToggleWeather',
        windBarbs: 'hintToggleWindBarbs',
        cloudFields: 'hintToggleCloudFields',
        traffic: 'hintToggleTraffic',
        telemetry: 'hintToggleTelemetry',
        nextLeg: 'hintToggleNextLeg'
    };
    Object.keys(ids).forEach(key => {
        const btn = document.getElementById(ids[key]);
        if (!btn) return;
        const on = window.mapHints[key] !== false;
        btn.textContent = `${labels[key]} (${on ? 'An' : 'Aus'})`;
        btn.style.background = on ? '#2E8B57' : '#444';
        btn.style.color = '#fff';
    });
}

window.toggleMapHint = function(key) {
    if (!(key in MAP_HINT_DEFAULTS)) return;
    window.mapHints[key] = !(window.mapHints[key] !== false);
    saveMapHintSetting(key);
    applyMapHintEffects(key);
    refreshMapHintMenuUi();
};

window.toggleMapHintsMenu = function(force) {
    const menu = document.getElementById('mapHintsMenu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    const nextOpen = typeof force === 'boolean' ? force : !isOpen;
    menu.style.display = nextOpen ? 'block' : 'none';
    if (nextOpen) refreshMapHintMenuUi();
};

function escapePopupText(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAirportCountryCode(icao, fallbackCountry = '') {
    const cc = String(fallbackCountry || globalAirports?.[icao]?.country || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

function hasAipCoverageForAirport(icao, fallbackCountry = '') {
    if (!icao || icao === 'GPS' || icao === 'POI') return false;
    return Boolean(resolveAipCountryCode(icao, fallbackCountry));
}

function resolveAipCountryCode(icao, fallbackCountry = '') {
    const cc = getAirportCountryCode(icao, fallbackCountry);
    if (cc && AIP_POPUP_ROUTES[cc]) return cc;

    const code = String(icao || '').trim().toUpperCase();
    if (code.startsWith('LO')) return 'AT';
    if (code.startsWith('LF')) return 'FR';
    if (code.startsWith('EH')) return 'NL';
    if (code.startsWith('EG')) return 'GB';
    if (code.startsWith('ED') || code.startsWith('ET')) return 'DE';
    return null;
}

function getAipPopupUrl(icao, fallbackCountry = '') {
    const cc = resolveAipCountryCode(icao, fallbackCountry);
    if (!cc) return null;
    const route = AIP_POPUP_ROUTES[cc];
    return `https://aip.aero${route}?${encodeURIComponent(String(icao).trim().toUpperCase())}=`;
}

const AIP_PROXY_BASE = 'https://ga-proxy.einherjer.workers.dev';
const AIP_CHART_STORAGE_KEY = 'ga_aip_chart_settings_v1';
const AIP_CHART_UI_ENABLED = false;
const AIP_CHART_OPACITY_MIN = 0.15;
const AIP_CHART_OPACITY_MAX = 1.0;
const AIP_CHART_OPACITY_DEFAULT = 0.65;
const AIP_CHART_CAL_MARKER_STYLE = [
    { color: '#2ec4ff', fillColor: '#2ec4ff' },
    { color: '#ffd166', fillColor: '#ffd166' }
];
const AIP_PDFJS_CDN = {
    lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};

let aipChartOverlayLayer = null;
let aipChartOverlayMeta = null;
let aipChartBusy = false;
let aipPrevClosePopupOnClick = null;
let aipChartCalibration = {
    active: false,
    targetIcao: '',
    step: 0,
    imagePoints: [],
    mapPoints: [],
    mapMarkers: []
};

function escapeJsSingleQuoted(v) {
    return String(v ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '')
        .replace(/\n/g, ' ');
}

function sanitizeAipIcaoKey(icao) {
    return String(icao || '').trim().toUpperCase();
}

function getAipStorageData() {
    try {
        const raw = localStorage.getItem(AIP_CHART_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

function saveAipStorageData(data) {
    try {
        localStorage.setItem(AIP_CHART_STORAGE_KEY, JSON.stringify(data || {}));
    } catch (e) { }
}

function getAipChartSettings(icao) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return null;
    const all = getAipStorageData();
    const obj = all[key];
    return (obj && typeof obj === 'object') ? obj : null;
}

function patchAipChartSettings(icao, patch) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key || !patch || typeof patch !== 'object') return;
    const all = getAipStorageData();
    const prev = (all[key] && typeof all[key] === 'object') ? all[key] : {};
    all[key] = { ...prev, ...patch };
    saveAipStorageData(all);
}

function normalizeAipOpacity(value) {
    let v = Number(value);
    if (!Number.isFinite(v)) return AIP_CHART_OPACITY_DEFAULT;
    if (v > 1) v = v / 100;
    v = Math.max(AIP_CHART_OPACITY_MIN, Math.min(AIP_CHART_OPACITY_MAX, v));
    return Math.round(v * 1000) / 1000;
}

function getAipCurrentOpacity(icao) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return AIP_CHART_OPACITY_DEFAULT;
    if (aipChartOverlayMeta && aipChartOverlayMeta.icao === key) return normalizeAipOpacity(aipChartOverlayMeta.opacity);
    const saved = getAipChartSettings(key);
    if (saved && saved.opacity != null) return normalizeAipOpacity(saved.opacity);
    return AIP_CHART_OPACITY_DEFAULT;
}

function decodeAipStoredBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;
    const south = Number(bounds.south);
    const west = Number(bounds.west);
    const north = Number(bounds.north);
    const east = Number(bounds.east);
    if (![south, west, north, east].every(Number.isFinite)) return null;
    const s = Math.min(south, north);
    const n = Math.max(south, north);
    const w = Math.min(west, east);
    const e = Math.max(west, east);
    if (n - s < 0.00001 || e - w < 0.00001) return null;
    return L.latLngBounds([s, w], [n, e]);
}

function encodeAipBounds(bounds) {
    if (!bounds || typeof bounds.getSouth !== 'function') return null;
    return {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast()
    };
}

function ensureAipOverlayPane() {
    if (!map) return null;
    let pane = map.getPane('aipChartPane');
    if (!pane) pane = map.createPane('aipChartPane');
    pane.style.zIndex = '320';
    pane.style.pointerEvents = 'none';
    return pane;
}

function getAipOverlayImageEl() {
    if (!aipChartOverlayLayer || typeof aipChartOverlayLayer.getElement !== 'function') return null;
    return aipChartOverlayLayer.getElement();
}

function setAipOverlayPointerEvents(enabled) {
    const pane = map && map.getPane ? map.getPane('aipChartPane') : null;
    if (pane) pane.style.pointerEvents = enabled ? 'auto' : 'none';
    const img = getAipOverlayImageEl();
    if (img) img.style.pointerEvents = enabled ? 'auto' : 'none';
}

function getAipStatusElementsForIcao(icao) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return [];
    return Array.from(document.querySelectorAll(`.aip-overlay-status[data-aip-icao="${key}"]`));
}

function setAipOverlayStatus(icao, text, isError = false) {
    const targets = getAipStatusElementsForIcao(icao);
    targets.forEach(el => {
        el.textContent = String(text || '');
        el.style.color = isError ? '#b91c1c' : '#444';
    });
}

function refreshAipOverlayPopupUi(icao) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return;
    const opacityPct = Math.round(getAipCurrentOpacity(key) * 100);
    const statusText = aipChartOverlayMeta && aipChartOverlayMeta.icao === key
        ? `Overlay aktiv (${Math.round((aipChartOverlayMeta.opacity || AIP_CHART_OPACITY_DEFAULT) * 100)}%)`
        : 'Overlay aus';

    const statusEls = getAipStatusElementsForIcao(key);
    statusEls.forEach(el => {
        if (!el.textContent || el.textContent.trim() === '' || /Overlay (aktiv|aus)/i.test(el.textContent.trim())) {
            el.textContent = statusText;
            el.style.color = '#444';
        }
    });

    Array.from(document.querySelectorAll(`.aip-opacity-slider[data-aip-icao="${key}"]`)).forEach(slider => {
        slider.value = String(opacityPct);
    });
    Array.from(document.querySelectorAll(`.aip-opacity-value[data-aip-icao="${key}"]`)).forEach(el => {
        el.textContent = `${opacityPct}%`;
    });
    Array.from(document.querySelectorAll(`.aip-calibrate-btn[data-aip-icao="${key}"]`)).forEach(btn => {
        btn.textContent = aipChartCalibration.active && aipChartCalibration.targetIcao === key
            ? '❌ Kalibrierung abbrechen'
            : '🎯 Kalibrieren (2 Punkte)';
    });
}

function clearAipCalibrationMarkers() {
    if (!map || !Array.isArray(aipChartCalibration.mapMarkers)) return;
    aipChartCalibration.mapMarkers.forEach(m => {
        try { map.removeLayer(m); } catch (e) { }
    });
    aipChartCalibration.mapMarkers = [];
}

function resetAipCalibrationState() {
    clearAipCalibrationMarkers();
    if (map && aipPrevClosePopupOnClick !== null) {
        map.options.closePopupOnClick = aipPrevClosePopupOnClick;
    }
    aipPrevClosePopupOnClick = null;
    aipChartCalibration = {
        active: false,
        targetIcao: '',
        step: 0,
        imagePoints: [],
        mapPoints: [],
        mapMarkers: []
    };
    setAipOverlayPointerEvents(false);
}

function addAipCalibrationMapMarker(latlng, idx) {
    if (!map || !latlng) return;
    const style = AIP_CHART_CAL_MARKER_STYLE[idx] || AIP_CHART_CAL_MARKER_STYLE[0];
    const marker = L.circleMarker(latlng, {
        radius: 5,
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: 0.9,
        weight: 2,
        interactive: false
    }).addTo(map);
    aipChartCalibration.mapMarkers.push(marker);
}

function getAipCalibrationInstruction() {
    switch (aipChartCalibration.step) {
        case 0: return 'Kalibrierung: Punkt 1 auf dem Blatt anklicken.';
        case 1: return 'Kalibrierung: zugehörigen Punkt 1 auf der Karte anklicken.';
        case 2: return 'Kalibrierung: Punkt 2 auf dem Blatt anklicken.';
        case 3: return 'Kalibrierung: zugehörigen Punkt 2 auf der Karte anklicken.';
        default: return 'Kalibrierung läuft…';
    }
}

function readAipImagePointFromEvent(evt) {
    const img = getAipOverlayImageEl();
    const oe = evt && evt.originalEvent;
    if (!img || !oe || !Number.isFinite(oe.clientX) || !Number.isFinite(oe.clientY)) return null;
    const rect = img.getBoundingClientRect();
    const x = oe.clientX - rect.left;
    const y = oe.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    if (!inside || rect.width < 2 || rect.height < 2) return null;

    const naturalW = aipChartOverlayMeta?.naturalWidth || img.naturalWidth || rect.width;
    const naturalH = aipChartOverlayMeta?.naturalHeight || img.naturalHeight || rect.height;
    return {
        x: (x / rect.width) * naturalW,
        y: (y / rect.height) * naturalH
    };
}

function finishAipCalibration(successMsg = '') {
    const key = sanitizeAipIcaoKey(aipChartCalibration.targetIcao);
    resetAipCalibrationState();
    if (key) refreshAipOverlayPopupUi(key);
    if (key && successMsg) setAipOverlayStatus(key, successMsg, false);
}

function abortAipCalibration(errorMsg = '') {
    const key = sanitizeAipIcaoKey(aipChartCalibration.targetIcao || aipChartOverlayMeta?.icao || '');
    resetAipCalibrationState();
    if (key) {
        refreshAipOverlayPopupUi(key);
        if (errorMsg) setAipOverlayStatus(key, errorMsg, true);
    }
}

function finalizeAipCalibration() {
    if (!aipChartOverlayLayer || !aipChartOverlayMeta) {
        abortAipCalibration('Kalibrierung nicht möglich: Kein Overlay aktiv.');
        return;
    }
    if (aipChartCalibration.imagePoints.length !== 2 || aipChartCalibration.mapPoints.length !== 2) {
        abortAipCalibration('Kalibrierung unvollständig.');
        return;
    }
    const w = Number(aipChartOverlayMeta.naturalWidth);
    const h = Number(aipChartOverlayMeta.naturalHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
        abortAipCalibration('Kalibrierung fehlgeschlagen (Bildgröße ungültig).');
        return;
    }

    const ip1 = aipChartCalibration.imagePoints[0];
    const ip2 = aipChartCalibration.imagePoints[1];
    const mp1 = aipChartCalibration.mapPoints[0];
    const mp2 = aipChartCalibration.mapPoints[1];
    const dx = ip2.x - ip1.x;
    const dy = ip2.y - ip1.y;
    if (Math.abs(dx) < 8 || Math.abs(dy) < 8) {
        abortAipCalibration('Kalibrierung: Punkte liegen zu nah beieinander.');
        return;
    }

    const lonScale = (mp2.lng - mp1.lng) / dx;
    const lonOffset = mp1.lng - lonScale * ip1.x;
    const latScale = (mp2.lat - mp1.lat) / dy;
    const latOffset = mp1.lat - latScale * ip1.y;

    const west = lonOffset;
    const east = lonScale * w + lonOffset;
    const north = latOffset;
    const south = latScale * h + latOffset;

    const s = Math.min(south, north);
    const n = Math.max(south, north);
    const wst = Math.min(west, east);
    const est = Math.max(west, east);
    if (n - s < 0.00001 || est - wst < 0.00001) {
        abortAipCalibration('Kalibrierung: Ergebnis unplausibel.');
        return;
    }

    const bounds = L.latLngBounds([s, wst], [n, est]);
    aipChartOverlayLayer.setBounds(bounds);
    patchAipChartSettings(aipChartOverlayMeta.icao, { bounds: encodeAipBounds(bounds) });
    finishAipCalibration('Kalibrierung gespeichert.');
}

function handleAipCalibrationMapClick(evt) {
    if (!aipChartCalibration.active) return false;
    const key = sanitizeAipIcaoKey(aipChartCalibration.targetIcao || aipChartOverlayMeta?.icao || '');
    if (!key) return true;
    if (!aipChartOverlayLayer || !aipChartOverlayMeta || aipChartOverlayMeta.icao !== key) {
        abortAipCalibration('Kalibrierung abgebrochen: Overlay nicht mehr aktiv.');
        return true;
    }
    const expectImagePoint = aipChartCalibration.step % 2 === 0;
    if (expectImagePoint) {
        const imgPoint = readAipImagePointFromEvent(evt);
        if (!imgPoint) {
            setAipOverlayStatus(key, 'Bitte direkt auf das Anflugblatt klicken.', true);
            return true;
        }
        aipChartCalibration.imagePoints.push(imgPoint);
        aipChartCalibration.step += 1;
        setAipOverlayStatus(key, getAipCalibrationInstruction(), false);
        return true;
    }

    if (!evt || !evt.latlng) {
        setAipOverlayStatus(key, 'Ungültiger Kartenpunkt.', true);
        return true;
    }
    const pairIdx = aipChartCalibration.mapPoints.length;
    aipChartCalibration.mapPoints.push({ lat: evt.latlng.lat, lng: evt.latlng.lng });
    addAipCalibrationMapMarker(evt.latlng, pairIdx);
    aipChartCalibration.step += 1;

    if (aipChartCalibration.step >= 4) {
        finalizeAipCalibration();
    } else {
        setAipOverlayStatus(key, getAipCalibrationInstruction(), false);
    }
    return true;
}

function computeAipFallbackBounds(naturalWidth, naturalHeight) {
    const center = (map && typeof map.getCenter === 'function') ? map.getCenter() : { lat: 51.0, lng: 10.0 };
    const h = Number(naturalHeight) > 0 ? Number(naturalHeight) : 1000;
    const w = Number(naturalWidth) > 0 ? Number(naturalWidth) : 1000;
    const ratio = Math.max(0.35, Math.min(4.0, w / h));
    const halfLat = 0.11;
    const lonScale = Math.max(0.2, Math.cos((center.lat || 0) * Math.PI / 180));
    const halfLon = (halfLat * ratio) / lonScale;
    return L.latLngBounds(
        [center.lat - halfLat, center.lng - halfLon],
        [center.lat + halfLat, center.lng + halfLon]
    );
}

function applyAipChartOverlay(dataUrl, bounds, opacity) {
    if (!map || !dataUrl) return;
    ensureAipOverlayPane();
    if (aipChartOverlayLayer) {
        try { map.removeLayer(aipChartOverlayLayer); } catch (e) { }
        aipChartOverlayLayer = null;
    }
    aipChartOverlayLayer = L.imageOverlay(dataUrl, bounds, {
        pane: 'aipChartPane',
        opacity: normalizeAipOpacity(opacity),
        interactive: false
    }).addTo(map);
    setAipOverlayPointerEvents(false);
}

async function ensurePdfJsReady() {
    if (window.pdfjsLib) {
        if (window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = AIP_PDFJS_CDN.worker;
        }
        return window.pdfjsLib;
    }
    await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-aip-pdfjs="1"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('PDF.js konnte nicht geladen werden.')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = AIP_PDFJS_CDN.lib;
        script.async = true;
        script.dataset.aipPdfjs = '1';
        script.onload = resolve;
        script.onerror = () => reject(new Error('PDF.js konnte nicht geladen werden.'));
        document.head.appendChild(script);
    });
    if (!window.pdfjsLib) throw new Error('PDF.js steht nicht zur Verfügung.');
    if (window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = AIP_PDFJS_CDN.worker;
    }
    return window.pdfjsLib;
}

async function fetchAipFileViaProxy(fileUrl) {
    const proxyUrl = `${AIP_PROXY_BASE}/api/aip-chart/file?url=${encodeURIComponent(fileUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Dateiabruf fehlgeschlagen (${res.status}) ${body || ''}`.trim());
    }
    const blob = await res.blob();
    const contentType = String(res.headers.get('content-type') || blob.type || '').toLowerCase();
    return { blob, contentType };
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(blob);
    });
}

function readImageSizeFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error('Bildgröße konnte nicht gelesen werden.'));
        img.src = dataUrl;
    });
}

async function renderPdfBlobToImageData(pdfBlob) {
    const lib = await ensurePdfJsReady();
    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const loadingTask = lib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, width: canvas.width, height: canvas.height };
}

async function resolveAipChartSource(icao, countryCode = '') {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) throw new Error('ICAO fehlt.');
    const url = `${AIP_PROXY_BASE}/api/aip-chart/resolve?icao=${encodeURIComponent(key)}&country=${encodeURIComponent(String(countryCode || '').toUpperCase())}`;
    const res = await fetch(url);
    let payload = null;
    try { payload = await res.json(); } catch (e) { }
    if (!res.ok || !payload || payload.ok !== true) {
        const errCode = payload?.errorCode || `http_${res.status}`;
        throw new Error(`AIP-Quelle nicht verfügbar (${errCode}).`);
    }
    if (!payload.chartUrl || !payload.chartKind) {
        throw new Error(`AIP-Quelle ohne Chart-Link (${payload.errorCode || 'not_found'}).`);
    }
    return payload;
}

function persistAipOverlayState(icao, patch) {
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return;
    patchAipChartSettings(key, patch);
}

window.loadAipChartOverlay = async function(icao, countryCode = '') {
    if (!map) return;
    const key = sanitizeAipIcaoKey(icao);
    if (!key) return;
    if (aipChartBusy) {
        setAipOverlayStatus(key, 'AIP-Overlay lädt bereits…', false);
        return;
    }
    if (aipChartCalibration.active) abortAipCalibration('');
    aipChartBusy = true;
    setAipOverlayStatus(key, 'AIP-Overlay wird geladen…', false);

    try {
        const resolved = await resolveAipChartSource(key, countryCode);
        const fetched = await fetchAipFileViaProxy(resolved.chartUrl);

        let imageData = null;
        if (resolved.chartKind === 'image' || fetched.contentType.startsWith('image/')) {
            const dataUrl = await blobToDataUrl(fetched.blob);
            const size = await readImageSizeFromDataUrl(dataUrl);
            imageData = { dataUrl, width: size.width, height: size.height, chartKind: 'image' };
        } else if (resolved.chartKind === 'pdf' || fetched.contentType.includes('pdf')) {
            const rendered = await renderPdfBlobToImageData(fetched.blob);
            imageData = { ...rendered, chartKind: 'pdf' };
        } else {
            throw new Error('Unbekanntes AIP-Format.');
        }

        const saved = getAipChartSettings(key);
        const savedBounds = decodeAipStoredBounds(saved?.bounds);
        const bounds = savedBounds || computeAipFallbackBounds(imageData.width, imageData.height);
        const opacity = getAipCurrentOpacity(key);

        applyAipChartOverlay(imageData.dataUrl, bounds, opacity);
        aipChartOverlayMeta = {
            icao: key,
            countryCode: String(countryCode || '').toUpperCase(),
            chartKind: imageData.chartKind,
            chartUrl: resolved.chartUrl,
            sourcePage: resolved.sourcePage || '',
            dfsLink: resolved.dfsLink || '',
            title: resolved.title || '',
            naturalWidth: imageData.width,
            naturalHeight: imageData.height,
            opacity: normalizeAipOpacity(opacity)
        };

        persistAipOverlayState(key, {
            opacity: aipChartOverlayMeta.opacity,
            chartKind: aipChartOverlayMeta.chartKind,
            chartUrl: aipChartOverlayMeta.chartUrl,
            sourcePage: aipChartOverlayMeta.sourcePage,
            dfsLink: aipChartOverlayMeta.dfsLink
        });
        refreshAipOverlayPopupUi(key);
        setAipOverlayStatus(key, `Overlay aktiv (${Math.round(aipChartOverlayMeta.opacity * 100)}%)`, false);
    } catch (e) {
        const msg = (e && e.message) ? e.message : 'Overlay konnte nicht geladen werden.';
        setAipOverlayStatus(key, msg, true);
    } finally {
        aipChartBusy = false;
    }
};

window.setAipChartOpacity = function(value, icao = '') {
    const opacity = normalizeAipOpacity(value);
    const requestedKey = sanitizeAipIcaoKey(icao);
    const key = requestedKey || sanitizeAipIcaoKey(aipChartOverlayMeta?.icao || '');
    if (aipChartOverlayLayer && typeof aipChartOverlayLayer.setOpacity === 'function') {
        if (!requestedKey || (aipChartOverlayMeta && aipChartOverlayMeta.icao === requestedKey)) {
            aipChartOverlayLayer.setOpacity(opacity);
        }
    }
    if (aipChartOverlayMeta && (!requestedKey || aipChartOverlayMeta.icao === requestedKey)) {
        aipChartOverlayMeta.opacity = opacity;
    }
    if (key) persistAipOverlayState(key, { opacity });
    if (key) {
        refreshAipOverlayPopupUi(key);
        if (aipChartOverlayMeta && aipChartOverlayMeta.icao === key) {
            setAipOverlayStatus(key, `Overlay aktiv (${Math.round(opacity * 100)}%)`, false);
        } else {
            setAipOverlayStatus(key, `Transparenz gespeichert (${Math.round(opacity * 100)}%)`, false);
        }
    }
};

window.clearAipChartOverlay = function() {
    const key = sanitizeAipIcaoKey(aipChartOverlayMeta?.icao || aipChartCalibration.targetIcao || '');
    if (aipChartOverlayLayer && map) {
        try { map.removeLayer(aipChartOverlayLayer); } catch (e) { }
    }
    aipChartOverlayLayer = null;
    aipChartOverlayMeta = null;
    abortAipCalibration('');
    if (key) {
        refreshAipOverlayPopupUi(key);
        setAipOverlayStatus(key, 'Overlay aus', false);
    }
};

window.startAipChartCalibration = function(icao = '') {
    const key = sanitizeAipIcaoKey(icao || aipChartOverlayMeta?.icao || '');
    if (aipChartCalibration.active) {
        abortAipCalibration('Kalibrierung abgebrochen.');
        return;
    }
    if (!aipChartOverlayLayer || !aipChartOverlayMeta || !key || aipChartOverlayMeta.icao !== key) {
        setAipOverlayStatus(key || '---', 'Bitte zuerst Overlay laden.', true);
        return;
    }
    aipChartCalibration.active = true;
    aipChartCalibration.targetIcao = key;
    aipChartCalibration.step = 0;
    aipChartCalibration.imagePoints = [];
    aipChartCalibration.mapPoints = [];
    clearAipCalibrationMarkers();
    if (map) {
        aipPrevClosePopupOnClick = map.options.closePopupOnClick;
        map.options.closePopupOnClick = false;
    }
    setAipOverlayPointerEvents(true);
    refreshAipOverlayPopupUi(key);
    setAipOverlayStatus(key, getAipCalibrationInstruction(), false);
};

function buildPopupFrequencyLines(icao) {
    if (!icao || typeof freqCache === 'undefined' || !Array.isArray(freqCache[icao])) {
        return '<span style="color:#666;">Frequenzen laden…</span>';
    }
    if (freqCache[icao].length === 0) {
        return '<span style="color:#666;">Keine Frequenzen verfügbar</span>';
    }
    return freqCache[icao]
        .slice(0, 6)
        .map(f => `📻 ${escapePopupText(f.label || 'Freq')}: ${escapePopupText(f.value || '--')}`)
        .join('<br>');
}

function updatePopupFrequencyBlock(containerId, icao) {
    if (!containerId || !icao) return;
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = buildPopupFrequencyLines(icao);
}

function getAirportTapRadiusPx(basePx = 34) {
    if (!map || !map.getZoom) return basePx;
    const z = map.getZoom();
    // Beim Rauszoomen deutlich kleinerer Clickspot, beim Reinzoomen komfortabel.
    // z=7 -> ~10px, z=10 -> ~19px, z=14 -> ~34px
    const scaled = 10 + ((z - 7) / 7) * (basePx - 10);
    return Math.max(8, Math.min(basePx, Math.round(scaled)));
}

function isMapUiClickTarget(evt) {
    const t = evt && evt.target;
    if (!t || !t.closest) return false;
    return Boolean(
        t.closest('.leaflet-control') ||
        t.closest('.map-overlay-btn') ||
        t.closest('.pb-btn') ||
        t.closest('#vpSettingsMenu') ||
        t.closest('#awmFreqBanner') ||
        t.closest('.telemetry-box') ||
        t.closest('.leaflet-popup') ||
        t.closest('.leaflet-tooltip')
    );
}

function ensureRouteLegLabelPane() {
    if (!map) return;
    if (map.getPane('routeLegLabelPane')) return;
    const pane = map.createPane('routeLegLabelPane');
    pane.style.zIndex = '350'; // Unter der Route (Overlay-Pane ~400)
    pane.style.pointerEvents = 'none';
}

function clearRouteLegLabels() {
    if (!map || !routeLegLabelMarkers.length) return;
    routeLegLabelMarkers.forEach(m => map.removeLayer(m));
    routeLegLabelMarkers = [];
}

function getLegScreenAngle(p1, p2) {
    const a = map.latLngToLayerPoint([p1.lat, p1.lng || p1.lon]);
    const b = map.latLngToLayerPoint([p2.lat, p2.lng || p2.lon]);
    let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
}

function formatNm(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.0';
    return (Math.round(n * 10) / 10).toFixed(1);
}

function renderRouteLegLabels() {
    clearRouteLegLabels();
    if (!map || !routeWaypoints || routeWaypoints.length < 2) return;
    ensureRouteLegLabelPane();
    const zoom = map.getZoom ? map.getZoom() : 10;
    const fontSize = Math.max(9, Math.min(14, Math.round(9 + ((zoom - 6) / 7) * 5)));
    const gap = Math.max(7, Math.round(fontSize * 0.4) + 4);

    for (let i = 0; i < routeWaypoints.length - 1; i++) {
        const p1 = routeWaypoints[i];
        const p2 = routeWaypoints[i + 1];
        const nav = calcNav(p1.lat, p1.lng || p1.lon, p2.lat, p2.lng || p2.lon);

        const midLat = (p1.lat + p2.lat) / 2;
        const midLng = ((p1.lng || p1.lon) + (p2.lng || p2.lon)) / 2;
        const angle = getLegScreenAngle(p1, p2).toFixed(1);

        const html = `
            <div class="route-leg-label" style="transform: translate(-50%, -50%) rotate(${angle}deg); --leg-fz:${fontSize}px; --leg-gap:${gap}px;">
                <div class="route-leg-course">${nav.brng}°</div>
                <div class="route-leg-dist">${formatNm(nav.dist)} NM</div>
            </div>
        `;

        const labelIcon = L.divIcon({
            className: 'route-leg-label-icon',
            html,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        });

        const marker = L.marker([midLat, midLng], {
            icon: labelIcon,
            interactive: false,
            pane: 'routeLegLabelPane'
        }).addTo(map);

        routeLegLabelMarkers.push(marker);
    }
}

function toggleMeasureMode() {
    measureMode = !measureMode; const btn = document.getElementById('measureBtn');
    if (measureMode) {
        btn.innerText = '📏 Messen (An)'; btn.style.background = 'var(--piper-yellow)'; btn.style.color = '#000';
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        btn.innerText = '📏 Messen (Aus)'; btn.style.background = '#444'; btn.style.color = '#fff';
        document.getElementById('map').style.cursor = '';
    }
    if (map && typeof map.closePopup === 'function') map.closePopup();
    if (typeof renderMainRoute === 'function' && routeWaypoints && routeWaypoints.length > 0) renderMainRoute();
    if (typeof renderWeatherMarkers === 'function') renderWeatherMarkers();
    if (typeof liveGpsMarker !== 'undefined' && liveGpsMarker) {
        try {
            if (typeof liveGpsMarker.closePopup === 'function') liveGpsMarker.closePopup();
            const el = liveGpsMarker.getElement && liveGpsMarker.getElement();
            if (el) el.style.pointerEvents = measureMode ? 'none' : 'auto';
        } catch (e) { }
    }
}

function addMeasurePoint(latlng) {
    if (measureMarkers.length >= 2) { clearMeasure(); }
    const marker = L.marker(latlng, { icon: measureIcon, draggable: true }).addTo(map);
    marker.on('drag', updateMeasureRoute); marker.on('dragend', updateMeasureRoute);
    measureMarkers.push(marker); updateMeasureRoute();
}

function updateMeasureRoute() {
    if (measurePolyline) map.removeLayer(measurePolyline);
    if (measureTooltip) { map.removeLayer(measureTooltip); measureTooltip = null; }
    measurePoints = measureMarkers.map(m => m.getLatLng());

    if (measurePoints.length === 2) {
        measurePolyline = L.polyline(measurePoints, { color: '#f2c12e', weight: 4, dashArray: '6,6' }).addTo(map);
        const nav = calcNav(measurePoints[0].lat, measurePoints[0].lng || measurePoints[0].lon, measurePoints[1].lat, measurePoints[1].lng || measurePoints[1].lon);
        const centerLat = (measurePoints[0].lat + measurePoints[1].lat) / 2, centerLng = (measurePoints[0].lng + measurePoints[1].lng) / 2;
        const labelText = `<div style="font-weight:bold; font-size:14px; color:#111; text-align:center; line-height: 1.2;">${nav.brng}°<br>${formatNm(nav.dist)} NM</div>`;
        measureTooltip = L.tooltip({ permanent: true, direction: 'center', className: 'measure-label' }).setLatLng([centerLat, centerLng]).setContent(labelText).addTo(map);
    }
}

function clearMeasure() {
    if (measurePolyline) map.removeLayer(measurePolyline);
    if (measureTooltip) { map.removeLayer(measureTooltip); measureTooltip = null; }
    measureMarkers.forEach(m => map.removeLayer(m)); measurePoints = []; measureMarkers = [];
}

window.removeRouteWaypoint = function (index) { routeWaypoints.splice(index, 1); renderMainRoute(); };

function resetMainRoute() {
    if (routeWaypoints.length > 2) {
        routeWaypoints = [routeWaypoints[0], routeWaypoints[routeWaypoints.length - 1]];
        renderMainRoute(); map.fitBounds(L.latLngBounds(routeWaypoints), { padding: [40, 40] });
    }
}

function renderMainRoute() {
    if (!map) initMapBase();
    window.vpBgNeedsUpdate = true;
    routeMarkers.forEach(m => map.removeLayer(m));
    routeMarkers = [];
    clearRouteLegLabels();

    if (routeWaypoints.length === 0) {
        if (polyline) { map.removeLayer(polyline); polyline = null; }
        if (window.hitBoxPolyline) { map.removeLayer(window.hitBoxPolyline); window.hitBoxPolyline = null; }
        return;
    }

    if (!polyline) {
        polyline = L.polyline(routeWaypoints, { color: '#ff4444', weight: 8, dashArray: '10,10', className: 'animated-route-line', interactive: false }).addTo(map);
    } else {
        polyline.setLatLngs(routeWaypoints);
    }

    if (!window.hitBoxPolyline) {
        window.hitBoxPolyline = L.polyline(routeWaypoints, { color: 'transparent', weight: 45, opacity: 0, className: 'interactive-route' }).addTo(map);
        window.hitBoxPolyline.on('click', function (e) {
            if (measureMode) return;
            let bestIndex = 1, minDiff = Infinity;
            for (let i = 0; i < routeWaypoints.length - 1; i++) {
                let p1 = L.latLng(routeWaypoints[i].lat, routeWaypoints[i].lng || routeWaypoints[i].lon);
                let p2 = L.latLng(routeWaypoints[i + 1].lat, routeWaypoints[i + 1].lng || routeWaypoints[i + 1].lon);
                let d1 = map.distance(p1, e.latlng), d2 = map.distance(e.latlng, p2), d = map.distance(p1, p2), diff = d1 + d2 - d;
                if (diff < minDiff) { minDiff = diff; bestIndex = i + 1; }
            }
            routeWaypoints.splice(bestIndex, 0, e.latlng); renderMainRoute();
        });
    } else {
        window.hitBoxPolyline.setLatLngs(routeWaypoints);
    }

    routeWaypoints.forEach((latlng, index) => {
        let isStart = (index === 0), isDest = (index === routeWaypoints.length - 1 && routeWaypoints.length > 1);
        let isPOI = routeWaypoints[index].isPOI === true;
        
        let icon = isStart ? startIcon : (isDest ? destIcon : (isPOI ? poiIcon : wpIcon));
        // Wir erlauben das Draggen von POIs und Wegpunkten. Start/Dest bleiben fix.
        let draggable = (!isStart && !isDest && !measureMode);
        // POI Marker immer nach vorne holen (Z-Index), damit er nicht hinter der Linie verschwindet
        let marker = L.marker(latlng, {
            icon: icon,
            draggable: draggable,
            interactive: !measureMode,
            riseOnHover: true,
            zIndexOffset: isPOI ? 3500 : 3000
        }).addTo(map);

        if (isStart) {
            marker.bindPopup('');
            marker.on('popupopen', () => {
                const depCountry = getAirportCountryCode(currentStartICAO);
                marker.getPopup().setContent(_buildAptPopup('DEP', currentSName, currentDepElev, currentStartICAO, {
                    runwayContainerId: 'wxPopupDepRwy',
                    freqContainerId: 'wxPopupDepFreq',
                    countryCode: depCountry,
                    showDirectTo: currentStartICAO && currentStartICAO !== 'GPS' && currentStartICAO !== currentDestICAO,
                    directToName: currentSName,
                    lat: latlng.lat,
                    lon: latlng.lng || latlng.lon
                }));
                marker.getPopup().update();
                const depIcao = currentStartICAO;
                if (depIcao) setTimeout(() => refreshAipOverlayPopupUi(depIcao), 0);
                if (depIcao && depIcao !== 'GPS' && typeof fetchRunwayDetails === 'function') {
                    fetchRunwayDetails(latlng.lat, latlng.lng || latlng.lon, 'wxPopupDepRwy', depIcao);
                }
                if (depIcao && depIcao !== 'GPS' && typeof fetchAirportFreq === 'function') {
                    updatePopupFrequencyBlock('wxPopupDepFreq', depIcao);
                    fetchAirportFreq(depIcao, null, null).finally(() => updatePopupFrequencyBlock('wxPopupDepFreq', depIcao));
                }
                if (depIcao && typeof loadMetarWidget === 'function') {
                    loadMetarWidget(depIcao, 'wxPopupDep', latlng.lat, latlng.lng || latlng.lon, true);
                }
            });
        } else if (isDest) {
            marker.bindPopup('');
            marker.on('popupopen', () => {
                const icao = currentMissionData && currentMissionData.poiName ? currentStartICAO : currentDestICAO;
                const elev = currentMissionData && currentMissionData.poiName ? currentDepElev : currentDestElev;
                const destCountry = getAirportCountryCode(icao);
                marker.getPopup().setContent(_buildAptPopup('DEST', currentDName, elev, icao, {
                    runwayContainerId: 'wxPopupDestRwy',
                    freqContainerId: 'wxPopupDestFreq',
                    countryCode: destCountry,
                    showDirectTo: Boolean(icao && icao !== currentDestICAO),
                    directToName: currentDName,
                    lat: latlng.lat,
                    lon: latlng.lng || latlng.lon
                }));
                marker.getPopup().update();
                if (icao) setTimeout(() => refreshAipOverlayPopupUi(icao), 0);
                if (icao && typeof fetchRunwayDetails === 'function') {
                    fetchRunwayDetails(latlng.lat, latlng.lng || latlng.lon, 'wxPopupDestRwy', icao);
                }
                if (icao && icao !== 'GPS' && typeof fetchAirportFreq === 'function') {
                    updatePopupFrequencyBlock('wxPopupDestFreq', icao);
                    fetchAirportFreq(icao, null, null).finally(() => updatePopupFrequencyBlock('wxPopupDestFreq', icao));
                }
                if (icao && typeof loadMetarWidget === 'function') {
                    loadMetarWidget(icao, 'wxPopupDest', latlng.lat, latlng.lng || latlng.lon, true);
                }
            });
        } else if (isPOI) {
            // POIs bekommen ein spezielles lila Popup ohne Löschen-Button (da es das Missionsziel ist)
            marker.bindPopup(`<div style="text-align:center; color:#b266ff;"><b>${routeWaypoints[index].name}</b></div>`);
        } else {
            let wpName = routeWaypoints[index].name ? `<b>${routeWaypoints[index].name}</b>` : `<b>Wegpunkt</b>`;
            const wpAirport = findNearestAirport(L.latLng(latlng.lat, latlng.lng || latlng.lon), getAirportTapRadiusPx(18));
            const infoBtn = wpAirport
                ? `<button onclick="openRouteWaypointAirportInfo(${index})" style="margin-top:5px; margin-right:4px; background:#235ea7; color:#fff; border:none; padding:4px 8px; cursor:pointer; border-radius:2px;">ℹ️ Info</button>`
                : '';
            marker.bindPopup(
                `<div style="text-align:center;">${wpName}<br>${infoBtn}<button onclick="removeRouteWaypoint(${index})" style="margin-top:5px; background:#d93829; color:#fff; border:none; padding:4px 8px; cursor:pointer; border-radius:2px;">🗑️ Löschen</button></div>`
            );
        }

        if (draggable) {
            marker.on('drag', function (e) {
                if (snapMode && cachedNavData.length > 0) {
                    let mousePoint = map.latLngToLayerPoint(e.latlng);
                    let closest = null;
                    let bestScore = -1;

                    cachedNavData.forEach(nav => {
                        let navPoint = map.latLngToLayerPoint([nav.lat, nav.lng]);
                        let d = mousePoint.distanceTo(navPoint);
                        if (d < 25) {
                            let score = 25 - d;
                            // PRIORITÄT: VORs und Airports gewinnen bei Überlappung
                            if (nav.name.includes('APT ')) score += 100;
                            else if (nav.name.includes('[')) score += 50;

                            if (score > bestScore) {
                                bestScore = score;
                                closest = nav;
                            }
                        }
                    });

                    if (closest) marker.setLatLng([closest.lat, closest.lng]);
                    else marker.setLatLng(e.latlng);
                }
            });

        marker.on('drag', function (e) {
            if (polyline) {
                const latlngs = polyline.getLatLngs();
                latlngs[index] = marker.getLatLng();
                polyline.setLatLngs(latlngs);
                if (typeof window.hitBoxPolyline !== 'undefined' && window.hitBoxPolyline) {
                    window.hitBoxPolyline.setLatLngs(latlngs);
                }
                if (typeof updateWeatherMarkerDodging === 'function') updateWeatherMarkerDodging();
            }
        });

            marker.on('dragend', function (e) {
                let dropLatLng = marker.getLatLng();
                const origLatLng = { lat: routeWaypoints[index].lat, lng: routeWaypoints[index].lng || routeWaypoints[index].lon };

                // === NEU: SPEZIELLE POI LOGIK (Auto-Name & Fallback) ===
                if (isPOI) {
                    if (confirm("Möchtest du das Ziel für den Rundflug an diese Position verschieben?")) {
                        
                        const mDestName = document.getElementById("mDestName");
                        if (mDestName) mDestName.innerText = "Ermittle Ort...";
                        
                        setTimeout(async () => {
                            let newName = "Neuer Wendepunkt";
                            
                            // 1. Ort via Wikipedia (Geosearch) ermitteln
                            try {
                                const geoRes = await fetch(`https://de.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${dropLatLng.lat}|${dropLatLng.lng}&gsradius=10000&gslimit=1&format=json&origin=*`);
                                const geoData = await geoRes.json();
                                if (geoData?.query?.geosearch?.length > 0) {
                                    newName = geoData.query.geosearch[0].title;
                                } else {
                                    // Fallback auf Nominatim (OSM) wenn kein Wiki-Artikel in der Nähe ist
                                    const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${dropLatLng.lat}&lon=${dropLatLng.lng}&zoom=10`);
                                    const nomData = await nomRes.json();
                                    if (nomData && nomData.name) newName = nomData.name;
                                }
                            } catch(e) {}
                            
                            // 2. POI aktualisieren
                            routeWaypoints[index].lat = dropLatLng.lat;
                            routeWaypoints[index].lng = dropLatLng.lng;
                            routeWaypoints[index].name = "🎯 " + newName;
                            
                            if (typeof currentMissionData !== 'undefined' && currentMissionData) {
                                currentMissionData.poiName = newName;
                            }
                            
                            // 3. Das dynamische Dreieck anpassen
                            const returnNav = calcNav(dropLatLng.lat, dropLatLng.lng, routeWaypoints[0].lat, routeWaypoints[0].lng || routeWaypoints[0].lon);
                            const offsetBearing = (returnNav.brng + 20) % 360;
                            const returnWp = getDestinationPoint(dropLatLng.lat, dropLatLng.lng, returnNav.dist * 0.45, offsetBearing);
                            
                            if (routeWaypoints.length > 2) {
                                routeWaypoints[2].lat = returnWp.lat;
                                routeWaypoints[2].lng = returnWp.lon;
                            }

                            // 4. UI aktualisieren
                            if (mDestName) mDestName.innerText = newName;
                            const wikiDestNameEl = document.getElementById('wikiDestNameDisplay');
                            if (wikiDestNameEl) wikiDestNameEl.innerText = `POI – ${newName}`;
                            
                            // 5. Wiki-Daten live laden
                            if (typeof fetchAreaDescription === 'function') {
                                const descEl = document.getElementById("wikiDestDescText");
                                if (descEl) descEl.innerText = "Lade neue Ziel-Info...";
                                fetchAreaDescription(dropLatLng.lat, dropLatLng.lng, 'wikiDestDescText', newName, null, 'wikiDestImageContainer', 'wikiDestImage');
                            }

                            // 6. KI-Briefing Story umschreiben (Live Dispatch)
                            renderMainRoute(); // Aktualisiert die Distanzen im Hintergrund
                            
                            const paxText = document.getElementById("mPay") ? document.getElementById("mPay").innerText : "0 PAX";
                            const cargoText = document.getElementById("mWeight") ? document.getElementById("mWeight").innerText : "0 lbs";
                            const totalDist = currentMissionData.dist;
                            
                            const titleEl = document.getElementById("mTitle");
                            const storyEl = document.getElementById("mStory");
                            
                            if (titleEl) titleEl.innerHTML = "🔄 Auftrag wird umgeschrieben...";
                            if (storyEl) storyEl.innerText = "Dispatcher passt die Story an das neue Ziel an...";
                            
                            // Die Gemini-Funktion gibt intern sofort 'null' zurück, wenn API aus/offline ist
                            let m = await fetchGeminiMission(currentSName, newName, totalDist, true, paxText, cargoText);
                            
                            if (m) {
                                if (titleEl) titleEl.innerHTML = `${m.i ? m.i + ' ' : ''}${m.t}`;
                                if (storyEl) storyEl.innerText = m.s;
                                currentMissionData.mission = m.t;
                            } else {
                                // Offline / Fallback Modus aus der lokalen Datenbank
                                let fallbackM;
                                if (typeof generateDynamicPOIMission === 'function') {
                                    const maxSeats = parseInt(document.getElementById("maxSeats")?.value || 4);
                                    fallbackM = generateDynamicPOIMission(newName, maxSeats);
                                    
                                    // Aktualisiert auch die Passagiere und Fracht passend zur Offline-Story
                                    if (document.getElementById("mPay")) document.getElementById("mPay").innerText = fallbackM.payloadText || paxText;
                                    if (document.getElementById("mWeight")) document.getElementById("mWeight").innerText = fallbackM.cargoText || cargoText;
                                } else if (typeof missions !== 'undefined') {
                                    fallbackM = missions[Math.floor(Math.random() * missions.length)];
                                } else {
                                    fallbackM = { t: "Privater Rundflug", s: `Umgeleiteter Flugpunkt: ${newName}`, i: "📋" };
                                }
                                
                                if (titleEl) titleEl.innerHTML = `${fallbackM.i ? fallbackM.i + ' ' : '📋 '}${fallbackM.t}`;
                                if (storyEl) storyEl.innerText = fallbackM.s;
                                currentMissionData.mission = fallbackM.t;
                            }
                            
                            window.debouncedSaveMissionState();
                        }, 50);

                        return;
                    } else {
                        // Abbruch: Marker schnipst an Original-Position zurück
                        routeWaypoints[index].lat = origLatLng.lat;
                        routeWaypoints[index].lng = origLatLng.lng;
                    }
                    renderMainRoute();
                    return;
                }
                // === ENDE POI LOGIK ===

                if (snapMode && cachedNavData.length > 0) {
                    let mousePoint = map.latLngToLayerPoint(dropLatLng);
                    let closest = null;
                    let bestScore = -1;

                    cachedNavData.forEach(nav => {
                        let navPoint = map.latLngToLayerPoint([nav.lat, nav.lng]);
                        let d = mousePoint.distanceTo(navPoint);
                        if (d < 25) {
                            let score = 25 - d;
                            if (nav.name.includes('APT ')) score += 100;
                            else if (nav.name.includes('[')) score += 50;

                            if (score > bestScore) {
                                bestScore = score;
                                closest = nav;
                            }
                        }
                    });

                    if (closest) {
                        routeWaypoints[index].lat = closest.lat;
                        routeWaypoints[index].lng = closest.lng;
                        routeWaypoints[index].name = closest.name;
                        routeWaypoints[index].rppAirportIcao = closest.rppAirportIcao || '';
                    } else {
                        routeWaypoints[index].lat = dropLatLng.lat;
                        routeWaypoints[index].lng = dropLatLng.lng;
                        routeWaypoints[index].name = null;
                        routeWaypoints[index].rppAirportIcao = '';
                    }
                } else {
                    routeWaypoints[index].lat = dropLatLng.lat;
                    routeWaypoints[index].lng = dropLatLng.lng;
                    routeWaypoints[index].name = null;
                    routeWaypoints[index].rppAirportIcao = '';
                }
                renderMainRoute();
            });
        }
        routeMarkers.push(marker);
    });

    renderRouteLegLabels();
    const hasMissionContext = !!currentMissionData;
    updateRoutePerformance(); updateMiniMap();
    if (!hasMissionContext && routeWaypoints.length >= 2 && typeof triggerVerticalProfileUpdate === 'function') {
        triggerVerticalProfileUpdate();
    }
    if (typeof updateWeatherMarkerDodging === 'function') updateWeatherMarkerDodging();
}

window.openRouteWaypointAirportInfo = function (index) {
    if (!map || !Array.isArray(routeWaypoints)) return;
    const wp = routeWaypoints[index];
    if (!wp) return;
    const latlng = L.latLng(wp.lat, wp.lng || wp.lon);
    const apt = findNearestAirport(latlng, getAirportTapRadiusPx(18));
    if (!apt) return;
    openAirportInfoPopup(apt, latlng);
};

function findNearestEditableWaypoint(latlng, maxPixels = 28) {
    if (!map || !Array.isArray(routeWaypoints) || routeWaypoints.length < 3) return null;
    const tapPx = map.latLngToLayerPoint(latlng);
    let bestIndex = -1;
    let bestDist = maxPixels + 1;
    for (let i = 1; i < routeWaypoints.length - 1; i++) {
        const wp = routeWaypoints[i];
        if (!wp || wp.isPOI) continue;
        const wpPx = map.latLngToLayerPoint([wp.lat, wp.lng || wp.lon]);
        const d = tapPx.distanceTo(wpPx);
        if (d < bestDist) {
            bestDist = d;
            bestIndex = i;
        }
    }
    return bestIndex >= 0 ? bestIndex : null;
}

function _buildAptPopup(label, name, elev, icaoForRunways, options = {}) {
    const rwCacheKey = icaoForRunways || (label === 'DEP' ? currentStartICAO : currentDestICAO);
    const wxContainerId = options.wxContainerId || (label === 'DEP' ? 'wxPopupDep' : 'wxPopupDest');
    const runwayContainerId = options.runwayContainerId || null;
    const freqContainerId = options.freqContainerId || null;
    const countryCode = options.countryCode || '';
    const titleHtml = options.title || `<b style="font-size:13px;">${label}: ${name || '–'}</b>`;
    const showDirectTo = Boolean(options.showDirectTo && icaoForRunways && Number.isFinite(options.lat) && Number.isFinite(options.lon));
    const aipUrl = icaoForRunways ? getAipPopupUrl(icaoForRunways, countryCode) : null;
    const showAip = Boolean(aipUrl);
    const icaoSafe = sanitizeAipIcaoKey(icaoForRunways || '');
    const icaoEsc = escapeJsSingleQuoted(icaoSafe);
    const countryEsc = escapeJsSingleQuoted(String(countryCode || '').toUpperCase());
    const opacityPct = Math.round(getAipCurrentOpacity(icaoSafe) * 100);
    let html = `<div style="font-family:'Courier New',monospace; min-width:190px; color:#111;">`;
    html += titleHtml;

    if (elev != null) {
        const elevRnd = Math.round(elev);
        const tpa = elevRnd + 1000;
        html += `<hr style="border-color:#ccc; margin:5px 0;">`;
        html += `<div style="font-size:11px; line-height:1.7;">`;
        html += `📍 Platz: <b>${elevRnd} ft MSL</b><br>`;
        html += `🔄 Platzrunde: <b>~${tpa} ft MSL</b>`;
        html += `</div>`;
    }

    const runwayHtml = (() => {
        if (!rwCacheKey || typeof runwayCache === 'undefined' || !runwayCache[rwCacheKey] || runwayCache[rwCacheKey] === 'Keine Daten gefunden') {
            return runwayContainerId
                ? `<div id="${runwayContainerId}" style="font-size:11px; line-height:1.7; color:#666;">Pisten laden…</div>`
                : '';
        }

        const rwys = runwayCache[rwCacheKey]
            .split(/\s*(?:\||\n|<br\s*\/?>)\s*/i)
            .filter(r => r.trim());

        if (rwys.length === 0) return '';
        const lines = `🛫 Pisten:<br>` + rwys.map(r => `&nbsp;&nbsp;${r}`).join('<br>');
        return runwayContainerId
            ? `<div id="${runwayContainerId}" style="font-size:11px; line-height:1.7;">${lines}</div>`
            : `<div style="font-size:11px; line-height:1.7;">${lines}</div>`;
    })();

    if (runwayHtml) {
        html += `<hr style="border-color:#ccc; margin:5px 0;">`;
        html += runwayHtml;
    }

    if (icaoForRunways) {
        html += `<hr style="border-color:#ccc; margin:5px 0;">`;
        const freqBody = buildPopupFrequencyLines(icaoForRunways);
        html += freqContainerId
            ? `<div id="${freqContainerId}" style="font-size:11px; line-height:1.6;">${freqBody}</div>`
            : `<div style="font-size:11px; line-height:1.6;">${freqBody}</div>`;
    }

    if (showAip) {
        html += `<hr style="border-color:#ccc; margin:5px 0;">`;
        html += `<a href="${aipUrl}" target="_blank" rel="noopener noreferrer" style="display:block; font-size:11px; text-decoration:none; color:#0b1f65; font-weight:bold;">📄 AIP VFR öffnen ↗</a>`;
        if (AIP_CHART_UI_ENABLED) {
            html += `<div style="margin-top:6px; border:1px solid #ddd; border-radius:5px; padding:6px; background:#f8f8f8;">`;
            html += `<div class="aip-overlay-status" data-aip-icao="${icaoSafe}" style="font-size:10px; color:#444; margin-bottom:6px;">Overlay aus</div>`;
            html += `<button onclick="window.loadAipChartOverlay('${icaoEsc}','${countryEsc}')" style="display:block; width:100%; background:#235ea7; color:#fff; border:none; padding:6px 8px; cursor:pointer; border-radius:3px; font-size:11px; margin-bottom:4px;">🗺️ Overlay laden</button>`;
            html += `<button class="aip-calibrate-btn" data-aip-icao="${icaoSafe}" onclick="window.startAipChartCalibration('${icaoEsc}')" style="display:block; width:100%; background:#7c4d9e; color:#fff; border:none; padding:6px 8px; cursor:pointer; border-radius:3px; font-size:11px; margin-bottom:6px;">🎯 Kalibrieren (2 Punkte)</button>`;
            html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">`;
            html += `<span style="font-size:10px; color:#555; min-width:64px;">Transparenz</span>`;
            html += `<input class="aip-opacity-slider" data-aip-icao="${icaoSafe}" type="range" min="15" max="100" value="${opacityPct}" oninput="window.setAipChartOpacity(this.value, '${icaoEsc}'); this.nextElementSibling.textContent=this.value+'%';" style="flex:1;">`;
            html += `<span class="aip-opacity-value" data-aip-icao="${icaoSafe}" style="font-size:10px; color:#222; min-width:34px; text-align:right;">${opacityPct}%</span>`;
            html += `</div>`;
            html += `<button onclick="window.clearAipChartOverlay()" style="display:block; width:100%; background:#666; color:#fff; border:none; padding:5px 8px; cursor:pointer; border-radius:3px; font-size:10px;">Overlay aus</button>`;
            html += `</div>`;
        }
    }

    html += `<hr style="border-color:#ccc; margin:5px 0;">`;
    html += `<div id="${wxContainerId}" style="min-height:36px;">`;
    html += `<div style="font-size:10px; color:#aaa; text-align:center; padding:8px 0;">Wetter lädt…</div>`;
    html += `</div>`;

    if (showDirectTo) {
        const encodedName = encodeURIComponent(options.directToName || name || icaoForRunways);
        html += `<button onclick="window.confirmAirportDirectTo('${icaoForRunways}', ${Number(options.lat)}, ${Number(options.lon)}, '${encodedName}')" style="margin-top:8px; width:100%; background:#1f7a45; color:#fff; border:none; padding:8px 10px; cursor:pointer; border-radius:4px; font-weight:bold;">✈️ Direct To</button>`;
    }

    html += `</div>`;
    return html;
}

function getAirportDisplayName(apt) {
    return apt?.name || apt?.n || apt?.city || apt?.icao || 'Flugplatz';
}

function normalizeAirportForMap(apt) {
    if (!apt) return null;
    return {
        icao: apt.icao || apt.ident || '',
        name: getAirportDisplayName(apt),
        lat: Number(apt.lat),
        lon: Number(apt.lon ?? apt.lng),
        elevation: apt.elevation ?? null,
        country: apt.country || apt.iso_country || apt.cc || ''
    };
}

function openAirportInfoPopup(airport, latlng = null) {
    if (!map) return;
    const apt = normalizeAirportForMap(airport);
    if (!apt || !apt.icao || !Number.isFinite(apt.lat) || !Number.isFinite(apt.lon)) return;

    const popupLatLng = latlng || [apt.lat, apt.lon];
    const popupIdSafe = apt.icao.replace(/[^a-zA-Z0-9_-]/g, '_');
    const runwayId = `wxRwy_${popupIdSafe}`;
    const freqId = `wxFreq_${popupIdSafe}`;
    // Prefix "wxPopup" erzwingt im Widget die gleiche kompakte Start/Ziel-Darstellung
    const wxId = `wxPopupApt_${popupIdSafe}`;
    const elev = apt.elevation ?? (globalAirports?.[apt.icao]?.elevation ?? null);
    const countryCode = getAirportCountryCode(apt.icao, apt.country);
    const title = `<b style="font-size:13px;">${apt.icao}</b><div style="font-size:11px; color:#555; margin-top:2px;">${apt.name}</div>`;

    const html = _buildAptPopup('APT', apt.name, elev, apt.icao, {
        title,
        wxContainerId: wxId,
        runwayContainerId: runwayId,
        freqContainerId: freqId,
        countryCode,
        showDirectTo: true,
        directToName: apt.name,
        lat: apt.lat,
        lon: apt.lon
    });

    L.popup({ maxWidth: 290 })
        .setLatLng(popupLatLng)
        .setContent(html)
        .openOn(map);
    setTimeout(() => refreshAipOverlayPopupUi(apt.icao), 0);

    if (typeof fetchRunwayDetails === 'function') {
        fetchRunwayDetails(apt.lat, apt.lon, runwayId, apt.icao);
    }
    if (typeof fetchAirportFreq === 'function') {
        updatePopupFrequencyBlock(freqId, apt.icao);
        fetchAirportFreq(apt.icao, null, null).finally(() => updatePopupFrequencyBlock(freqId, apt.icao));
    }
    if (typeof loadMetarWidget === 'function') {
        loadMetarWidget(apt.icao, wxId, apt.lat, apt.lon, true);
    }
}

function hasActiveBriefingRoute() {
    const briefingBox = document.getElementById('briefingBox');
    return Boolean(briefingBox && briefingBox.style.display === 'block' && routeWaypoints && routeWaypoints.length > 0);
}

function getTasForRouteEstimate() {
    return parseInt(document.getElementById('tasSlider')?.value || 160, 10) || 160;
}

function renderGpsStartBriefing(destAirport, startPoint) {
    const nav = calcNav(startPoint.lat, startPoint.lng, destAirport.lat, destAirport.lon);
    const tas = getTasForRouteEstimate();
    const eteMinutes = Math.max(1, Math.round((nav.dist / Math.max(1, tas)) * 60));
    const depLinks = document.getElementById('wikiDepLinks');
    const destLinks = document.getElementById('wikiDestLinks');
    const destSwitchRow = document.getElementById('destSwitchRow');

    document.getElementById('mTitle').innerHTML = '🧭 Direct To';
    document.getElementById('mStory').innerText = `Direktflug per Karte zu ${destAirport.icao}${destAirport.name ? ' – ' + destAirport.name : ''}. Start ist die aktuelle GPS-Position des Trackers.`;
    document.getElementById('mDepICAO').innerText = 'GPS';
    document.getElementById('mDepName').innerText = 'Live GPS Position';
    document.getElementById('mDepCoords').innerText = `${startPoint.lat.toFixed(4)}, ${startPoint.lng.toFixed(4)}`;
    document.getElementById('mDepRwy').innerText = 'Live-Start';
    document.getElementById('destIcon').innerText = '🛬';
    document.getElementById('mDestICAO').innerText = destAirport.icao;
    document.getElementById('mDestName').innerText = destAirport.name;
    document.getElementById('mDestCoords').innerText = `${destAirport.lat.toFixed(4)}, ${destAirport.lon.toFixed(4)}`;
    document.getElementById('mPay').innerText = 'N/A';
    document.getElementById('mWeight').innerText = 'N/A';
    document.getElementById('mDistNote').innerText = `${formatNm(nav.dist)} NM`;
    document.getElementById('mHeadingNote').innerText = `${nav.brng}°`;
    document.getElementById('mETENote').innerText = `${eteMinutes} min`;
    if (typeof setDrumCounter === 'function') setDrumCounter('distDrum', parseFloat(formatNm(nav.dist)));
    if (typeof recalculatePerformance === 'function') recalculatePerformance();
    const indicator = document.getElementById('searchIndicator');
    if (indicator) indicator.innerText = 'Direct-To Flug bereit.';
    document.getElementById('briefingBox').style.display = 'block';
    document.getElementById('destRwyContainer').style.display = 'block';
    if (document.getElementById('wikiDestRwyText')) document.getElementById('wikiDestRwyText').style.display = 'block';
    if (destSwitchRow) destSwitchRow.style.display = 'flex';
    if (depLinks) depLinks.style.display = 'none';
    if (destLinks) destLinks.style.display = 'block';

    const wikiDepNameEl = document.getElementById('wikiDepNameDisplay');
    const wikiDestNameEl = document.getElementById('wikiDestNameDisplay');
    if (wikiDepNameEl) wikiDepNameEl.innerText = 'GPS – Live Position';
    if (wikiDestNameEl) wikiDestNameEl.innerText = `${destAirport.icao} – ${destAirport.name}`;

    const depFreq = document.getElementById('wikiDepFreqText');
    const destFreq = document.getElementById('wikiDestFreqText');
    if (depFreq) depFreq.innerHTML = '<span style="color:#888;">Live GPS Start</span>';
    if (destFreq) destFreq.innerHTML = 'Lade Frequenzen...';

    const depDesc = document.getElementById('wikiDepDescText');
    const destDesc = document.getElementById('wikiDestDescText');
    if (depDesc) depDesc.innerText = 'Live-Startpunkt vom Tracker. Umgebung wird geladen...';
    if (destDesc) destDesc.innerText = 'Ziel-Informationen werden geladen...';

    if (typeof fetchAreaDescription === 'function') {
        fetchAreaDescription(startPoint.lat, startPoint.lng, 'wikiDepDescText', 'Live GPS Position', null, 'wikiDepImageContainer', 'wikiDepImage');
        fetchAreaDescription(destAirport.lat, destAirport.lon, 'wikiDestDescText', null, destAirport.icao, 'wikiDestImageContainer', 'wikiDestImage');
    }
    if (typeof fetchAirportFreq === 'function') {
        fetchAirportFreq(destAirport.icao, 'wikiDestFreqText', 'dest');
    }
    if (typeof fetchRunwayDetails === 'function') {
        fetchRunwayDetails(destAirport.lat, destAirport.lon, 'mDestRwy', destAirport.icao);
    }
    if (typeof loadMetarWidget === 'function') {
        loadMetarWidget(null, 'metarContainerDep', startPoint.lat, startPoint.lng);
        loadMetarWidget(destAirport.icao, 'metarContainerDest', destAirport.lat, destAirport.lon);
    }
}

async function applyAirportDirectTo(airport, options = {}) {
    const destAirport = normalizeAirportForMap(airport);
    if (!destAirport || !destAirport.icao || !Number.isFinite(destAirport.lat) || !Number.isFinite(destAirport.lon)) return false;

    const forceGpsStart = Boolean(options.forceGpsStart);
    const hadFlightPlan = hasActiveBriefingRoute();
    const useExistingStart = hadFlightPlan && !forceGpsStart;
    const gpsLive = isGpsLive();
    let startPoint = null;
    let startData = null;

    if (useExistingStart) {
        const firstWp = routeWaypoints[0];
        startPoint = { lat: firstWp.lat, lng: firstWp.lng || firstWp.lon };
        if (currentStartICAO && currentStartICAO !== 'GPS' && typeof getAirportData === 'function') {
            startData = await getAirportData(currentStartICAO);
        }
    } else if (gpsLive && window.lastLiveGpsPos) {
        startPoint = { lat: window.lastLiveGpsPos.lat, lng: window.lastLiveGpsPos.lon };
    } else {
        alert('Ohne bestehenden Flugplan brauche ich eine aktive Tracker-Verbindung, damit die aktuelle GPS-Position als Start gesetzt werden kann.');
        return false;
    }

    const nav = calcNav(startPoint.lat, startPoint.lng, destAirport.lat, destAirport.lon);
    routeWaypoints = [
        { lat: startPoint.lat, lng: startPoint.lng },
        { lat: destAirport.lat, lng: destAirport.lon }
    ];

    currentDestICAO = destAirport.icao;
    currentDName = destAirport.name;
    currentDestElev = destAirport.elevation ?? (globalAirports?.[destAirport.icao]?.elevation ?? null);

    if (useExistingStart) {
        currentSName = startData?.n || currentSName || currentStartICAO || 'Start';
        currentDepElev = currentStartICAO && globalAirports?.[currentStartICAO]
            ? (globalAirports[currentStartICAO].elevation ?? null)
            : currentDepElev;
    } else {
        currentStartICAO = 'GPS';
        currentSName = 'Live GPS Position';
        currentDepElev = null;
    }

    currentMissionData = {
        start: currentStartICAO || 'GPS',
        dest: currentDestICAO,
        poiName: null,
        mission: 'Direct To',
        dist: nav.dist,
        ac: typeof selectedAC !== 'undefined' ? selectedAC : 'N/A',
        heading: nav.brng
    };
    currentDepFreq = '';
    currentDestFreq = '';

    const startLocEl = document.getElementById('startLoc');
    const startLocRadioEl = document.getElementById('startLocRadio');
    const destLocEl = document.getElementById('destLoc');
    const destLocRadioEl = document.getElementById('destLocRadio');
    if (startLocEl) startLocEl.value = currentStartICAO === 'GPS' ? '' : (currentStartICAO || '');
    if (startLocRadioEl) startLocRadioEl.value = currentStartICAO === 'GPS' ? 'GPS' : (currentStartICAO || '');
    if (destLocEl) destLocEl.value = currentDestICAO || '';
    if (destLocRadioEl) destLocRadioEl.value = currentDestICAO || '';

    if (useExistingStart && typeof populateBriefingUI === 'function') {
        const title = '🧭 Ziel geändert';
        const story = `Das Ziel wurde per Karte auf ${destAirport.icao}${destAirport.name ? ' – ' + destAirport.name : ''} gesetzt. Der bisherige Startplatz bleibt erhalten.`;
        const pax = document.getElementById('mPay')?.innerText || 'N/A';
        const cargo = document.getElementById('mWeight')?.innerText || 'N/A';
        const destData = { icao: destAirport.icao, n: destAirport.name, lat: destAirport.lat, lon: destAirport.lon };
        currentMissionData.mission = 'Ziel geändert';
        populateBriefingUI(title, story, pax, cargo, false, routeWaypoints, startData, destData);
    } else {
        renderGpsStartBriefing(destAirport, startPoint);
        renderMainRoute();
        if (map) {
            const bounds = L.latLngBounds(routeWaypoints.map(w => [w.lat, w.lng || w.lon]));
            map.fitBounds(bounds, { padding: [60, 60] });
        }
        if (typeof updateMiniMap === 'function') updateMiniMap();
        if (typeof triggerVerticalProfileUpdate === 'function') triggerVerticalProfileUpdate();
        if (typeof refreshGPSAfterDispatch === 'function') refreshGPSAfterDispatch();
        if (typeof window.debouncedSaveMissionState === 'function') window.debouncedSaveMissionState();
    }

    if (useExistingStart && typeof refreshGPSAfterDispatch === 'function') refreshGPSAfterDispatch();

    showMapToast('Direct to ' + destAirport.icao);
    return true;
}

window.confirmAirportDirectTo = async function(icao, lat, lon, encodedName = '') {
    const name = encodedName ? decodeURIComponent(encodedName) : icao;
    if (!confirm(`${icao} als Ziel übernehmen?`)) return false;

    // Wenn Live-GPS vorhanden ist, wird automatisch GPS als Start priorisiert.
    const forceGpsStart = isGpsLive();
    return applyAirportDirectTo({ icao, name, lat, lon }, { forceGpsStart });
};

function updateRoutePerformance() {
    if (routeWaypoints.length < 2 || !currentMissionData) return;
    let totalNM = 0, wpHTML = '';
    const tas = parseInt(document.getElementById("tasSlider").value) || 160;
    const gph = parseInt(document.getElementById("gphSlider").value) || 14;

    let totalTime = 0;
    let totalFuel = 0;

    let blHTML = '<table style="width:100%; border-collapse:collapse; text-align:left; font-size:14px; font-family:\'Courier New\', monospace; font-weight:bold; color:var(--navlog-text); margin-top:5px;">';
    blHTML += '<colgroup><col style="width:30%;"><col style="width:20%;"><col style="width:16%;"><col style="width:10%;"><col style="width:10%;"><col style="width:14%;"></colgroup>';
    blHTML += '<tr style="border-bottom:2px solid var(--navlog-border); color:var(--navlog-heading);"><th>Route</th><th>FREQ</th><th>HDG</th><th>NM</th><th>Min</th><th>Gal</th></tr>';

    for (let i = 0; i < routeWaypoints.length - 1; i++) {
        let p1 = routeWaypoints[i], p2 = routeWaypoints[i + 1], nav = calcNav(p1.lat, p1.lng || p1.lon, p2.lat, p2.lng || p2.lon);
        totalNM += nav.dist;

        let isStart = (i === 0);
        let isEnd = (i === routeWaypoints.length - 2);

        let name1 = isStart ? currentStartICAO : (routeWaypoints[i].name || `WP ${i}`);
        
        let name2;
        if (isEnd) {
            // Bei einem Rundflug (POI-Mission) ist das Endziel der Startplatz
            name2 = (currentMissionData && currentMissionData.poiName) ? currentStartICAO : currentDestICAO;
        } else {
            name2 = routeWaypoints[i + 1].name || `WP ${i + 1}`;
        }

        let cleanName1 = name1.replace(/^RPP\s+/i, '').replace(/^APT\s+/i, '');
        let cleanName2 = name2.replace(/^RPP\s+/i, '').replace(/^APT\s+/i, '');

        // Frequenz aus Namen extrahieren
        let f1 = "";
        let m1 = cleanName1.match(/\(([^)]+)\)/);
        if (m1) { f1 = m1[1]; cleanName1 = cleanName1.replace(/\s*\([^)]+\)/, ''); }
        else if (isStart && currentDepFreq) { f1 = currentDepFreq; }

        let f2 = "";
        let m2 = cleanName2.match(/\(([^)]+)\)/);
        if (m2) { f2 = m2[1]; cleanName2 = cleanName2.replace(/\s*\([^)]+\)/, ''); }
        else if (isEnd && currentDestFreq) { f2 = currentDestFreq; }

        // VOR Klammern erhalten - nur Kennung nutzen wenn vorhanden
        let v1 = cleanName1.match(/\[([^\]]+)\]/);
        let isV1 = !!v1;
        if (v1) cleanName1 = `[${v1[1].trim().split(/\s+/)[0]}]`;
        else cleanName1 = cleanName1.trim();

        let v2 = cleanName2.match(/\[([^\]]+)\]/);
        let isV2 = !!v2;
        if (v2) cleanName2 = `[${v2[1].trim().split(/\s+/)[0]}]`;
        else cleanName2 = cleanName2.trim();

        let legTime = Math.round((nav.dist / tas) * 60);
        let legFuel = parseFloat((nav.dist / tas * gph).toFixed(1));

        totalTime += legTime;
        totalFuel += legFuel;

        const c1 = isV1 ? 'var(--navlog-text)' : 'var(--navlog-freq)';
        const c2 = isV2 ? 'var(--navlog-text)' : 'var(--navlog-freq)';

        blHTML += `<tr style="border-bottom:1px dashed var(--navlog-border);">`;
        blHTML += `<td style="padding:8px 0 8px 8px; color:var(--navlog-text); line-height: 1.4;"><span style="display:inline-block; min-width:20px; text-align:right;">${i + 1}.</span> ${cleanName1}<br><span style="display:inline-block; min-width:20px; text-align:left;">➔</span> ${cleanName2}</td>`;
        blHTML += `<td style="padding:8px 0 8px 4px; font-size:14px; line-height: 1.6;"><span style="color:${c1}">${f1}</span><br><span style="color:${c2}">${f2}</span></td>`;
        blHTML += `<td style="padding:8px 0 8px 16px; color:var(--navlog-data); vertical-align:middle;">${nav.brng}°</td>`;
        blHTML += `<td style="padding:8px 0; color:var(--navlog-data); vertical-align:middle;">${formatNm(nav.dist)}</td>`;
        blHTML += `<td style="padding:8px 0; color:var(--navlog-data); vertical-align:middle;">${legTime}</td>`;
        blHTML += `<td style="padding:8px 0; color:var(--navlog-data); vertical-align:middle;">${legFuel.toFixed(1)}</td>`;
        blHTML += `</tr>`;

        wpHTML += `<div class="wp-row"><span class="wp-name">${cleanName1.replace(/<[^>]+>/g, '').trim()} ➔ ${cleanName2.replace(/<[^>]+>/g, '').trim()}</span><span class="wp-data">${nav.brng}° | ${formatNm(nav.dist)} NM</span></div>`;
    }

    const totalNmDisplay = formatNm(totalNM);
    blHTML += `<tr style="border-top:2px solid var(--navlog-border); color:var(--navlog-heading); font-size:15px;"><td style="padding-top:8px;">TOTAL</td><td style="padding-top:8px;"></td><td style="padding-top:8px;"></td><td style="padding-top:8px;">${totalNmDisplay}</td><td style="padding-top:8px;">${totalTime}</td><td style="padding-top:8px;">${totalFuel.toFixed(1)}</td></tr>`;
    blHTML += '</table>';

    const blDiv = document.getElementById('briefingNavLog');
    if (blDiv) blDiv.innerHTML = blHTML;

    let initialNav = calcNav(routeWaypoints[0].lat, routeWaypoints[0].lng || routeWaypoints[0].lon, routeWaypoints[1].lat, routeWaypoints[1].lng || routeWaypoints[1].lon);

    if (currentMissionData) {
        currentMissionData.dist = parseFloat(totalNmDisplay);
        currentMissionData.heading = initialNav.brng;
    }

    setDrumCounter('distDrum', parseFloat(totalNmDisplay));
    const mHeadingNote = document.getElementById("mHeadingNote"); if (mHeadingNote) mHeadingNote.innerText = `${initialNav.brng}°`;
    const wpListContainer = document.getElementById("waypointList"); if (wpListContainer) wpListContainer.innerHTML = wpHTML;

    recalculatePerformance();
    const mDistNote = document.getElementById("mDistNote"); if (mDistNote) mDistNote.innerText = `${totalNmDisplay} NM`;
    const hrs = Math.floor(totalTime / 60), mins = totalTime % 60;
    const mETENote = document.getElementById("mETENote"); if (mETENote) mETENote.innerText = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} Min.`;

    // Trigger Airspace Check
    if (window.airspaceFetchTimeout) clearTimeout(window.airspaceFetchTimeout);
    window.airspaceFetchTimeout = setTimeout(() => {
        fetchRouteAirspaces(routeWaypoints);
    }, 800);

    // Trigger Vertical Profile Update
    triggerVerticalProfileUpdate();

    window.debouncedSaveMissionState();
    if (gpsState.visible && gpsState.mode === 'FPL') renderGPS();
}

function initMapBase() {
    if (map) return;
    const radarActive = localStorage.getItem('ga_radar_active') === 'true';
    
    // Base Maps
    const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: 'OpenTopoMap' });
    const topoLightMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
    const satMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
    const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: 'CartoDB' });
    const lightMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: 'CartoDB' });
    
    // Overlays
    const aeroOverlay = L.tileLayer('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', {
        attribution: 'AeroData / Navigraph', opacity: 0.65, maxNativeZoom: 12
    });
    
    // NEU: Die offizielle DFS ICAO 1:500.000 Karte vom Secais Server
    const dfsIcaoOverlay = L.tileLayer('https://secais.dfs.de/static-maps/icao500/tiles/{z}/{x}/{y}.png', {
        attribution: '© DFS Deutsche Flugsicherung', maxNativeZoom: 11, opacity: 1.0
    });

    topoMap.setOpacity(0.5);
    map = L.map('map', { layers: [topoMap, aeroOverlay], attributionControl: false }).setView([51.1657, 10.4515], 6);
    
    const baseMaps = {
        "⛰️ Topografie (Mit Text)": topoMap,
        "🗺️ Terrain (Ohne Text)": topoLightMap,
        "🛰️ Satellit": satMap,
        "🌑 Dark Mode (Clean)": darkMap,
        "📝 Blank Mode (Weiß)": lightMap
    };
    
    const radarOverlay = L.layerGroup();
    fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(res => res.json())
        .then(data => {
            if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
                const latestRadar = data.radar.past[data.radar.past.length - 1].path;
                L.tileLayer(`https://tilecache.rainviewer.com${latestRadar}/256/{z}/{x}/{y}/2/1_1.png`, {
                    opacity: 0.65, transparent: true, maxNativeZoom: 7, attribution: 'Radar © RainViewer'
                }).addTo(radarOverlay); if (radarActive) radarOverlay.addTo(map);
            }
        }).catch(e => console.warn('RainViewer Fetch Fehler:', e));
        
    const overlayMaps = {
        "🗺️ DFS ICAO Karte 1:500k": dfsIcaoOverlay,
        "🛩️ VFR Lufträume (Overlay)": aeroOverlay,
        "🌧️ Wetterradar (Niederschlag)": radarOverlay
    };
    
    const layerControl = L.control.layers(baseMaps, overlayMaps, { collapsed: true }).addTo(map);
    if (layerControl && layerControl._container) {
        const lc = layerControl._container;
        // Hover-Verhalten robust deaktivieren: Leaflet nutzt je nach Version
        // mouseover/mouseout oder mouseenter/mouseleave.
        const expandFn = (typeof layerControl.expand === 'function') ? layerControl.expand
            : ((typeof layerControl._expand === 'function') ? layerControl._expand : null);
        const collapseFn = (typeof layerControl.collapse === 'function') ? layerControl.collapse
            : ((typeof layerControl._collapse === 'function') ? layerControl._collapse : null);
        const origExpand = expandFn ? expandFn.bind(layerControl) : null;
        const origCollapse = collapseFn ? collapseFn.bind(layerControl) : null;

        // Harte Absicherung: Expand nur aus unserem Klick-Flow erlauben.
        layerControl._allowManualExpand = false;
        if (origExpand) {
            layerControl.expand = function() {
                if (!this._allowManualExpand) return this;
                return origExpand();
            };
            layerControl._expand = layerControl.expand;
        }
        if (origCollapse) {
            layerControl.collapse = function() {
                return origCollapse();
            };
            layerControl._collapse = layerControl.collapse;
        }
        if (expandFn) {
            L.DomEvent.off(lc, 'mouseover', expandFn, layerControl);
            L.DomEvent.off(lc, 'mouseenter', expandFn, layerControl);
            L.DomEvent.off(lc, 'pointerenter', expandFn, layerControl);
        }
        if (collapseFn) {
            L.DomEvent.off(lc, 'mouseout', collapseFn, layerControl);
            L.DomEvent.off(lc, 'mouseleave', collapseFn, layerControl);
            L.DomEvent.off(lc, 'pointerleave', collapseFn, layerControl);
        }

        const toggle = lc.querySelector('.leaflet-control-layers-toggle');
        if (toggle) {
            // Falls Touch-Click expand bereits von Leaflet gebunden ist, entfernen
            if (expandFn) {
                L.DomEvent.off(toggle, 'click', expandFn, layerControl);
                L.DomEvent.off(toggle, 'focus', expandFn, layerControl);
            }
            L.DomEvent.on(toggle, 'click', L.DomEvent.stop);
            L.DomEvent.on(toggle, 'click', () => {
                const isOpen = L.DomUtil.hasClass(lc, 'leaflet-control-layers-expanded');
                if (isOpen && typeof layerControl.collapse === 'function') {
                    layerControl.collapse();
                } else if (!isOpen && typeof layerControl.expand === 'function') {
                    layerControl._allowManualExpand = true;
                    layerControl.expand();
                    layerControl._allowManualExpand = false;
                }
            });
        }

        if (!map._layersOutsideCloseBound) {
            document.addEventListener('click', (e) => {
                const isOpen = L.DomUtil.hasClass(lc, 'leaflet-control-layers-expanded');
                if (!isOpen) return;
                if (lc.contains(e.target)) return;
                if (typeof layerControl.collapse === 'function') layerControl.collapse();
            }, true);
            map._layersOutsideCloseBound = true;
        }
    }
    
    map.on('overlayadd', function (e) {
        // Schaltet DFS ab, wenn VFR-Lufträume aktiviert werden
        if (e.name === "🛩️ VFR Lufträume (Overlay)") {
            if (typeof dfsIcaoOverlay !== 'undefined' && map.hasLayer(dfsIcaoOverlay)) map.removeLayer(dfsIcaoOverlay);
            topoMap.setOpacity(0.5);
        }
        // Schaltet VFR-Lufträume ab, wenn DFS aktiviert wird
        if (e.name === "🗺️ DFS ICAO Karte 1:500k") {
            if (typeof aeroOverlay !== 'undefined' && map.hasLayer(aeroOverlay)) map.removeLayer(aeroOverlay);
            topoMap.setOpacity(1.0);
        }
        if (e.name === "🌧️ Wetterradar (Niederschlag)") localStorage.setItem('ga_radar_active', 'true');
    });
    
    map.on('overlayremove', function (e) {
        if (e.name === "🛩️ VFR Lufträume (Overlay)") {
            topoMap.setOpacity(1.0);
        }
        if (e.name === "🌧️ Wetterradar (Niederschlag)") localStorage.setItem('ga_radar_active', 'false');
    });
    
    let fetchTimeout = null;
    map.on('moveend', function () {
        if (snapMode) {
            clearTimeout(fetchTimeout);
            fetchTimeout = setTimeout(fetchOpenAIPData, 600);
        }
        if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(false);
    });
    map.on('zoomend', function() {
        if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(false);
    });
    
    const fsControl = L.control({ position: 'topleft' });
    fsControl.onAdd = function () {
        const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control');
        btn.innerHTML = '⛶'; btn.title = 'Vollbildmodus'; btn.style.width = '30px'; btn.style.height = '30px';
        btn.style.lineHeight = '30px'; btn.style.backgroundColor = '#fff'; btn.style.border = '1px solid #ccc';
        btn.style.cursor = 'pointer'; btn.style.fontSize = '18px'; btn.style.fontWeight = 'bold'; btn.style.textAlign = 'center'; btn.style.padding = '0';
        btn.onclick = function (e) {
            e.preventDefault();
            const willBeFs = !document.body.classList.contains('map-is-fullscreen');
            document.body.classList.toggle('map-is-fullscreen');
            document.documentElement.classList.toggle('map-is-fullscreen', willBeFs);
            if (document.body.classList.contains('map-is-fullscreen')) { btn.innerHTML = '✖'; } else { btn.innerHTML = '⛶'; }
            setTimeout(() => {
                if (map) map.invalidateSize();
                updateMiniMap();
                if (typeof renderMapProfile === 'function') renderMapProfile();
            }, 300);
        };
        return btn;
    };
    fsControl.addTo(map);
    map.on('click', function (e) {
        if (handleAipCalibrationMapClick(e)) return;
        if (isMapUiClickTarget(e.originalEvent)) return;
        if (freeflightMode) { handleFreeflightMapClick(e); return; }
        if (measureMode) { addMeasurePoint(e.latlng); return; }

        const wpIndex = findNearestEditableWaypoint(e.latlng, 30);
        if (wpIndex !== null && routeMarkers[wpIndex]) {
            routeMarkers[wpIndex].openPopup();
            return;
        }

        const apt = findNearestAirport(e.latlng, getAirportTapRadiusPx(34));
        if (apt) openAirportInfoPopup(apt, e.latlng);
    });
    if (!map._routeLegLabelsBound) {
        map.on('zoomend moveend', () => {
            if (routeWaypoints && routeWaypoints.length >= 2) renderRouteLegLabels();
        });
        map._routeLegLabelsBound = true;
    }
    if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(true);
}

function updateMap(lat1, lon1, lat2, lon2, s, d) {
    if (!map) initMapBase();
    currentSName = s || "Start"; currentDName = d || "Ziel";
    
    // POI-Check: Wenn poiName gesetzt ist, bauen wir ein Rundflug-Dreieck
    if (typeof currentMissionData !== 'undefined' && currentMissionData && currentMissionData.poiName) {
        // Berechnung des direkten Rückwegs (vom POI zurück zum Start)
        const returnNav = calcNav(lat2, lon2, lat1, lon1);
        // Wir biegen den Rückflug um 20 Grad ab und legen den Wegpunkt auf ~45% der Strecke
        const offsetBearing = (returnNav.brng + 20) % 360;
        const returnWp = getDestinationPoint(lat2, lon2, returnNav.dist * 0.45, offsetBearing);
        
        routeWaypoints = [
            { lat: lat1, lng: lon1 }, 
            { lat: lat2, lng: lon2, name: "🎯 " + currentMissionData.poiName, isPOI: true }, 
            { lat: returnWp.lat, lng: returnWp.lon, name: "Return Leg" }, 
            { lat: lat1, lng: lon1, name: currentSName } // HIER: Name explizit auf den Startplatz setzen
        ];
    } else {
        routeWaypoints = [{ lat: lat1, lng: lon1 }, { lat: lat2, lng: lon2 }];
    }
    
    renderMainRoute();
}

async function updateMapFromInputs() {
    if (!document.getElementById('mapTableOverlay').classList.contains('active')) return;
    const sIcao = document.getElementById('startLoc').value.toUpperCase(), dIcao = document.getElementById('destLoc').value.toUpperCase();
    if (!sIcao) return;
    if (!map) initMapBase();
    let sData = await getAirportData(sIcao), dData = dIcao ? await getAirportData(dIcao) : null;
    if (sData && dData) {
        currentSName = sData.icao; currentDName = dData.icao;
        if (!currentMissionData) {
            map.fitBounds(L.latLngBounds([sData.lat, sData.lon], [dData.lat, dData.lon]), { padding: [40, 40] });
        } else {
            routeWaypoints = [{ lat: sData.lat, lng: sData.lon }, { lat: dData.lat, lng: dData.lon }];
            renderMainRoute();
            map.fitBounds(L.latLngBounds([sData.lat, sData.lon], [dData.lat, dData.lon]), { padding: [40, 40] });
        }
    } else if (sData) {
        currentSName = sData.icao;
        if (!currentMissionData) {
            map.panTo([sData.lat, sData.lon]); if (map.getZoom() < 8) map.setZoom(9);
        } else {
            routeWaypoints = [{ lat: sData.lat, lng: sData.lon }];
            renderMainRoute();
            map.panTo([sData.lat, sData.lon]); if (map.getZoom() < 8) map.setZoom(9);
        }
    }
}

let _scrollLockY = 0;
let _drawerTransitionInProgress = false;
let _drawerTransitionStartedAt = 0;
const DRAWER_STATE = {
    OPENING: 'opening',
    OPEN: 'open',
    CLOSING: 'closing',
    CLOSED: 'closed'
};

function lockBodyScroll() {
    if (window.innerWidth >= 1250) return;
    _scrollLockY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + _scrollLockY + 'px';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
    if (window.innerWidth >= 1250) return;
    if (document.body.style.position !== 'fixed') return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, _scrollLockY);
}

function setDrawerTransitionBusy(isBusy) {
    _drawerTransitionInProgress = !!isBusy;
    _drawerTransitionStartedAt = _drawerTransitionInProgress ? Date.now() : 0;
}

function isDrawerTransitionBusy() {
    if (_drawerTransitionInProgress) {
        const staleLimit = Math.max(1500, getDrawerDurationMs() + 1100);
        if ((Date.now() - _drawerTransitionStartedAt) > staleLimit) {
            _drawerTransitionInProgress = false;
            _drawerTransitionStartedAt = 0;
        }
    }
    return _drawerTransitionInProgress;
}

function parseDurationMs(rawDuration) {
    if (!rawDuration) return 360;
    const value = String(rawDuration).trim();
    if (!value) return 360;
    if (value.endsWith('ms')) return Math.max(0, parseFloat(value));
    if (value.endsWith('s')) return Math.max(0, parseFloat(value) * 1000);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 360;
}

function getDrawerDurationMs() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 1;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--drawer-duration');
    const parsed = parseDurationMs(raw);
    return parsed > 0 ? parsed : 360;
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setDrawerState(overlay, state) {
    if (!overlay) return;
    overlay.dataset.drawerState = state;
}

function getDrawerState(overlay) {
    if (!overlay) return DRAWER_STATE.CLOSED;
    if (overlay.dataset.drawerState) return overlay.dataset.drawerState;
    return overlay.classList.contains('active') ? DRAWER_STATE.OPEN : DRAWER_STATE.CLOSED;
}

function waitForOverlayTransition(overlay) {
    const timeoutMs = Math.max(80, getDrawerDurationMs() + 220);
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            overlay.removeEventListener('transitionend', onEnd);
            clearTimeout(timer);
            resolve();
        };
        const onEnd = (event) => {
            if (event.target !== overlay) return;
            if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;
            done();
        };
        const timer = setTimeout(done, timeoutMs);
        overlay.addEventListener('transitionend', onEnd);
    });
}

async function animateDrawerOverlay(overlay, shouldOpen) {
    if (!overlay) return;
    overlay.classList.remove('is-opening', 'is-closing');

    if (shouldOpen) {
        setDrawerState(overlay, DRAWER_STATE.OPENING);
        overlay.classList.add('is-opening');
        await nextFrame();
        overlay.classList.add('active');
        await waitForOverlayTransition(overlay);
        overlay.classList.remove('is-opening');
        setDrawerState(overlay, DRAWER_STATE.OPEN);
        return;
    }

    setDrawerState(overlay, DRAWER_STATE.CLOSING);
    overlay.classList.add('is-closing');
    await nextFrame();
    overlay.classList.remove('active');
    await waitForOverlayTransition(overlay);
    overlay.classList.remove('is-closing');
    setDrawerState(overlay, DRAWER_STATE.CLOSED);
}

function enterMapFullscreenMode() {
    document.body.classList.add('map-is-fullscreen');
    document.documentElement.classList.add('map-is-fullscreen');
    document.body.style.overflow = 'hidden';
}

function exitMapFullscreenMode() {
    document.body.classList.remove('map-is-fullscreen');
    document.documentElement.classList.remove('map-is-fullscreen');
    document.body.style.overflow = '';
}

async function refreshMapTableLayout() {
    if (!map) initMapBase();
    await nextFrame();
    await nextFrame();

    if (map) {
        map.invalidateSize();
        if (routeWaypoints && routeWaypoints.length >= 2) map.fitBounds(L.latLngBounds(routeWaypoints), { padding: [40, 40] });
        else updateMapFromInputs();

        updateSnapButtonUI();
        if (snapMode) fetchOpenAIPData();
    }
    if (typeof initProfileResize === 'function') initProfileResize();
    if (typeof vpMapProfileVisible !== 'undefined' && vpMapProfileVisible && typeof renderMapProfile === 'function') renderMapProfile();
}

function toggleMapTable(forceInternal) {
    const board = document.getElementById('mapTableOverlay');
    const pinBoard = document.getElementById('pinboardOverlay');
    if (!board || !pinBoard) return;

    const force = !!forceInternal;
    if (isDrawerTransitionBusy() && !force) return;
    if (!force) setDrawerTransitionBusy(true);

    try {
        if (pinBoard.classList.contains('active') && typeof togglePinboard === 'function') {
            togglePinboard(true);
        }

        board.classList.toggle('active');
        document.body.classList.toggle('maptable-open');
        setDrawerState(board, board.classList.contains('active') ? DRAWER_STATE.OPEN : DRAWER_STATE.CLOSED);
        if (typeof _closeFloatingMenus === 'function') _closeFloatingMenus();

        if (board.classList.contains('active')) {
            const autoFs = shouldAutoStartMapFullscreen();
            if (autoFs) {
                enterMapFullscreenMode();
            } else {
                lockBodyScroll();
            }
            if (!map) initMapBase();

            setTimeout(() => {
                refreshMapTableLayout().catch((error) => {
                    console.error('Map table refresh failed:', error);
                });
            }, 500);
        } else {
            unlockBodyScroll();
            exitMapFullscreenMode();
            if (typeof _closeFloatingMenus === 'function') _closeFloatingMenus();
        }
    } catch (error) {
        console.error('Map table toggle failed:', error);
        unlockBodyScroll();
        exitMapFullscreenMode();
    } finally {
        if (!force) {
            const releaseDelay = Math.max(120, getDrawerDurationMs() + 80);
            setTimeout(() => setDrawerTransitionBusy(false), releaseDelay);
        }
    }
}

function shouldAutoStartMapFullscreen() {
    return window.innerWidth < 1250;
}

/* =========================================================
   8. POLAROID MINIMAP
   ========================================================= */
function updateMiniMap() {
    const miniContainer = document.getElementById('miniMap');
    if (!miniContainer || miniContainer.offsetParent === null) return;

    // Verzögerung, um UI-Blockierung zu vermeiden
    setTimeout(() => {
        if (!miniMap) {
            miniMap = L.map('miniMap', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, attributionControl: false });
            L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png').addTo(miniMap);
            L.tileLayer('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', {
                opacity: 0.65,
                maxNativeZoom: 12
            }).addTo(miniMap);
        }

        if (routeWaypoints && routeWaypoints.length > 0) {
            if (!miniRoutePolyline) {
                miniRoutePolyline = L.polyline(routeWaypoints, { color: '#d93829', weight: 4 }).addTo(miniMap);
            } else {
                miniRoutePolyline.setLatLngs(routeWaypoints);
            }
            miniMapMarkers.forEach(m => miniMap.removeLayer(m)); miniMapMarkers = [];

            const startMarker = L.circleMarker(routeWaypoints[0], { radius: 5, color: '#111', weight: 2, fillColor: '#44ff44', fillOpacity: 1 }).addTo(miniMap);
            const destMarker = L.circleMarker(routeWaypoints[routeWaypoints.length - 1], { radius: 5, color: '#111', weight: 2, fillColor: '#ff4444', fillOpacity: 1 }).addTo(miniMap);

            miniMapMarkers.push(startMarker, destMarker);
            setTimeout(() => { miniMap.invalidateSize(); miniMap.fitBounds(L.latLngBounds(routeWaypoints), { padding: [15, 15] }); }, 50);
        }
    }, 100); // Kurze Verzögerung vor dem Start
}

/* =========================================================
   19. OPENAIP SNAPPING (NAVAIDS & REP-POINTS)
   ========================================================= */
let snapMode = true;
let cachedNavData = [];

function extractRppAirportIcao(rppItem) {
    if (!rppItem || typeof rppItem !== 'object') return '';
    const readIcao = (obj) => String(
        obj?.icao || obj?.icaoCode || obj?.ident || obj?.designator || obj?.code || ''
    ).trim().toUpperCase();

    const directCandidates = [
        rppItem.airport,
        rppItem.aerodrome,
        rppItem.relatedAirport,
        rppItem.location,
        rppItem.parent
    ];
    for (const c of directCandidates) {
        const icao = readIcao(c);
        if (/^[A-Z]{4}$/.test(icao)) return icao;
    }

    if (Array.isArray(rppItem.airports)) {
        for (const a of rppItem.airports) {
            const icao = readIcao(a);
            if (/^[A-Z]{4}$/.test(icao)) return icao;
        }
    }

    // Fallback: gelegentlich steckt die ICAO nur im Namen/Kommentar.
    const textBlob = [rppItem.name, rppItem.title, rppItem.description, rppItem.note, rppItem.remarks]
        .filter(Boolean)
        .join(' ');
    const m = textBlob.match(/\b[A-Z]{4}\b/);
    return m ? m[0] : '';
}

/* --- DIRECT TO STATE --- */
let freeflightMode = false;
let ffWaypoints = [];
let ffPolyline = null;
let ffMarkers = [];
let ffContextPopup = null;
let ffNeedsStart = false;

function toggleSnapMode() {
    snapMode = !snapMode;
    updateSnapButtonUI();
    if (snapMode && map) fetchOpenAIPData();
    else cachedNavData = [];
}

function updateSnapButtonUI() {
    const btn = document.getElementById('snapBtn');
    if (!btn) return;
    if (snapMode) {
        btn.innerText = '🧲 Snapping (An)';
        btn.style.background = '#4da6ff';
        btn.style.color = '#fff';
    } else {
        btn.innerText = '🧲 Snapping (Aus)';
        btn.style.background = '#444';
        btn.style.color = '#fff';
    }
}

async function fetchOpenAIPData() {
    if (!map || !snapMode) return;

    // 1. Schutz: Nicht laden, wenn man zu weit rausgezoomt ist (verhindert "Box too large" 500er Fehler)
    if (map.getZoom() < 8) {
        cachedNavData = [];
        return;
    }
    const b = map.getBounds();

    // 2. Schutz: Koordinaten auf die reale Weltkarte limitieren (-180 bis 180 / -90 bis 90)
    const w = Math.max(-180, b.getWest());
    const s = Math.max(-90, b.getSouth());
    const e = Math.min(180, b.getEast());
    const n = Math.min(90, b.getNorth());

    const bbox = `${w},${s},${e},${n}`;
    const proxy = 'https://ga-proxy.einherjer.workers.dev';
    try {
        const [navRes, repRes, aptRes] = await Promise.all([
            fetch(`${proxy}/api/navaids?bbox=${bbox}&limit=250&t=${Date.now()}`),
            fetch(`${proxy}/api/reporting-points?bbox=${bbox}&limit=250&t=${Date.now()}`),
            fetch(`${proxy}/api/airports?bbox=${bbox}&limit=250&t=${Date.now()}`)
        ]);
        // 3. Schutz: Falls OpenAIP blockt, breche leise ab statt abzustürzen
        if (!navRes.ok || !repRes.ok || !aptRes.ok) {
            return;
        }
        const navJson = await navRes.json(), repJson = await repRes.json(), aptJson = await aptRes.json();
        cachedNavData = [];
        let navArray = navJson.items || [];
        let repArray = repJson.items || [];
        let aptArray = aptJson.items || [];
        navArray.forEach(i => {
            if (!i.geometry) return;
            let freqVal = '';
            if (i.frequency !== undefined && i.frequency !== null) {
                freqVal = (typeof i.frequency === 'object' && i.frequency.value) ? i.frequency.value : i.frequency;
            } else if (i.frequencies && i.frequencies.length > 0) {
                freqVal = i.frequencies[0].value || i.frequencies[0];
            }
            let freq = freqVal ? ` (${freqVal})` : '';
            let idVal = i.identifier || i.designator || '';
            let ident = idVal ? ` [${idVal}]` : '';
            cachedNavData.push({ name: `${i.name}${ident}${freq}`, lat: i.geometry.coordinates[1], lng: i.geometry.coordinates[0] });
        });
        repArray.forEach(i => {
            if (!i.geometry) return;
            cachedNavData.push({
                name: `RPP ${i.name}`,
                lat: i.geometry.coordinates[1],
                lng: i.geometry.coordinates[0],
                type: 'RPP',
                rppAirportIcao: extractRppAirportIcao(i),
                sourceId: i._id || i.id || ''
            });
        });
        aptArray.forEach(i => {
            if (!i.geometry) return;
            let freq = (i.frequencies && i.frequencies.length > 0 && i.frequencies[0].value) ? ` (${i.frequencies[0].value})` : '';
            let displayName = i.icaoCode ? i.icaoCode : i.name;
            cachedNavData.push({ name: `APT ${displayName}${freq}`, lat: i.geometry.coordinates[1], lng: i.geometry.coordinates[0] });
        });
    } catch (e) {
        // Leiser Fallback, wenn das Netzwerk mal hakt
    }
}
/* =========================================================
   WETTER MARKER AUF DER KARTE (VFR / IFR)
   ========================================================= */
window.vpShowMapMetar = localStorage.getItem('ga_show_map_metar') !== 'false';

window.toggleMapMetars = function() {
    const next = !window.vpShowMapMetar;
    window.vpShowMapMetar = next;
    window.mapHints.weather = next;
    localStorage.setItem('ga_show_map_metar', window.vpShowMapMetar);
    saveMapHintSetting('weather');
    const btn = document.getElementById('mapMetarBtn');
    if (btn) {
        btn.innerText = window.vpShowMapMetar ? '🌤️ METARs (An)' : '🌤️ METARs (Aus)';
        btn.style.background = window.vpShowMapMetar ? '#4da6ff' : '#444';
        btn.style.color = window.vpShowMapMetar ? '#111' : '#fff';
    }
    refreshMapHintMenuUi();
    // API triggern falls Wetter gebraucht wird, ansonsten nur Marker neu rendern
    if (window.vpShowMapMetar && typeof window._lastVpRouteKey !== 'undefined') {
        if (typeof triggerVerticalProfileUpdate === 'function') triggerVerticalProfileUpdate();
    } else {
        if (typeof renderWeatherMarkers === 'function') renderWeatherMarkers();
    }
    if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(true);
};

document.addEventListener('DOMContentLoaded', () => {
    loadMapHintSettings();
    // Bestehenden Wetter-Status übernehmen, falls vorhanden
    window.vpShowMapMetar = window.mapHints.weather !== false;
    // Traffic-Status übernehmen
    window.vpTrafficMapVisible = window.mapHints.traffic !== false;
    refreshMapHintMenuUi();
    applyMapHintEffects('weather');
    applyMapHintEffects('windBarbs');
    applyMapHintEffects('cloudFields');
    applyMapHintEffects('traffic');

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('mapHintsMenu');
        if (!menu || menu.style.display !== 'block') return;
        const t = e.target;
        if (t && t.closest && (t.closest('#mapHintsMenu') || t.closest('#mapHintsBtn'))) return;
        window.toggleMapHintsMenu(false);
    }, true);
});

let wxMapMarkers = [];
let wxWindBarbMarkers = [];
let wxCloudFieldMarkers = [];
let wxCloudFieldSvgSeq = 0;
let wxOverlayFetchController = null;
let wxOverlayFetchTimer = null;
let wxOverlayLastKey = '';
const WX_GRID_SPACING_SCALE = 1.5;

function clearMapOpenMeteoOverlays() {
    if (!map) return;
    wxWindBarbMarkers.forEach(m => map.removeLayer(m));
    wxCloudFieldMarkers.forEach(m => map.removeLayer(m));
    wxWindBarbMarkers = [];
    wxCloudFieldMarkers = [];
}

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

function mixChannel(a, b, t) {
    return Math.round(a + (b - a) * clamp01(t));
}

function windBarbStyleFromSpeed(speedKt) {
    const t = clamp01(speedKt / 42);
    const r = mixChannel(168, 26, t);
    const g = mixChannel(214, 120, t);
    const b = mixChannel(255, 255, t);
    const alpha = 0.86 + 0.14 * t;
    const shadow = 0.62 + 0.28 * t;
    const strokeWidth = 2.2 + 1.2 * t;
    return {
        stroke: `rgba(${r},${g},${b},${alpha.toFixed(3)})`,
        fill: `rgba(${r},${g},${b},${Math.min(1, alpha + 0.12).toFixed(3)})`,
        core: `rgba(${r},${g},${b},${Math.min(1, alpha + 0.2).toFixed(3)})`,
        shadow: shadow.toFixed(3),
        strokeWidth: strokeWidth.toFixed(2)
    };
}

function buildWindBarbIcon(directionDeg, speedKt) {
    const dirFrom = Number.isFinite(directionDeg) ? directionDeg : 0;
    // Open-Meteo liefert "coming from"; auf der Karte zeigen wir die Bewegungsrichtung (to).
    const renderDir = (dirFrom + 180) % 360;
    const speed = Math.max(0, Number.isFinite(speedKt) ? speedKt : 0);
    const style = windBarbStyleFromSpeed(speed);
    let rem = Math.round(speed / 5) * 5;
    let y = 20.4;
    let feathers = '';
    while (rem >= 50) {
        feathers += `<path d="M12 ${y} L19 ${y + 2.7} L12 ${y + 5.4} Z" fill="${style.fill}"/>`;
        y -= 5.4;
        rem -= 50;
    }
    while (rem >= 10) {
        feathers += `<line x1="12" y1="${y}" x2="19" y2="${y + 3.4}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linecap="round"/>`;
        y -= 3.5;
        rem -= 10;
    }
    if (rem >= 5) {
        feathers += `<line x1="12" y1="${y}" x2="16.6" y2="${y + 2.1}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linecap="round"/>`;
    }

    const svg = `
        <svg width="36" height="36" viewBox="0 0 24 24" style="overflow:visible;">
            <g transform="rotate(${renderDir} 12 12)">
                <circle cx="12" cy="12" r="1.8" fill="${style.core}"/>
                <line x1="12" y1="21.2" x2="12" y2="2.2" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linecap="round"/>
                ${feathers}
            </g>
        </svg>`;

    return L.divIcon({
        className: 'wx-windbarb-icon',
        html: `<div style="filter: drop-shadow(0 1px 3px rgba(0,0,0,${style.shadow}));">${svg}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

function cloudBandFillLevel(pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    if (v < 34) return 0; // leer
    if (v < 67) return 1; // halb
    return 2;             // voll
}

function cloudBandOpacity(level) {
    if (level <= 0) return 0;
    if (level === 1) return 0.42;
    return 0.86;
}

function createCloudFieldMarker(lat, lon, lowPct, midPct, highPct, sizePx) {
    const highLevel = cloudBandFillLevel(highPct);
    const midLevel = cloudBandFillLevel(midPct);
    const lowLevel = cloudBandFillLevel(lowPct);
    const anyFill = (highLevel + midLevel + lowLevel) > 0;
    if (!anyFill) return null;

    const topA = cloudBandOpacity(highLevel).toFixed(3);
    const midA = cloudBandOpacity(midLevel).toFixed(3);
    const lowA = cloudBandOpacity(lowLevel).toFixed(3);
    const id = `wx-cloud-clip-${(++wxCloudFieldSvgSeq)}`;
    const size = Math.max(40, Math.min(72, Math.round(sizePx)));

    const svg = `
        <svg width="${size}" height="${size}" viewBox="0 0 100 100" style="overflow:visible;">
            <defs>
                <clipPath id="${id}">
                    <circle cx="50" cy="50" r="46"></circle>
                </clipPath>
            </defs>
            <circle cx="50" cy="50" r="46" fill="rgba(128,128,128,0.10)" stroke="rgba(214,214,214,0.72)" stroke-width="2.8"></circle>
            <g clip-path="url(#${id})">
                <rect x="4" y="4" width="92" height="30.67" fill="rgba(170,170,170,${topA})"></rect>
                <rect x="4" y="34.67" width="92" height="30.66" fill="rgba(160,160,160,${midA})"></rect>
                <rect x="4" y="65.33" width="92" height="30.67" fill="rgba(150,150,150,${lowA})"></rect>
                <line x1="6" y1="34.67" x2="94" y2="34.67" stroke="rgba(230,230,230,0.62)" stroke-width="1"></line>
                <line x1="6" y1="65.33" x2="94" y2="65.33" stroke="rgba(230,230,230,0.62)" stroke-width="1"></line>
            </g>
        </svg>`;

    const icon = L.divIcon({
        className: 'wx-cloudfield-icon',
        html: `<div style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.58));">${svg}</div>`,
        iconSize: [size, size],
        iconAnchor: [Math.round(size / 2), Math.round(size / 2)]
    });
    return L.marker([lat, lon], { icon, interactive: false, keyboard: false, opacity: 0.98 });
}

function pickWeatherGridStep(spanDeg, targetLines) {
    const raw = Math.max(0.02, spanDeg / Math.max(2, targetLines - 1));
    const steps = [0.02, 0.03, 0.05, 0.075, 0.1, 0.125, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];
    for (const s of steps) {
        if (raw <= s) return s;
    }
    return Math.ceil(raw / 5) * 5;
}

function normalizeLon180(lon) {
    let x = lon;
    while (x > 180) x -= 360;
    while (x <= -180) x += 360;
    return x;
}

function buildRouteWeatherBounds() {
    if (typeof routeWaypoints === 'undefined' || !Array.isArray(routeWaypoints) || routeWaypoints.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const wp of routeWaypoints) {
        const lat = Number(wp && wp.lat);
        const lon = Number(wp && (wp.lng ?? wp.lon));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
    }
    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
    const padDeg = 1.6; // ~95 NM
    return {
        minLat: Math.max(-89.5, minLat - padDeg),
        maxLat: Math.min(89.5, maxLat + padDeg),
        minLon: normalizeLon180(minLon - padDeg),
        maxLon: normalizeLon180(maxLon + padDeg),
        wrapsDateline: (minLon - padDeg) < -180 || (maxLon + padDeg) > 180
    };
}

function pointInsideBounds(lat, lon, b) {
    if (!b) return false;
    const latOk = lat >= b.minLat && lat <= b.maxLat;
    if (!latOk) return false;
    if (!b.wrapsDateline) return lon >= b.minLon && lon <= b.maxLon;
    return lon >= b.minLon || lon <= b.maxLon;
}

function filterWeatherPointsByActiveDomain(points) {
    if (!Array.isArray(points) || points.length === 0) return points;
    const routeBounds = buildRouteWeatherBounds();
    const gps = window.lastLiveGpsPos;
    const hasRecentGps = !!(gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lon) && Number.isFinite(gps.t) && (Date.now() - gps.t < 15 * 60 * 1000));
    const gpsRadiusDeg = 2.3; // ~140 NM
    const gpsLatMin = hasRecentGps ? Math.max(-89.5, gps.lat - gpsRadiusDeg) : 0;
    const gpsLatMax = hasRecentGps ? Math.min(89.5, gps.lat + gpsRadiusDeg) : 0;
    const gpsLonMin = hasRecentGps ? normalizeLon180(gps.lon - gpsRadiusDeg) : 0;
    const gpsLonMax = hasRecentGps ? normalizeLon180(gps.lon + gpsRadiusDeg) : 0;
    const gpsWrap = hasRecentGps ? ((gps.lon - gpsRadiusDeg) < -180 || (gps.lon + gpsRadiusDeg) > 180) : false;

    if (!routeBounds && !hasRecentGps) return points;
    const filtered = points.filter(p => {
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
        if (routeBounds && pointInsideBounds(p.lat, p.lon, routeBounds)) return true;
        if (hasRecentGps) {
            if (p.lat < gpsLatMin || p.lat > gpsLatMax) return false;
            if (!gpsWrap) return p.lon >= gpsLonMin && p.lon <= gpsLonMax;
            return p.lon >= gpsLonMin || p.lon <= gpsLonMax;
        }
        return false;
    });
    return filtered.length > 0 ? filtered : points;
}

function getMapWeatherGridPoints(cols = 8, rows = 6) {
    if (!map) return { points: [], key: '' };
    const b = map.getBounds();
    if (!b || !b.isValid()) return { points: [], key: '' };
    const north = b.getNorth();
    const south = b.getSouth();
    const west = b.getWest();
    const east = b.getEast();

    const latSpan = Math.max(0.05, Math.abs(north - south));
    let lonSpan = east - west;
    if (lonSpan < 0) lonSpan += 360;
    lonSpan = Math.max(0.05, lonSpan);

    const latStep = pickWeatherGridStep(latSpan, rows) * WX_GRID_SPACING_SCALE;
    const lonStep = pickWeatherGridStep(lonSpan, cols) * WX_GRID_SPACING_SCALE;
    const latStart = Math.floor(south / latStep) * latStep;
    const latEnd = Math.ceil(north / latStep) * latStep;

    const westN = ((west % 360) + 360) % 360;
    const eastN = westN + lonSpan;
    const lonStart = Math.floor(westN / lonStep) * lonStep;
    const lonEnd = Math.ceil(eastN / lonStep) * lonStep;

    const pts = [];
    for (let lat = latStart; lat <= latEnd + (latStep * 0.25); lat += latStep) {
        const clampedLat = Math.max(-89.5, Math.min(89.5, lat));
        for (let lon = lonStart; lon <= lonEnd + (lonStep * 0.25); lon += lonStep) {
            pts.push({
                lat: Math.round(clampedLat * 1e5) / 1e5,
                lon: Math.round(normalizeLon180(lon) * 1e5) / 1e5
            });
        }
    }
    const filteredPts = filterWeatherPointsByActiveDomain(pts);
    return {
        points: filteredPts,
        key: [
            latStep.toFixed(3),
            lonStep.toFixed(3),
            latStart.toFixed(3),
            latEnd.toFixed(3),
            lonStart.toFixed(3),
            lonEnd.toFixed(3),
            filteredPts.length
        ].join('|')
    };
}

window.scheduleMapWeatherOverlayUpdate = function(forceFetch = false) {
    if (wxOverlayFetchTimer) clearTimeout(wxOverlayFetchTimer);
    wxOverlayFetchTimer = setTimeout(() => {
        if (typeof window.renderMapWeatherOverlays === 'function') window.renderMapWeatherOverlays(forceFetch);
    }, forceFetch ? 80 : 260);
};

window.renderMapWeatherOverlays = async function(forceFetch = false) {
    if (!map) return;
    const openMeteoActive = (typeof window.vpIsOpenMeteoDisplayActive === 'function')
        ? window.vpIsOpenMeteoDisplayActive()
        : (window.vpWeatherSource === 'openmeteo' && !window.vpWeatherFallbackActive);
    if (!openMeteoActive) {
        clearMapOpenMeteoOverlays();
        return;
    }
    if (window.mapHints.weather === false) {
        clearMapOpenMeteoOverlays();
        return;
    }
    const showWind = window.mapHints.windBarbs !== false;
    const showCloud = window.mapHints.cloudFields !== false;
    if (!showWind && !showCloud) {
        clearMapOpenMeteoOverlays();
        return;
    }
    if (typeof window.fetchOpenMeteoWeatherPoints !== 'function') return;

    const grid = getMapWeatherGridPoints(8, 6);
    const points = grid.points;
    if (!points.length) return;
    const gridKey = `${grid.key}|${showWind ? 1 : 0}|${showCloud ? 1 : 0}`;
    if (!forceFetch && gridKey === wxOverlayLastKey) return;
    wxOverlayLastKey = gridKey;

    if (wxOverlayFetchController) wxOverlayFetchController.abort();
    wxOverlayFetchController = new AbortController();
    const signal = wxOverlayFetchController.signal;

    try {
        if (window.vpWeatherDebug) window.vpWeatherDebug.mapOverlayFetches += 1;
        const samples = await window.fetchOpenMeteoWeatherPoints(points, { signal, includePressure: false, maxConcurrency: 4 });
        if (signal.aborted) return;

        clearMapOpenMeteoOverlays();
        const z = map.getZoom ? map.getZoom() : 8;
        const cloudIconSize = Math.max(37, Math.min(56, Math.round((50 + (z - 6) * 2.4) * 0.8)));

        samples.forEach((sample, idx) => {
            if (!sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return;
            const lat = sample.lat, lon = sample.lon;

            if (showCloud) {
                const low = Number(sample.cloudLowPct || 0);
                const mid = Number(sample.cloudMidPct || 0);
                const high = Number(sample.cloudHighPct || 0);
                const cloudMarker = createCloudFieldMarker(lat, lon, low, mid, high, cloudIconSize);
                if (cloudMarker) wxCloudFieldMarkers.push(cloudMarker.addTo(map));
            }

            if (showWind) {
                const dir = Number(sample.wdir);
                const spd = Number(sample.wspd);
                if (Number.isFinite(dir) && Number.isFinite(spd)) {
                    const icon = buildWindBarbIcon(dir, spd);
                    const m = L.marker([lat, lon], { icon, interactive: false, keyboard: false, opacity: 1 }).addTo(map);
                    wxWindBarbMarkers.push(m);
                }
            }
        });
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.warn('[MapWX] Open-Meteo Overlay Fehler:', e);
        if (window.vpWeatherDebug && typeof window.vpWeatherDebugSetError === 'function') {
            window.vpWeatherDebugSetError(e, 'map overlay');
        } else if (window.vpWeatherDebug) {
            window.vpWeatherDebug.openMeteoErrors = (window.vpWeatherDebug.openMeteoErrors || 0) + 1;
            window.vpWeatherDebug.lastErrorAt = Date.now();
            window.vpWeatherDebug.lastErrorMsg = `map overlay: ${e && (e.message || String(e))}`;
        }
        clearMapOpenMeteoOverlays();
    }
};

    window.updateWeatherMarkerDodging = function() {
        if (!map || typeof wxMapMarkers === 'undefined' || wxMapMarkers.length === 0) return;
        
        // FIX: Verhindere NaN, wenn die Karte versteckt ist (Leaflet liefert dann 0,0 für alles)
        const mapTable = document.getElementById('mapTableOverlay');
        if (!mapTable || !mapTable.classList.contains('active')) {
            wxMapMarkers.forEach(marker => {
                const wrap = marker._icon ? marker._icon.querySelector('.wx-marker-wrap') : null;
                if (wrap) wrap.style.transform = `translate(0px, 0px)`;
            });
            return;
        }

        // Echtzeit-Koordinaten direkt aus der sichtbaren roten Linie holen
        let pts = [];
    if (typeof polyline !== 'undefined' && polyline) {
        pts = polyline.getLatLngs().map(ll => map.latLngToLayerPoint(ll));
    } else if (typeof routeWaypoints !== 'undefined' && routeWaypoints && routeWaypoints.length >= 2) {
        pts = routeWaypoints.map(wp => map.latLngToLayerPoint([wp.lat, wp.lng || wp.lon]));
    } else return;
    
    wxMapMarkers.forEach(marker => {
        const wrap = marker._icon ? marker._icon.querySelector('.wx-marker-wrap') : null;
        if (!wrap) return;
        
        const mPx = map.latLngToLayerPoint(marker.getLatLng());
        let minDist = Infinity;
        let pushVec = { x: 0, y: 0 };
        
        // Abstand zu den Liniensegmenten
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i], p2 = pts[i+1];
            const l2 = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
            let t = 0;
            if (l2 > 0) t = Math.max(0, Math.min(1, ((mPx.x - p1.x) * (p2.x - p1.x) + (mPx.y - p1.y) * (p2.y - p1.y)) / l2));
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            
            const dist = Math.sqrt(Math.pow(mPx.x - projX, 2) + Math.pow(mPx.y - projY, 2));
            if (dist < minDist) {
                minDist = dist;
                if (dist > 0) pushVec = { x: (mPx.x - projX) / dist, y: (mPx.y - projY) / dist };
                else pushVec = { x: 1, y: 1 };
            }
        }
        
        // Abstand zu den Wegpunkten selbst prüfen
        pts.forEach(p => {
            const dist = Math.sqrt(Math.pow(mPx.x - p.x, 2) + Math.pow(mPx.y - p.y, 2));
            if (dist < minDist) {
                minDist = dist;
                if (dist > 0) pushVec = { x: (mPx.x - p.x) / dist, y: (mPx.y - p.y) / dist };
                else pushVec = { x: 1, y: 1 };
            }
        });
        
        const THRESHOLD = 45; 
        if (minDist < THRESHOLD) {
            const force = THRESHOLD - minDist + 15; 
            wrap.style.transition = 'transform 0.1s linear';
            wrap.style.transform = `translate(${pushVec.x * force}px, ${pushVec.y * force}px)`;
        } else {
            wrap.style.transition = 'transform 0.2s ease-out';
            wrap.style.transform = `translate(0px, 0px)`;
        }
    });
};

window.renderWeatherMarkers = function() {
    if (!map) return;
    wxMapMarkers.forEach(m => map.removeLayer(m));
    wxMapMarkers = [];

    const openMeteoActive = (typeof window.vpIsOpenMeteoDisplayActive === 'function')
        ? window.vpIsOpenMeteoDisplayActive()
        : (window.vpWeatherSource === 'openmeteo' && !window.vpWeatherFallbackActive);
    if (openMeteoActive) {
        if (typeof window.scheduleMapWeatherOverlayUpdate === 'function') window.scheduleMapWeatherOverlayUpdate(false);
        return;
    }

    if (!window.vpShowMapMetar) return;
    if (typeof vpWeatherData === 'undefined' || !vpWeatherData || vpWeatherData.length === 0) return;

    let seenIcao = new Set();

    vpWeatherData.forEach((zone, markerIndex) => {
        if (!zone.icao || !zone.stnLat || !zone.stnLon || seenIcao.has(zone.icao)) return;
        seenIcao.add(zone.icao);

        let catColor = "#fff";
        let catText = zone.fltCat || "VFR";
        if (catText === "VFR") catColor = "#33ff33";
        else if (catText === "MVFR") catColor = "#4da6ff";
        else if (catText === "IFR") catColor = "#ff4444";
        else if (catText === "LIFR") catColor = "#ff33ff";

        let windHtml = '';
        let wdir = zone.wdir;
        let wspd = zone.wspd || 0;
        
        if (wdir && wdir !== 'VRB' && wspd > 0) {
            let rotDir = (parseInt(wdir) + 180) % 360;
            windHtml = `
            <div style="margin-top: 4px; background: rgba(10,10,10,0.85); border: 1px solid #4da6ff; border-radius: 4px; padding: 2px 6px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">
                <svg width="12" height="12" viewBox="0 0 24 24" style="transform: rotate(${rotDir}deg); margin-right: 4px; overflow: visible;">
                    <path d="M12 2L12 22M12 2L5 9M12 2L19 9" stroke="#4da6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span style="color:#4da6ff; font-family:monospace; font-size:11px; font-weight:bold;">${wspd}kt</span>
            </div>`;
        }

        const html = `
            <div class="wx-marker-wrap" style="position:relative; transition: transform 0.2s ease-out; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                <div style="background: rgba(10,10,10,0.85); border: 2px solid ${catColor}; border-radius: 4px; padding: 2px 5px; color: ${catColor}; font-family: monospace; font-size: 11px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.6); position:relative; z-index:2;">
                    <span style="color:#fff; margin-right:4px;">${zone.icao}</span> ${catText}
                </div>
                ${windHtml}
            </div>
        `;

        const icon = L.divIcon({ className: 'custom-pin', html: html, iconSize: [80, 45], iconAnchor: [40, 15] });
        const stnPos = L.latLng(zone.stnLat, zone.stnLon);
        const stnPx = map.latLngToLayerPoint(stnPos);
        const angle = (markerIndex % 8) * (Math.PI / 4);
        const offsetPx = L.point(Math.round(Math.cos(angle) * 14), Math.round(Math.sin(angle) * 14) - 10);
        const drawPos = map.layerPointToLatLng(stnPx.add(offsetPx));
        const marker = L.marker(drawPos, { icon: icon, interactive: !measureMode }).addTo(map);
        
        // Kompaktes Popup-Container
        const popupId = `wxPopup_${zone.icao}`;
        marker.bindPopup(`<div id="${popupId}" style="width: 250px; min-height: 120px; display: flex; align-items: center; justify-content: center; color: #888; font-family: Arial, sans-serif; margin: -5px;">Lade METAR...</div>`, { maxWidth: 300 });
        
        // Rendert das moderne, kompakte Widget (forceModern=true) beim Klick
        marker.on('popupopen', () => {
            if (measureMode) {
                marker.closePopup();
                return;
            }
            if (typeof loadMetarWidget === 'function') {
                loadMetarWidget(zone.icao, popupId, zone.stnLat, zone.stnLon, true);
            }
        });
        
        wxMapMarkers.push(marker);
    });

    if (!map._wxDodgingBound) {
        map.on('move zoom moveend zoomend mousemove', () => { if (typeof updateWeatherMarkerDodging === 'function') updateWeatherMarkerDodging(); });
        map._wxDodgingBound = true;
    }
    setTimeout(updateWeatherMarkerDodging, 50);
};

/* =========================================================
   DIRECT TO MODUS
   ========================================================= */

const ffStartIcon = hitBoxIcon('#00e5ff');
const ffDestIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div class="pin-hitbox"><div class="pin-dot" style="background-color: #00e5ff; border: 2px solid #fff;"></div></div>`,
    iconSize: [34, 34], iconAnchor: [17, 17]
});

function isGpsLive(maxAgeMs = 15000) {
    const pos = window.lastLiveGpsPos;
    if (!pos) return false;
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return false;

    const ts = Number(pos.t) || 0;
    if (!ts || (Date.now() - ts) > maxAgeMs) return false;

    // Indicator kann zeitweise auf WAIT/WAKE stehen, obwohl wir eine frische Position haben.
    // Nur bei explizitem OFF blockieren wir den GPS-Start.
    const ind = document.getElementById('liveGpsIndicator');
    if (ind && typeof ind.innerHTML === 'string' && ind.innerHTML.includes('OFF')) return false;

    return true;
}

function toggleFreeflightMode() {
    freeflightMode = !freeflightMode;
    const btn = document.getElementById('freeflightBtn');
    if (freeflightMode) {
        btn.innerText = '✈️ Direct To (An)';
        btn.classList.add('active');
        if (measureMode) toggleMeasureMode();
        document.getElementById('map').style.cursor = 'crosshair';
        // GPS als Start?
        if (isGpsLive()) {
            const gps = window.lastLiveGpsPos;
            ffWaypoints = [{ lat: gps.lat, lng: gps.lon, name: 'GPS' }];
            showMapToast('GPS-Position als Start gesetzt');
        } else {
            ffNeedsStart = true;
            showMapToast('Tippe auf einen Flugplatz oder die Karte um den Startpunkt zu setzen');
        }
        // Missions-Route abdimmen
        if (polyline) polyline.setStyle({ opacity: 0.15 });
        routeMarkers.forEach(m => { if (m.getElement) { const el = m.getElement(); if (el) el.style.opacity = '0.15'; } });
    } else {
        btn.innerText = '✈️ Direct To (Aus)';
        btn.classList.remove('active');
        btn.style.background = '#444';
        btn.style.color = '#fff';
        document.getElementById('map').style.cursor = '';
        clearFreeflightRoute();
        ffWaypoints = [];
        ffNeedsStart = false;
        // Missions-Route wiederherstellen
        if (polyline) polyline.setStyle({ opacity: 1 });
        routeMarkers.forEach(m => { if (m.getElement) { const el = m.getElement(); if (el) el.style.opacity = '1'; } });
    }
}

function clearFreeflightRoute() {
    if (ffPolyline) { map.removeLayer(ffPolyline); ffPolyline = null; }
    ffMarkers.forEach(m => map.removeLayer(m));
    ffMarkers = [];
    if (ffContextPopup) { map.closePopup(ffContextPopup); ffContextPopup = null; }
}

function findNearestAirport(latlng, maxPixels) {
    if (typeof maxPixels === 'undefined') maxPixels = 60;
    if (!map) return null;
    const tapPx = map.latLngToLayerPoint(latlng);
    let best = null, bestDist = maxPixels + 1;

    // 1. cachedNavData (OpenAIP airports)
    cachedNavData.forEach(nav => {
        if (!nav.name.startsWith('APT ')) return;
        const navPx = map.latLngToLayerPoint([nav.lat, nav.lng]);
        const d = tapPx.distanceTo(navPx);
        if (d < bestDist) {
            bestDist = d;
            const parts = nav.name.replace('APT ', '').split(' (');
            best = { icao: parts[0].trim(), name: parts[0].trim(), lat: nav.lat, lon: nav.lng };
        }
    });
    if (best) return best;

    // 2. globalAirports Fallback
    if (typeof globalAirports === 'object' && globalAirports) {
        const latF = latlng.lat, lngF = latlng.lng;
        for (const icao in globalAirports) {
            const apt = globalAirports[icao];
            if (Math.abs(apt.lat - latF) > 0.5 || Math.abs(apt.lon - lngF) > 0.5) continue;
            const aptPx = map.latLngToLayerPoint([apt.lat, apt.lon]);
            const d = tapPx.distanceTo(aptPx);
            if (d < bestDist) {
                bestDist = d;
                best = { icao: apt.icao, name: apt.name || apt.city || apt.icao, lat: apt.lat, lon: apt.lon, elevation: apt.elevation ?? null };
            }
        }
    }
    return best;
}

function handleFreeflightMapClick(e) {
    if (isMapUiClickTarget(e.originalEvent)) return;
    if (ffContextPopup) { map.closePopup(ffContextPopup); ffContextPopup = null; }

    if (ffNeedsStart) {
        const apt = findNearestAirport(e.latlng, getAirportTapRadiusPx(34));
        if (apt) {
            ffWaypoints = [{ lat: apt.lat, lng: apt.lon, name: apt.icao, icao: apt.icao }];
            showMapToast('Start: ' + apt.icao + (apt.name && apt.name !== apt.icao ? ' — ' + apt.name : ''));
        } else {
            ffWaypoints = [{ lat: e.latlng.lat, lng: e.latlng.lng, name: 'Start' }];
            showMapToast('Startpunkt gesetzt');
        }
        ffNeedsStart = false;
        renderFreeflightRoute();
        return;
    }

    if (ffWaypoints.length === 0) return;

    const apt = findNearestAirport(e.latlng, getAirportTapRadiusPx(34));
    if (apt) {
        freeflightDirectTo(apt.icao, apt.lat, apt.lon);
    }
}

window.freeflightDirectTo = function(icao, lat, lon) {
    if (ffContextPopup) { map.closePopup(ffContextPopup); ffContextPopup = null; }
    // GPS-Start aktualisieren falls verfuegbar
    if (isGpsLive()) {
        const gps = window.lastLiveGpsPos;
        ffWaypoints[0] = { lat: gps.lat, lng: gps.lon, name: 'GPS' };
    }
    const startWp = ffWaypoints[0];
    const startName = startWp.icao || startWp.name || 'Start';

    // FF-Route in die Hauptroute uebertragen
    routeWaypoints = [
        { lat: startWp.lat, lng: startWp.lng },
        { lat: lat, lng: lon }
    ];
    currentSName = startName;
    currentDName = icao;
    if (typeof currentStartICAO !== 'undefined') currentStartICAO = startName;
    if (typeof currentDestICAO !== 'undefined') currentDestICAO = icao;

    // Freeflight-Modus sauber beenden (ohne Route wiederherzustellen)
    clearFreeflightRoute();
    ffWaypoints = [];
    ffNeedsStart = false;
    freeflightMode = false;
    const btn = document.getElementById('freeflightBtn');
    if (btn) { btn.innerText = '✈️ Direct To (Aus)'; btn.classList.remove('active'); btn.style.background = '#444'; btn.style.color = '#fff'; }
    document.getElementById('map').style.cursor = '';

    // Hauptroute rendern (regulaerer Bearbeitungsmodus)
    if (polyline) polyline.setStyle({ opacity: 1 });
    renderMainRoute();
    updateRoutePerformance();

    // Lufträume, Landmarks, Hindernisse/Flüsse explizit laden —
    // updateRoutePerformance() gibt früh zurück wenn kein currentMissionData gesetzt ist
    // (Direct-To aus leerer Karte), daher hier direkt triggern.
    const _ffCacheKey = routeWaypoints.map(p =>
        `${(p.lat || 0).toFixed(4)},${((p.lng || p.lon) || 0).toFixed(4)}`).join('|');
    // Cache-Keys zurücksetzen damit ein voller Neu-Fetch stattfindet
    if (window._lastLmRouteKey  !== _ffCacheKey) window._lastLmRouteKey  = null;
    if (window._lastObsRouteKey !== _ffCacheKey) window._lastObsRouteKey = null;
    // Airspaces
    if (window.airspaceFetchTimeout) clearTimeout(window.airspaceFetchTimeout);
    window.airspaceFetchTimeout = setTimeout(() => {
        if (typeof fetchRouteAirspaces === 'function') fetchRouteAirspaces(routeWaypoints);
    }, 800);
    if (typeof triggerVerticalProfileUpdate === 'function') triggerVerticalProfileUpdate();

    // Elevation, Frequenz & Pisten für beide Airports via OpenAIP laden
    const startIcao = startWp.icao || null;
    if (startIcao && startIcao !== 'GPS' && typeof fetchAirportFreq === 'function') {
        fetchAirportFreq(startIcao, 'wikiDepFreqText', 'dep');
    }
    if (typeof fetchAirportFreq === 'function') {
        fetchAirportFreq(icao, 'wikiDestFreqText', 'dest');
    }
    if (startIcao && startIcao !== 'GPS' && typeof fetchRunwayDetails === 'function') {
        fetchRunwayDetails(startWp.lat, startWp.lng, 'mDepRwy', startIcao);
    }
    if (typeof fetchRunwayDetails === 'function') {
        fetchRunwayDetails(lat, lon, 'mDestRwy', icao);
    }

    // Karte auf Route einpassen
    const bounds = L.latLngBounds(routeWaypoints.map(w => [w.lat, w.lng || w.lon]));
    map.fitBounds(bounds, { padding: [60, 60] });

    showMapToast('Direct to ' + icao);
};

function renderFreeflightRoute() {
    clearFreeflightRoute();
    if (ffWaypoints.length === 0) return;

    // Marker zeichnen
    ffWaypoints.forEach((wp, i) => {
        const icon = i === 0 ? ffStartIcon : ffDestIcon;
        const marker = L.marker([wp.lat, wp.lng], { icon: icon, interactive: false, zIndexOffset: 900 }).addTo(map);
        if (wp.name) marker.bindTooltip(wp.name, { permanent: true, direction: 'top', offset: [0, -12],
            className: 'ff-tooltip' });
        ffMarkers.push(marker);
    });

    // Polyline zeichnen
    if (ffWaypoints.length >= 2) {
        const coords = ffWaypoints.map(w => [w.lat, w.lng]);
        ffPolyline = L.polyline(coords, {
            color: '#00e5ff', weight: 6, dashArray: '12,8', opacity: 0.9, interactive: false
        }).addTo(map);

        // Nav-Info Tooltip am Mittelpunkt
        const p1 = ffWaypoints[0], p2 = ffWaypoints[1];
        const nav = calcNav(p1.lat, p1.lng, p2.lat, p2.lng);
        const midLat = (p1.lat + p2.lat) / 2, midLng = (p1.lng + p2.lng) / 2;
        const infoTooltip = L.tooltip({ permanent: true, direction: 'center', className: 'ff-nav-tooltip',
            offset: [0, -15] })
            .setLatLng([midLat, midLng])
            .setContent(`<b>${Math.round(nav.brng)}° / ${nav.dist.toFixed(1)} NM</b>`)
            .addTo(map);
        ffMarkers.push(infoTooltip);
    }
}

function showMapToast(message, durationMs) {
    if (!durationMs) durationMs = 3000;
    const container = document.getElementById('mapArea') || document.body;
    const toast = document.createElement('div');
    toast.className = 'ff-toast';
    toast.textContent = message;
    toast.style.animationDuration = durationMs + 'ms';
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, durationMs + 100);
}
