/* === VERTICAL PROFILE & CANVAS ENGINE === */
/* =========================================================
   VERTICAL PROFILE (Höhenprofil) ENGINE
   ========================================================= */
let vpElevationData = null;
let vpWeatherData = null;
let vpProfileFastTimeout = null;
let vpProfileSlowTimeout = null;
let globalCities = null;

async function loadGlobalCities() {
    if (globalCities) return;
    if (typeof window.GLOBAL_CITIES_DATA !== 'undefined') {
        globalCities = window.GLOBAL_CITIES_DATA;
        return;
    }
    try {
        const res = await fetch('./cities.json');
        if (res.ok) globalCities = await res.json();
        else globalCities = []; 
    } catch (e) { globalCities = []; }
}

let vpZoomLevel = 100; // 100 = full route, 10 = 10% view
let vpHighResData = null; // Higher resolution elevation data for zoom
let vpElevationCache = {}; // Cache to prevent API rate limits (HTTP 429)
let vpClimbRate = 500; // ft/min climb rate (configurable)
let vpDescentRate = 500; // ft/min descent rate (configurable)
let vpLandmarks = [];
let vpObstacles = [];

async function fetchProfileLandmarks(elevData) {
    if (!elevData || elevData.length < 2) return [];
    let minL = 90, maxL = -90, minLo = 180, maxLo = -180;
    elevData.forEach(p => {
        if(p.lat < minL) minL = p.lat; if(p.lat > maxL) maxL = p.lat;
        if(p.lon < minLo) minLo = p.lon; if(p.lon > maxLo) maxLo = p.lon;
    });
    minL -= 0.1; maxL += 0.1; minLo -= 0.15; maxLo += 0.15;
    let landmarks = [];
    
    await loadGlobalAirports();
    for(let k in globalAirports) {
        let a = globalAirports[k];
        if (a.lat > minL && a.lat < maxL && a.lon > minLo && a.lon < maxLo) {
            let bestD = Infinity, bestDistNM = 0;
            elevData.forEach(ep => {
                let d = calcNav(a.lat, a.lon, ep.lat, ep.lon).dist;
                if(d < bestD) { bestD = d; bestDistNM = ep.distNM; }
            });
            if (bestD < 3.5) landmarks.push({ name: a.icao, type: 'apt', pop: 100000000, distNM: bestDistNM });
        }
    }
    
    await loadGlobalCities();
    if (globalCities && globalCities.length > 0) {
        globalCities.forEach(c => {
            if (c.lat > minL && c.lat < maxL && c.lon > minLo && c.lon < maxLo) {
                let bestD = Infinity, bestDistNM = 0;
                elevData.forEach(ep => {
                    let d = calcNav(c.lat, c.lon, ep.lat, ep.lon).dist;
                    if(d < bestD) { bestD = d; bestDistNM = ep.distNM; }
                });
                if (bestD < 3.5) {
                    let cType = c.pop >= 15000 ? 'city' : 'town';
                    landmarks.push({ name: c.name, type: cType, pop: c.pop || 5000, distNM: bestDistNM });
                }
            }
        });
    }
    return landmarks.sort((a,b) => b.pop - a.pop);
}

async function fetchProfileObstacles(elevData, signal) {
    if (!elevData || elevData.length < 2) return [];

    const bboxes = [];
    let currentChunk = [];
    let chunkStart = 0;
    const CHUNK_NM = 25; // 25 NM Segmente

    for (let i = 0; i < elevData.length; i++) {
        currentChunk.push(elevData[i]);
        if (elevData[i].distNM - chunkStart >= CHUNK_NM || i === elevData.length - 1) {
            let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
            currentChunk.forEach(p => {
                if (p.lat < minLat) minLat = p.lat;
                if (p.lat > maxLat) maxLat = p.lat;
                if (p.lon < minLon) minLon = p.lon;
                if (p.lon > maxLon) maxLon = p.lon;
            });
            bboxes.push(`${(minLat - 0.035).toFixed(4)},${(minLon - 0.05).toFixed(4)},${(maxLat + 0.035).toFixed(4)},${(maxLon + 0.05).toFixed(4)}`);
            currentChunk = [elevData[i]]; 
            chunkStart = elevData[i].distNM;
        }
    }

    const BATCH_SIZE = 2; // Reduziert auf 2 Boxen (50 NM) für weniger Serverlast
    let rawObstacles = [];
    let anySuccess = false;

    console.log(`[Overpass] Starte Hindernis-Suche. ${bboxes.length} Boxen total. Teile in Batches von ${BATCH_SIZE}.`);

    for (let i = 0; i < bboxes.length; i += BATCH_SIZE) {
        const batch = bboxes.slice(i, i + BATCH_SIZE);
        let queryBody = batch.map(b => `node["generator:source"="wind"](${b});node["man_made"~"mast|tower"]["height"](${b});`).join('');
        let query = `[out:json][timeout:25];(${queryBody});out qt;`;

        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(bboxes.length / BATCH_SIZE);
        console.log(`[Overpass] Fetching Batch ${batchNum} / ${totalBatches}...`);

        let retries = 3; // Erhöht auf 3 Versuche
        let batchSuccess = false;

        while (retries > 0 && !batchSuccess) {
            try {
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

                // 1. Versuch: Hauptserver
                let res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { signal });
                
                // 2. Versuch: Wenn Hauptserver zickt, sofort auf Fallback lz4 wechseln
                if (!res.ok) {
                    console.warn(`[Overpass] Hauptserver Fehler (Status: ${res.status}) bei Batch ${batchNum}. Versuche lz4 Fallback...`);
                    res = await fetch(`https://lz4.overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { signal });
                }

                // 3. Auswertung: Bei 429 drastisch längere Pause einlegen!
                if (res.status === 429) {
                    console.warn(`[Overpass] Beide Server blocken (429 Rate Limit) bei Batch ${batchNum}. Warte 5s (Cool-Down)...`);
                    await new Promise(r => setTimeout(r, 5000)); // Längere Strafe absitzen
                    retries--;
                    continue;
                }

                if (res.ok) {
                    batchSuccess = true;
                    anySuccess = true;
                    let json = await res.json();
                    console.log(`[Overpass] Batch ${batchNum} erfolgreich. ${json.elements ? json.elements.length : 0} Rohelemente.`);
                    
                    if (json.elements) {
                        json.elements.forEach(e => {
                            if (!e.lat || !e.lon) return;
                            let isWind = e.tags && e.tags["generator:source"] === "wind";
                            let hStr = e.tags && e.tags.height ? e.tags.height : null;
                            let hMeter = hStr ? parseFloat(hStr.replace(',', '.')) : (isWind ? 120 : 50);
                            if (isNaN(hMeter) || hMeter < 30) return;
                            
                            let hFt = Math.round(hMeter * 3.28084);
                            let bestD = Infinity, bestDistNM = 0, baseElevFt = 0;
                            elevData.forEach(ep => {
                                let d = calcNav(e.lat, e.lon, ep.lat, ep.lon).dist;
                                if (d < bestD) { bestD = d; bestDistNM = ep.distNM; baseElevFt = ep.elevFt; }
                            });
                        if (bestD < 2.0) rawObstacles.push({ type: isWind ? 'wind' : 'mast', hFt: hFt, distNM: bestDistNM, elevFt: baseElevFt });
                    });
                }

                    // --- NEU: Inkrementelles Rendering der Batches ---
                    let tempBuckets = {};
                    rawObstacles.forEach(obs => {
                        let bIdx = Math.floor(obs.distNM / 0.5);
                        if (!tempBuckets[bIdx]) tempBuckets[bIdx] = [];
                        tempBuckets[bIdx].push(obs);
                    });
                    let tempFinal = [];
                    for (let k in tempBuckets) {
                        tempBuckets[k].sort((a,b) => b.hFt - a.hFt);
                        let rep = tempBuckets[k][0];
                        rep.count = tempBuckets[k].length;
                        tempFinal.push(rep);
                    }
                    // Globales Array sofort updaten und neu zeichnen lassen
                    vpObstacles = tempFinal;
                    if (typeof window.throttledRenderProfiles === 'function') {
                        window.throttledRenderProfiles();
                    }
                    // -------------------------------------------------

                } else {
                    console.warn(`[Overpass] Beide Server down für Batch ${batchNum}. Status: ${res.status}. Noch ${retries-1} Versuche.`);
                    retries--;
                    if (retries > 0) await new Promise(r => setTimeout(r, 3000));
                }
            } catch(e) {
                if (e.name === 'AbortError') {
                    console.log(`[Overpass] Abfrage abgebrochen (Route geändert).`);
                    return null; 
                }
                console.warn(`[Overpass] Netzwerkfehler: ${e.message}. Noch ${retries-1} Versuche.`);
                retries--;
                if (retries > 0) await new Promise(r => setTimeout(r, 3000));
            }
        }

        if (!batchSuccess) {
            console.error(`[Overpass] Batch ${batchNum} endgültig gescheitert. Breche ab, um unvollständigen Cache zu verhindern.`);
            return null;
        }

        // Atempause für den Server zwischen erfolgreichen Batches erhöht
        if (i + BATCH_SIZE < bboxes.length) {
            await new Promise(r => setTimeout(r, 1500)); 
        }
    }

    let buckets = {};
    rawObstacles.forEach(obs => {
        let bIdx = Math.floor(obs.distNM / 0.5);
        if (!buckets[bIdx]) buckets[bIdx] = [];
        buckets[bIdx].push(obs);
    });
    
    let finalObs = [];
    for (let k in buckets) {
        let group = buckets[k];
        group.sort((a,b) => b.hFt - a.hFt);
        let rep = group[0];
        rep.count = group.length;
        finalObs.push(rep);
    }
    
    console.log(`[Overpass] Suche komplett. ${finalObs.length} Hindernis-Gruppen nach Filterung auf der Route.`);
    return finalObs;
}

function triggerVerticalProfileUpdate() {
    if (vpProfileFastTimeout) clearTimeout(vpProfileFastTimeout);
    if (vpProfileSlowTimeout) clearTimeout(vpProfileSlowTimeout);

    if (window.vpFetchController) window.vpFetchController.abort();
    window.vpFetchController = new AbortController();
    const currentSignal = window.vpFetchController.signal;

    vpProfileFastTimeout = setTimeout(async () => {
        if (!routeWaypoints || routeWaypoints.length < 2) return;
        const cacheKey = routeWaypoints.map(p => `${(p.lat || 0).toFixed(4)},${((p.lng || p.lon) || 0).toFixed(4)}`).join('|');
        
        if (window._lastVpRouteKey !== cacheKey) {
            vpAltWaypoints = []; vpSegmentAlts = []; vpHighResData = null; vpZoomLevel = 100;
            const zd = document.getElementById('vpZoomDisplay'); if (zd) zd.textContent = '0%';
            window._lastVpRouteKey = cacheKey;
        }

        const status = document.getElementById('verticalProfileStatus');
        if (status) status.textContent = 'Lade Terrain & Orte...';

        try {
            vpElevationData = await fetchRouteElevation(routeWaypoints, currentSignal);
            
            if (window._lastLmRouteKey !== cacheKey) {
                const btnLm = document.getElementById('btnToggleLandmarks');
                if (btnLm) btnLm.classList.add('vp-loading-pulse');

                const lmStr = localStorage.getItem('ga_lms_' + cacheKey);
                if (lmStr) {
                    try { vpLandmarks = JSON.parse(lmStr); window._lastLmRouteKey = cacheKey; } catch(e) { vpLandmarks = []; }
                } else {
                    vpLandmarks = await fetchProfileLandmarks(vpElevationData);
                    if (vpLandmarks !== null) {
                        try { localStorage.setItem('ga_lms_' + cacheKey, JSON.stringify(vpLandmarks)); window._lastLmRouteKey = cacheKey; } catch(e) {}
                    }
                }
                if (btnLm) btnLm.classList.remove('vp-loading-pulse');
            }
            
            if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
        } catch(e) {
            if (e && e.name !== 'AbortError') console.error('Fast Profile Error:', e);
        }
    }, 500);

    vpProfileSlowTimeout = setTimeout(async () => {
        if (!routeWaypoints || routeWaypoints.length < 2) return;
        const cacheKey = window._lastVpRouteKey;
        const status = document.getElementById('verticalProfileStatus');
        if (status) status.textContent = 'Lade Wetter & Hindernisse...';

        try {
            if (!vpElevationData) return; 

            const btnCl = document.getElementById('btnToggleClouds');
            if (btnCl) btnCl.classList.add('vp-loading-pulse');
            vpWeatherData = await fetchRouteWeather(routeWaypoints, vpElevationData, currentSignal);
            if (btnCl) btnCl.classList.remove('vp-loading-pulse');

            if (window._lastObsRouteKey !== cacheKey) {
                const btnOb = document.getElementById('btnToggleObstacles');
                if (btnOb) btnOb.classList.add('vp-loading-pulse');

                const obStr = localStorage.getItem('ga_obs_' + cacheKey);
                if (obStr) {
                    try { vpObstacles = JSON.parse(obStr); window._lastObsRouteKey = cacheKey; } catch(e) { vpObstacles = []; }
                } else {
                    vpObstacles = await fetchProfileObstacles(vpElevationData, currentSignal);
                    if (vpObstacles !== null) { 
                        try { localStorage.setItem('ga_obs_' + cacheKey, JSON.stringify(vpObstacles)); window._lastObsRouteKey = cacheKey; } catch(e) {}
                    }
                }
                if (btnOb) btnOb.classList.remove('vp-loading-pulse');
            }
            if (status) status.textContent = vpElevationData.length + ' Punkte & API-Daten geladen';
        } catch(e) {
            if (e && e.name !== 'AbortError') console.error('Slow Profile Error:', e);
            if (status) status.textContent = 'API Limit erreicht';
        } finally {
            const bC = document.getElementById('btnToggleClouds'); if(bC) bC.classList.remove('vp-loading-pulse');
            const bO = document.getElementById('btnToggleObstacles'); if(bO) bO.classList.remove('vp-loading-pulse');
            if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
        }
    }, 2800);
}

async function fetchRouteElevation(routePts, signal) {
    if (!routePts || routePts.length < 2) return [];

    // Generate a unique cache key based on route coordinates
    const cacheKey = routePts.map(p => `${(p.lat || 0).toFixed(4)},${((p.lng || p.lon) || 0).toFixed(4)}`).join('|');
    if (vpElevationCache[cacheKey]) {
        return vpElevationCache[cacheKey];
    }

    try {
        const stored = localStorage.getItem('ga_elev_cache_' + cacheKey);
        if (stored) {
            const data = JSON.parse(stored);
            vpElevationCache[cacheKey] = data;
            return data;
        }
    } catch (e) { }

    const interpolated = [];
    let cumulativeDist = 0;

    for (let i = 0; i < routePts.length - 1; i++) {
        const p1 = routePts[i], p2 = routePts[i + 1];
        const lat1 = p1.lat, lon1 = p1.lng || p1.lon;
        const lat2 = p2.lat, lon2 = p2.lng || p2.lon;
        const segDist = calcNav(lat1, lon1, lat2, lon2).dist;
        const steps = Math.max(1, Math.round(segDist));

        for (let j = 0; j <= steps; j++) {
            if (i > 0 && j === 0) continue;
            const f = j / steps;
            interpolated.push({
                lat: lat1 + (lat2 - lat1) * f,
                lon: lon1 + (lon2 - lon1) * f,
                distNM: cumulativeDist + segDist * f
            });
        }
        cumulativeDist += segDist;
    }

    let samplePts = interpolated;
    if (interpolated.length > 100) {
        samplePts = [];
        for (let i = 0; i < 100; i++) {
            const idx = Math.round(i * (interpolated.length - 1) / 99);
            samplePts.push(interpolated[idx]);
        }
    }

    const lats = samplePts.map(p => p.lat.toFixed(4)).join(',');
    const lons = samplePts.map(p => p.lon.toFixed(4)).join(',');

    try {
        const res = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + lats + '&longitude=' + lons, { signal });
        if (!res.ok) throw new Error('Elevation API error: ' + res.status);
        const data = await res.json();

        if (!data.elevation || data.elevation.length !== samplePts.length) {
            throw new Error('Invalid elevation response');
        }

        const finalData = samplePts.map((p, i) => ({
            distNM: p.distNM,
            elevFt: Math.round(data.elevation[i] * 3.28084),
            lat: p.lat,
            lon: p.lon
        }));

        vpElevationCache[cacheKey] = finalData;
        try { localStorage.setItem('ga_elev_cache_' + cacheKey, JSON.stringify(finalData)); } catch (e) { }
        return finalData;
    } catch (e) {
        if (e && e.name === 'AbortError') return null;
        throw e;
    }
}

async function fetchRouteWeather(routePts, elevData, signal) {
    if (!routePts || routePts.length < 2 || !elevData || elevData.length < 2) return null;
    window._weatherCache = window._weatherCache || {};
    // Koordinaten als Key (sobald sich die Route ändert, verfällt der Cache)
    const weatherKey = routePts.map(p => `${(p.lat || 0).toFixed(2)},${((p.lng || p.lon) || 0).toFixed(2)}`).join('|');
    if (window._weatherCache[weatherKey] && (Date.now() - window._weatherCache[weatherKey].time) < 15 * 60000) {
        return window._weatherCache[weatherKey].data;
    }
    const totalDist = elevData[elevData.length - 1].distNM;
    const numZones = 10;
    const zones = [];
    const fetchPromises = [];
    for (let i = 0; i < numZones; i++) {
        const targetDist = (i / (numZones - 1)) * totalDist;
        let bestPt = elevData[0];
        let minDiff = Infinity;
        for (const pt of elevData) {
            const diff = Math.abs(pt.distNM - targetDist);
            if (diff < minDiff) { minDiff = diff; bestPt = pt; }
        }
        const minLat = Number((bestPt.lat - 0.4).toFixed(4));
        const maxLat = Number((bestPt.lat + 0.4).toFixed(4));
        const minLon = Number((bestPt.lon - 0.6).toFixed(4));
        const maxLon = Number((bestPt.lon + 0.6).toFixed(4));
        const url = `https://aviationweather.gov/api/data/metar?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json&t=${Date.now()}`;
        const p = fetch(url, { signal }).then(async r => {
            if (r.status === 204) return [];
            if (!r.ok) throw new Error("HTTP " + r.status);
            return JSON.parse(await r.text());
        }).catch(async e => {
            if (e && e.name === 'AbortError') return null;
            try {
                const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;
                const pr = await fetch(proxyUrl, { signal });
                if (pr.status === 204) return [];
                if (!pr.ok) throw new Error("Proxy Error");
                return JSON.parse(await pr.text());
            } catch(px) { 
                if (px && px.name === 'AbortError') return null;
                return []; 
            }
        }).then(metars => ({ targetDist, bestPt, metars, index: i }));
        fetchPromises.push(p);
    }
    const results = await Promise.all(fetchPromises);
    for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (!res.metars || res.metars.length === 0) continue;
        let closestMetar = null, minMetarDist = Infinity;
        res.metars.forEach(m => {
            const d = calcNav(res.bestPt.lat, res.bestPt.lon, m.lat, m.lon).dist;
            if (d < minMetarDist) { minMetarDist = d; closestMetar = m; }
        });
        if (closestMetar && minMetarDist < 45) {
            const clouds = [];
            const raw = closestMetar.rawOb || "";
            const stnElevFt = closestMetar.elev ? closestMetar.elev * 3.28084 : 0;
            const cloudRegex = /(FEW|SCT|BKN|OVC|VV)(\d{3})/g;
            let match, lowestBase = Infinity;
            while((match = cloudRegex.exec(raw)) !== null) {
                const type = match[1];
                const agl = parseInt(match[2], 10) * 100;
                const msl = Math.round(agl + stnElevFt);
                if (msl < lowestBase) lowestBase = msl;
                clouds.push({ type, baseAgl: agl, baseMsl: msl });
            }
            const hasRain = /\b(-|\+)?(RA|DZ|SH|SHRA)\b/i.test(raw);
            const hasSnow = /\b(-|\+)?(SN|SG|PL|SHSN)\b/i.test(raw);
            const hasTS = /\b(-|\+)?(TS|TSRA|CB)\b/i.test(raw);
            if(clouds.length > 0 || hasRain || hasSnow || hasTS) {
                const visuals = { puffs: [], drops: [], flashes: [] };
                if (clouds.length > 0) {
                    for(let c=0; c<25; c++) visuals.puffs.push({ x: Math.random(), y: Math.random(), r: Math.random(), op: Math.random() });
                }
                if (hasRain || hasSnow) {
                    for(let d=0; d<45; d++) visuals.drops.push({ x: Math.random(), y: Math.random(), spd: Math.random() });
                }
                if (hasTS) {
                    for(let f=0; f<2; f++) visuals.flashes.push({ x: Math.random(), pts: [Math.random(), Math.random(), Math.random(), Math.random()] });
                }
                zones.push({
                    distNM: res.bestPt.distNM, icao: closestMetar.icaoId, clouds: clouds,
                    lowestBase: lowestBase !== Infinity ? lowestBase : 5000,
                    weather: { hasRain, hasSnow, hasTS }, visuals: visuals
                });
            }
        }
    }
    if (zones.length > 0) {
        window._weatherCache[weatherKey] = { time: Date.now(), data: zones };
        return zones;
    }
    return null;
}
// Globale Debug-Funktion für die Entwicklerkonsole
window.debugCloudProfile = function() {
    console.log("=== MANUELLER CLOUD DEBUG START ===");
    if (!routeWaypoints || routeWaypoints.length < 2) {
        console.warn("Bitte erst einen Flugauftrag generieren (Route fehlt).");
        return;
    }
    triggerVerticalProfileUpdate();
    console.log("Update angetriggert. Bitte das Profil-Canvas öffnen und die Logs beobachten.");
};
function vpDrawLandmarks(ctx, xOf, yOf, elevData, totalDist, isDarkTheme, zoomFactor) {
    if (!vpLandmarks || vpLandmarks.length === 0) return;
    const getElevY = (dNM) => {
        if (!elevData || elevData.length < 2) return yOf(0);
        for(let i=0; i<elevData.length-1; i++) {
            if (dNM >= elevData[i].distNM && dNM <= elevData[i+1].distNM) {
                const f = (dNM - elevData[i].distNM) / (elevData[i+1].distNM - elevData[i].distNM);
                return yOf(elevData[i].elevFt + f * (elevData[i+1].elevFt - elevData[i].elevFt));
            }
        }
        return yOf(elevData[elevData.length-1].elevFt);
    };
    
    let viewMinX = -Infinity, viewMaxX = Infinity;
    if (ctx.canvas.id === 'mapProfileCanvas') {
        const sc = document.getElementById('mapProfileScroll');
        if (sc) { viewMinX = sc.scrollLeft - 200; viewMaxX = sc.scrollLeft + sc.clientWidth + 200; }
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let occupiedX = [];
    let countDrawn = 0;
    const edgePad = Math.min(2.5, totalDist * 0.05); // Dynamischer Rand-Puffer
    for (const lm of vpLandmarks) {
        if (lm.distNM < edgePad || lm.distNM > totalDist - edgePad) continue;
        const px = xOf(lm.distNM);
        if (px < viewMinX || px > viewMaxX) continue; // CULLING
        const icon = lm.type === 'apt' ? '🛫' : (lm.type === 'city' ? '🏢' : '🏘️');
        const fontSize = (zoomFactor >= 1.5) ? 10 : 8;

        ctx.font = `bold ${fontSize}px Arial`;
        const textWidth = ctx.measureText(lm.name).width;
        const reqWidth = Math.max(textWidth, 14) + 6;
        const minX = px - reqWidth / 2;
        const maxX = px + reqWidth / 2;
        let collision = false;
        for (const occ of occupiedX) {
            if (minX < occ.maxX && maxX > occ.minX) { collision = true; break; }
        }
        if (!collision) {
            occupiedX.push({ minX, maxX });
            const py = getElevY(lm.distNM);
            ctx.font = '11px Arial';
            ctx.fillText(icon, px, py - 6);
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.fillStyle = isDarkTheme ? 'rgba(190, 180, 160, 0.7)' : 'rgba(70, 60, 40, 0.7)';
            ctx.fillText(lm.name, px, py + 10);
            countDrawn++;
        }
    }
    ctx.restore();
    window.vpLandmarkOccupiedX = occupiedX; // Speichert den belegten Platz für die Hindernisse
    if(countDrawn === 0 && vpLandmarks.length > 0) console.log("⚠️ Landmarks wurden geladen, aber durch Kollision/Rand abgeschnitten!");
}

function vpDrawObstacles(ctx, xOf, yOf, totalDist, zoomFactor, elevData) {
    if (!vpObstacles || vpObstacles.length === 0) return;
    const edgePad = Math.min(1.0, totalDist * 0.02);
    
    const getElevY = (dNM) => {
        if (!elevData || elevData.length < 2) return yOf(0);
        for (let i = 0; i < elevData.length - 1; i++) {
            if (dNM >= elevData[i].distNM && dNM <= elevData[i+1].distNM) {
                const f = (dNM - elevData[i].distNM) / (elevData[i+1].distNM - elevData[i].distNM);
                return yOf(elevData[i].elevFt + f * (elevData[i+1].elevFt - elevData[i].elevFt));
            }
        }
        return yOf(elevData[elevData.length - 1].elevFt);
    };

    let viewMinX = -Infinity, viewMaxX = Infinity;
    if (ctx.canvas.id === 'mapProfileCanvas') {
        const sc = document.getElementById('mapProfileScroll');
        if (sc) { viewMinX = sc.scrollLeft - 200; viewMaxX = sc.scrollLeft + sc.clientWidth + 200; }
    }
    
    ctx.save();
    
    // 1. Alle Masten zeichnen und Label-Positionen sammeln
    let rawLabels = [];
    
    for (const obs of vpObstacles) {
        if (obs.distNM < edgePad || obs.distNM > totalDist - edgePad) continue;
        const px = xOf(obs.distNM);
        if (px < viewMinX || px > viewMaxX) continue; // CULLING
        const pyGround = getElevY(obs.distNM);
        const heightPx = Math.abs(yOf(obs.hFt) - yOf(0));
        const pyTop = pyGround - heightPx;
        const towerHeightPx = Math.max(1, heightPx);
        const pyRoot = pyGround + 8; 

        if (obs.type === 'wind') {
            // Strikt proportionale Skalierung: Rotorblätter sind exakt 45% der Masthöhe, egal bei welchem Zoom!
            const r = Math.max(1, towerHeightPx * 0.45);
            const pyHub = pyTop + r;                                   

            ctx.beginPath();
            ctx.moveTo(px, pyRoot);
            ctx.lineTo(px, pyHub);
            ctx.strokeStyle = 'rgba(230, 230, 230, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#f5f5f5';
            ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)';
            ctx.lineWidth = 0.5;
            const rotOffset = (obs.distNM * 137) % (Math.PI * 2);
            for (let i = 0; i < 3; i++) {
                const a = rotOffset + (i * 120 - 90) * Math.PI / 180;
                ctx.beginPath();
                ctx.moveTo(px, pyHub);
                ctx.lineTo(px + Math.cos(a - 0.2) * r * 0.25, pyHub + Math.sin(a - 0.2) * r * 0.25);
                ctx.lineTo(px + Math.cos(a) * r,               pyHub + Math.sin(a) * r);
                ctx.lineTo(px + Math.cos(a + 0.2) * r * 0.25, pyHub + Math.sin(a + 0.2) * r * 0.25);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(px, pyHub, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#ccc'; ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(px, pyRoot);
            ctx.lineTo(px, pyTop);
            ctx.strokeStyle = 'rgba(80, 80, 80, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            const alpha = 0.4 + ((obs.distNM * 88) % 100) / 100 * 0.6;
            ctx.beginPath(); ctx.arc(px, pyTop, 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(217, 56, 41, ${alpha})`; ctx.fill();
        }

        rawLabels.push({ x: px, yBase: pyRoot, count: obs.count || 1 });
    }
    
    // 2. Labels abhängig vom Zoom/Pixelabstand clustern
    rawLabels.sort((a, b) => a.x - b.x);
    let clusters = [];
    const MIN_LABEL_DIST = 22; 

    for (const lbl of rawLabels) {
        if (clusters.length === 0) {
            clusters.push({ sumX: lbl.x, sumY: lbl.yBase, count: lbl.count, items: 1 });
        } else {
            let last = clusters[clusters.length - 1];
            let avgX = last.sumX / last.items; 
            
            if (lbl.x - avgX < MIN_LABEL_DIST) {
                last.sumX += lbl.x;
                last.sumY += lbl.yBase;
                last.count += lbl.count;
                last.items += 1;
            } else {
                clusters.push({ sumX: lbl.x, sumY: lbl.yBase, count: lbl.count, items: 1 });
            }
        }
    }

    // 3. Cluster-Labels zeichnen (ohne Schatten, reine Schrift)
    ctx.fillStyle = '#d93829';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const cl of clusters) {
        if (cl.count <= 1) continue; 
        
        const px = cl.sumX / cl.items;
        const pyBase = cl.sumY / cl.items;
        
        let collision = false;
        const textWidth = 18; 
        const minX = px - textWidth / 2;
        const maxX = px + textWidth / 2;
        
        if (window.vpLandmarkOccupiedX) {
            for (const occ of window.vpLandmarkOccupiedX) {
                if (minX < occ.maxX + 4 && maxX > occ.minX - 4) {
                    collision = true; break;
                }
            }
        }
        
        if (!collision) {
            ctx.fillText('×' + cl.count, px, pyBase + 2);
        }
    }
    
    ctx.restore();
}

function vpDrawClouds(ctx, xOf, yOf, padTop, plotH, totalDist, isDarkTheme, elevData) {
    if (!vpWeatherData || vpWeatherData.length === 0) return;
    const getElevY = (dNM) => {
        if (!elevData || elevData.length < 2) return yOf(0);
        for(let i=0; i<elevData.length-1; i++) {
            if (dNM >= elevData[i].distNM && dNM <= elevData[i+1].distNM) {
                const f = (dNM - elevData[i].distNM) / (elevData[i+1].distNM - elevData[i].distNM);
                return yOf(elevData[i].elevFt + f * (elevData[i+1].elevFt - elevData[i].elevFt));
            }
        }
        return yOf(elevData[elevData.length-1].elevFt);
    };

    let viewMinX = -Infinity, viewMaxX = Infinity;
    if (ctx.canvas.id === 'mapProfileCanvas') {
        const sc = document.getElementById('mapProfileScroll');
        if (sc) { viewMinX = sc.scrollLeft - 200; viewMaxX = sc.scrollLeft + sc.clientWidth + 200; }
    }
    // Stabiler, deterministischer Pseudo-Zufallsgenerator gegen Flackern
    const prng = (s) => { let x = Math.sin(s) * 10000; return x - Math.floor(x); };
    ctx.save();
    for (let i = 0; i < vpWeatherData.length; i++) {
        const zone = vpWeatherData[i];
        const prevDist = (i > 0) ? (zone.distNM + vpWeatherData[i-1].distNM)/2 : Math.max(0, zone.distNM - totalDist*0.05);
        const nextDist = (i < vpWeatherData.length - 1) ? (zone.distNM + vpWeatherData[i+1].distNM)/2 : Math.min(totalDist, zone.distNM + totalDist*0.05);
        const startX = xOf(prevDist), endX = xOf(nextDist), width = endX - startX, midX = startX + width/2;
        
        if (endX < viewMinX || startX > viewMaxX) continue; // CULLING
        // 1. REGEN & SCHNEE
        if (zone.weather && (zone.weather.hasRain || zone.weather.hasSnow) && zone.lowestBase) {
            const baseY = yOf(zone.lowestBase);
            ctx.beginPath();
            for(let d=0; d<35; d++) {
                const pxRand = prng(i * 200 + d + 0.1), pyRand = prng(i * 200 + d + 0.2), spdRand = prng(i * 200 + d + 0.3);
                const dropX = startX + pxRand * width, dNM = prevDist + pxRand * (nextDist - prevDist);
                const groundY = getElevY(dNM);
                if (baseY < groundY) {
                    if (zone.weather.hasSnow) {
                        const sy = baseY + pyRand * (groundY - baseY);
                        ctx.moveTo(dropX, sy); ctx.arc(dropX, sy, 0.8 + spdRand, 0, Math.PI*2);
                    } else {
                        const ry1 = baseY + pyRand * (groundY - baseY);
                        const ry2 = Math.min(groundY, ry1 + 6 + spdRand * 4);
                        ctx.moveTo(dropX, ry1); ctx.lineTo(dropX - 1 - spdRand*2, ry2);
                    }
                }
            }
            ctx.fillStyle = zone.weather.hasSnow ? 'rgba(255,255,255,0.8)' : 'rgba(80, 150, 255, 0.6)';
            ctx.strokeStyle = zone.weather.hasSnow ? 'rgba(255,255,255,0.8)' : 'rgba(80, 150, 255, 0.5)';
            ctx.lineWidth = 1.5;
            if (zone.weather.hasSnow) ctx.fill(); else ctx.stroke();
        }
        // 2. BLITZE
        if (zone.weather && zone.weather.hasTS && zone.lowestBase) {
            const baseY = yOf(zone.lowestBase);
            ctx.beginPath();
            for(let f=0; f<2; f++) {
                const fxRand = prng(i * 300 + f + 0.1);
                const fx = startX + width * 0.2 + fxRand * width * 0.6;
                const groundY = getElevY(prevDist + fxRand * (nextDist - prevDist));
                if (baseY < groundY) {
                    const stepY = (groundY - baseY) / 4;
                    ctx.moveTo(fx, baseY);
                    ctx.lineTo(fx + (prng(i*300+f+0.2)-0.5)*15, baseY + stepY);
                    ctx.lineTo(fx + (prng(i*300+f+0.3)-0.5)*15, baseY + stepY*2);
                    ctx.lineTo(fx + (prng(i*300+f+0.4)-0.5)*15, baseY + stepY*3);
                    ctx.lineTo(fx + (prng(i*300+f+0.5)-0.5)*15, groundY);
                }
            }
            ctx.strokeStyle = 'rgba(255, 230, 100, 0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        // 3. WOLKEN (PUFFS) – Zoom-adaptiv, isolierte Zellen für FEW/SCT
        if (zone.clouds && zone.clouds.length > 0) {
            zone.clouds.forEach((c, cIdx) => {
                const baseY = yOf(c.baseMsl);
                let thicknessFt = 600, baseColor = isDarkTheme ? 210 : 255;
                let coverage = 1.0, radiusMult = 1.0, numCells = 4;
                // Logik für isolierte Grüppchen (mehr Zellen = kleinere Wölkchen)
                if (c.type === 'FEW') { thicknessFt = 800; coverage = 0.22; radiusMult = 0.35; numCells = 16; }
                else if (c.type === 'SCT') { thicknessFt = 1500; baseColor -= 15; coverage = 0.45; radiusMult = 0.6; numCells = 10; }
                else if (c.type === 'BKN') { thicknessFt = 3000; baseColor -= 40; coverage = 0.80; radiusMult = 0.9; numCells = 6; }
                else if (c.type === 'OVC' || c.type === 'VV') { thicknessFt = 5000; baseColor -= 70; coverage = 1.0; }
                if (zone.weather && zone.weather.hasTS) { thicknessFt = Math.max(thicknessFt, 12000); baseColor -= 60; coverage = 1.0; radiusMult = 1.1; numCells = 4; }
                const topY = yOf(c.baseMsl + thicknessFt), layerHeight = baseY - topY;
                if (baseY < padTop - 20 || topY > padTop + plotH + 20) return;
                // Zoom-abhängige Skalierung: Beim Rauszoomen wird 'width' klein -> Wolken werden winzig!
                const maxRadiusY = Math.abs(yOf(1000) - yOf(0));
                const maxRadiusX = width * (2.5 / numCells);
                const maxR = Math.max(2, Math.min(maxRadiusY, maxRadiusX)) * radiusMult;

                const seedBase = i * 100 + cIdx * 10;

                ctx.save();
                ctx.beginPath();
                ctx.rect(startX - 2000, 0, width + 4000, baseY);
                ctx.clip();
                const numPuffs = c.type === 'FEW' ? 40 : 60;
                for (let p = 0; p < numPuffs; p++) {
                    const pxRand = prng(seedBase + p + 0.1);

                    const cellIndex = Math.floor(pxRand * numCells);
                    const cellActive = prng(seedBase + cellIndex * 77) < coverage;
                    if (!cellActive) continue;
                    let localPx = pxRand;
                    // Bei FEW/SCT zwingen wir die Puffs in die Mitte der Zelle (0.2 bis 0.8), um Gaps zu garantieren!
                    if (c.type === 'FEW' || c.type === 'SCT') {
                        const cellStart = cellIndex / numCells;
                        const puffInCell = prng(seedBase + p + 0.5);
                        localPx = cellStart + (0.2 + puffInCell * 0.6) / numCells;
                    }
                    const pyRand = prng(seedBase + p + 0.2);
                    const prRand = prng(seedBase + p + 0.3);
                    const opRand = prng(seedBase + p + 0.4);
                    // OVC überlappt stark, FEW/SCT bleiben strikt in ihrer Zone
                    const px = (c.type === 'FEW' || c.type === 'SCT')
                        ? startX + localPx * width
                        : startX + (localPx * 1.2 - 0.1) * width;
                    const py = baseY - pyRand * layerHeight;
                    const pr = 2 + prRand * maxR;

                    const cVal = Math.floor(baseColor - opRand * 30);
                    const alpha = (c.type === 'FEW') ? (0.15 + opRand * 0.2) : ((c.type === 'SCT') ? (0.3 + opRand * 0.3) : (0.5 + opRand * 0.4));

                    ctx.beginPath();
                    ctx.arc(px, py, pr, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${cVal},${cVal},${cVal},${alpha})`;

                    // Performance-Fix: Weiche Ränder deaktivieren, während UI-Interaktion ODER Fast-Render-Modus aktiv ist!
                    const isDragging = (typeof vpDraggingWP !== 'undefined' && vpDraggingWP >= 0) ||
                                       (typeof vpDraggingSegment !== 'undefined' && !!vpDraggingSegment) ||
                                       (typeof vpResizeActive !== 'undefined' && vpResizeActive) ||
                                       (window.vpUIInteractionActive === true) ||
                                       (window.vpIsFastRendering === true);
                    if (!isDragging) {
                        ctx.shadowColor = `rgba(${cVal},${cVal},${cVal},${alpha})`;
                        ctx.shadowBlur = 4 + prRand * 8;
                    } else {
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                    }

                    ctx.fill();
                }
                ctx.restore();

                ctx.fillStyle = isDarkTheme ? '#ccc' : '#222';
                ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
                ctx.fillText(c.type, midX, baseY + 12);
            });
        }
    }
    ctx.restore();
}

function computeFlightProfile(elevationData, cruiseAltFt, climbRateFpm, descentRateFpm, tasKts) {
    if (!elevationData || elevationData.length < 2) return null;

    const depElevFt = elevationData[0].elevFt;
    let destElevFt = elevationData[elevationData.length - 1].elevFt;
    // If destination is a POI, stay at cruise altitude (no descent)
    if (typeof currentMissionData !== 'undefined' && currentMissionData && currentMissionData.poiName) {
        destElevFt = cruiseAltFt;
    }
    const totalDistNM = elevationData[elevationData.length - 1].distNM;

    const climbFt = Math.max(0, cruiseAltFt - depElevFt);
    const climbTimeMin = climbFt / climbRateFpm;
    const climbDistNM = (climbTimeMin / 60) * tasKts * 0.85;

    const descentFt = Math.max(0, cruiseAltFt - destElevFt);
    const descentTimeMin = descentFt / descentRateFpm;
    const descentDistNM = (descentTimeMin / 60) * tasKts * 0.9;

    const tocDistNM = Math.min(climbDistNM, totalDistNM * 0.4);
    const todDistNM = Math.max(totalDistNM - descentDistNM, totalDistNM * 0.6);

    const profile = [];
    for (const pt of elevationData) {
        let altFt;
        if (pt.distNM <= tocDistNM) {
            const f = tocDistNM > 0 ? pt.distNM / tocDistNM : 1;
            altFt = depElevFt + (cruiseAltFt - depElevFt) * f;
        } else if (pt.distNM >= todDistNM) {
            const f = (totalDistNM - todDistNM) > 0 ? (pt.distNM - todDistNM) / (totalDistNM - todDistNM) : 1;
            altFt = cruiseAltFt - (cruiseAltFt - destElevFt) * f;
        } else {
            altFt = cruiseAltFt;
        }
        profile.push({ distNM: pt.distNM, altFt: Math.round(altFt) });
    }

    return { profile, tocDistNM, todDistNM };
}
function getCachedAirspaceIntersections(elevData, totalDist) {
    const asCacheKey = (window._lastVpRouteKey || 'none') + '_' + activeAirspaces.length;
    if (window._vpAsCache && window._vpAsCache.key === asCacheKey && window._vpAsCache.elevLength === elevData.length) {
        return window._vpAsCache.items;
    }
    
    let items = [];
    for (let asIdx = 0; asIdx < activeAirspaces.length; asIdx++) {
        const as = activeAirspaces[asIdx];
        if (as.type === 33) continue;
        if (!as.lowerLimit || !as.upperLimit) continue;
        const lowerFt = airspaceLimitToFt(as.lowerLimit);
        const upperFt = airspaceLimitToFt(as.upperLimit);
        if (lowerFt === null || upperFt === null) continue;

        const isLowerAgl = as.lowerLimit.referenceDatum === 0;
        const isUpperAgl = as.upperLimit.referenceDatum === 0;

        let asMinDist = totalDist, asMaxDist = 0, found = false;
        const polys = [];
        if (as.geometry) {
            if (as.geometry.type === 'Polygon') polys.push(as.geometry.coordinates[0]);
            else if (as.geometry.type === 'MultiPolygon') as.geometry.coordinates.forEach(mc => polys.push(mc[0]));

            for (let pi = 0; pi < elevData.length; pi++) {
                const pt = elevData[pi];
                for (const poly of polys) {
                    if (vpPointInPoly(pt, poly)) {
                        if (pt.distNM < asMinDist) asMinDist = pt.distNM;
                        if (pt.distNM > asMaxDist) asMaxDist = pt.distNM;
                        found = true; break;
                    }
                }
                if (!found && pi < elevData.length - 1) {
                    const pt2 = elevData[pi + 1];
                    for (const poly of polys) {
                        for (let ei = 0, ej = poly.length - 1; ei < poly.length; ej = ei++) {
                            const ax = poly[ej][0], ay = poly[ej][1], bx = poly[ei][0], by = poly[ei][1];
                            const d1x = pt2.lon-pt.lon, d1y = pt2.lat-pt.lat;
                            const d2x = bx-ax, d2y = by-ay;
                            const cross = d1x*d2y - d1y*d2x;
                            if (Math.abs(cross) < 1e-12) continue;
                            const t = ((ax-pt.lon)*d2y - (ay-pt.lat)*d2x) / cross;
                            const u = ((ax-pt.lon)*d1y - (ay-pt.lat)*d1x) / cross;
                            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                                const crossDist = pt.distNM + t * (pt2.distNM - pt.distNM);
                                if (crossDist < asMinDist) asMinDist = crossDist;
                                if (crossDist > asMaxDist) asMaxDist = crossDist;
                                found = true; break;
                            }
                        }
                        if (found) break;
                    }
                }
            }
        }
        if (!found) continue;

        const eps = (elevData.length > 1) ? (elevData[1].distNM - elevData[0].distNM) * 0.5 : 0.5;
        const relevantPts = elevData.filter(p => p.distNM >= asMinDist - eps && p.distNM <= asMaxDist + eps);
        if (relevantPts.length < 1) continue;

        items.push({ asIdx, as, lowerFt, upperFt, isLowerAgl, isUpperAgl, asMinDist, asMaxDist, relevantPts });
    }
    window._vpAsCache = { key: asCacheKey, elevLength: elevData.length, items: items };
    return items;
}


function renderVerticalProfile(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !vpElevationData || vpElevationData.length < 2) return;

    const container = canvas.parentElement;
    const displayWidth = container.clientWidth || 400;
    const displayHeight = Math.round(displayWidth * 0.4);

    const dpr = window.devicePixelRatio || 1;
    const targetW = displayWidth * dpr;
    const targetH = displayHeight * dpr;

    const ctx = canvas.getContext('2d');
    
    // Performance Fix für das kleine Diagramm
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = '100%';
        canvas.style.maxWidth = displayWidth + 'px';
        canvas.style.height = 'auto';
        ctx.scale(dpr, dpr);
    } else {
        ctx.clearRect(0, 0, displayWidth, displayHeight);
    }

    const padLeft = 45, padRight = 15, padTop = 20, padBottom = 30;
    const plotW = displayWidth - padLeft - padRight;
    const plotH = displayHeight - padTop - padBottom;

    const cruiseAlt = parseInt(document.getElementById('altSlider')?.value || 4500);
    const tas = parseInt(document.getElementById('tasSlider')?.value || 115);
    const totalDist = vpElevationData[vpElevationData.length - 1].distNM;
    const maxTerrain = Math.max(...vpElevationData.map(p => p.elevFt));
    let maxCloudAlt = 0;
    if (vpShowClouds && vpWeatherData) {
        vpWeatherData.forEach(zone => {
            if (zone.clouds) zone.clouds.forEach(c => {
                if (c.baseMsl > maxCloudAlt) maxCloudAlt = c.baseMsl;
            });
        });
    }
    let autoMaxAlt = Math.max(cruiseAlt + 2500, maxTerrain + 1000);
    const maxAlt = vpMaxAltOverride > 0 ? vpMaxAltOverride : autoMaxAlt;
    const minAlt = 0;

    const fpResult = computeFlightProfile(vpElevationData, cruiseAlt, vpClimbRate, vpDescentRate, tas);

    const xOf = (distNM) => padLeft + (distNM / totalDist) * plotW;
    const yOf = (altFt) => padTop + plotH - ((altFt - minAlt) / (maxAlt - minAlt)) * plotH;

    // Background
    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(0.5, '#c8e6f8');
    skyGrad.addColorStop(1, '#e8f4f8');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(padLeft, padTop, plotW, plotH);

    // Airspace blocks
    let occupiedASLabels = [];
    if (typeof activeAirspaces !== 'undefined' && activeAirspaces.length > 0) {
        const cachedAirspaces = getCachedAirspaceIntersections(vpElevationData, totalDist);
        for (const item of cachedAirspaces) {
            const { asIdx, as, lowerFt, upperFt, isLowerAgl, isUpperAgl, asMinDist, asMaxDist, relevantPts } = item;
            
            const style = getAirspaceStyle(as);
            const x1 = xOf(asMinDist), x2 = xOf(asMaxDist);

            ctx.fillStyle = vpHexToRgba(style.color, 0.15);
            ctx.strokeStyle = vpHexToRgba(style.color, 0.4);
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);

            ctx.beginPath();
            for (let i = 0; i < relevantPts.length; i++) {
                const p = relevantPts[i];
                const realUpper = isUpperAgl ? p.elevFt + upperFt : upperFt;
                ctx.lineTo(xOf(p.distNM), yOf(Math.min(realUpper, maxAlt)));
            }
            for (let i = relevantPts.length - 1; i >= 0; i--) {
                const p = relevantPts[i];
                const realLower = isLowerAgl ? p.elevFt + lowerFt : lowerFt;
                ctx.lineTo(xOf(p.distNM), yOf(Math.max(realLower, minAlt)));
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            let sumUpper = 0;
            relevantPts.forEach(p => sumUpper += (isUpperAgl ? p.elevFt + upperFt : upperFt));
            const avgUpper = sumUpper / relevantPts.length;

            let labelY = yOf(Math.min(avgUpper, maxAlt));
            labelY = Math.max(padTop + 15, labelY);
            const displayName = getAirspaceDisplayName(as);
            ctx.font = 'bold 8px Arial';
            const tw = ctx.measureText(displayName).width;
            const tLeft = ((x1 + x2) / 2) - tw/2, tRight = tLeft + tw;

            let collision = false;
            for(let occ of occupiedASLabels) {
                if (tLeft < occ.r && tRight > occ.l && labelY < occ.b && (labelY+20) > occ.t) { collision = true; break; }
            }
            if (!collision) {
                occupiedASLabels.push({l: tLeft-5, r: tRight+5, t: labelY-5, b: labelY+20});
                ctx.fillStyle = vpHexToRgba(style.color, 0.7);
                ctx.textAlign = 'center';
                ctx.fillText(displayName, (x1 + x2) / 2, labelY + 10);
                ctx.font = '7px Arial';
                ctx.fillText(formatAsLimit(as.lowerLimit) + ' – ' + formatAsLimit(as.upperLimit), (x1 + x2) / 2, labelY + 19);
            }
        }
    }
    ctx.textAlign = 'left';

    // Safety line (terrain + 1000ft)
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(200, 80, 0, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < vpElevationData.length; i++) {
        const x = xOf(vpElevationData[i].distNM), y = yOf(vpElevationData[i].elevFt + 1000);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Terrain polygon
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(0));
    for (let i = 0; i < vpElevationData.length; i++) ctx.lineTo(xOf(vpElevationData[i].distNM), yOf(vpElevationData[i].elevFt));
    ctx.lineTo(xOf(totalDist), yOf(0));
    ctx.closePath();

    const terrainGrad = ctx.createLinearGradient(0, yOf(maxTerrain), 0, yOf(0));
    terrainGrad.addColorStop(0, '#8B7355');
    terrainGrad.addColorStop(0.3, '#6B8E23');
    terrainGrad.addColorStop(0.7, '#228B22');
    terrainGrad.addColorStop(1, '#2E8B57');
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < vpElevationData.length; i++) {
        const x = xOf(vpElevationData[i].distNM), y = yOf(vpElevationData[i].elevFt);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#3a5a20';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (vpShowLandmarks) vpDrawLandmarks(ctx, xOf, yOf, typeof elevData !== 'undefined' ? elevData : vpElevationData, totalDist, typeof zoomFactor !== 'undefined', typeof zoomFactor !== 'undefined' ? zoomFactor : 1.0);
    if (vpShowClouds) vpDrawClouds(ctx, xOf, yOf, padTop, plotH, totalDist, typeof zoomFactor !== 'undefined', typeof elevData !== 'undefined' ? elevData : vpElevationData);
    if (vpShowObstacles) vpDrawObstacles(ctx, xOf, yOf, totalDist, typeof zoomFactor !== 'undefined' ? zoomFactor : 1.0, typeof elevData !== 'undefined' ? elevData : vpElevationData);

    // Flight profile
    if (fpResult && fpResult.profile) {
        ctx.beginPath();
        for (let i = 0; i < fpResult.profile.length; i++) {
            const x = xOf(fpResult.profile[i].distNM), y = yOf(fpResult.profile[i].altFt) + 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < fpResult.profile.length; i++) {
            const x = xOf(fpResult.profile[i].distNM), y = yOf(fpResult.profile[i].altFt);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#d93829';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // TOC
        ctx.beginPath();
        ctx.arc(xOf(fpResult.tocDistNM), yOf(cruiseAlt), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#d93829';
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('TOC', xOf(fpResult.tocDistNM), yOf(cruiseAlt) - 7);

        // TOD
        ctx.beginPath();
        ctx.arc(xOf(fpResult.todDistNM), yOf(cruiseAlt), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#d93829';
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.fillText('TOD', xOf(fpResult.todDistNM), yOf(cruiseAlt) - 7);
        ctx.textAlign = 'left';
    }

    // Waypoint markers
    let wpCumDist = 0;
    for (let i = 0; i < routeWaypoints.length; i++) {
        if (i > 0) {
            const prev = routeWaypoints[i - 1], curr = routeWaypoints[i];
            wpCumDist += calcNav(prev.lat, prev.lng || prev.lon, curr.lat, curr.lng || curr.lon).dist;
        }
        const x = xOf(wpCumDist);

        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        let wpLabel;
        if (i === 0) wpLabel = currentStartICAO || 'DEP';
        else if (i === routeWaypoints.length - 1) wpLabel = (currentMissionData?.poiName ? 'POI' : currentDestICAO) || 'DEST';
        else wpLabel = routeWaypoints[i].name ? routeWaypoints[i].name.replace(/^RPP\s+/i, '').replace(/^APT\s+/i, '').split(' ')[0] : 'WP' + i;
        if (wpLabel.length > 8) wpLabel = wpLabel.substring(0, 7) + '…';

        ctx.save();
        ctx.translate(x, padTop + plotH + 4);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(wpLabel, 0, 0);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, padTop + 3, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#44ff44' : (i === routeWaypoints.length - 1 ? '#ff4444' : '#fdfd86');
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Y axis
    ctx.fillStyle = '#555';
    ctx.font = '9px Arial';
    ctx.textAlign = 'right';
    const altStep = maxAlt > 6000 ? 2000 : (maxAlt > 3000 ? 1000 : 500);
    for (let alt = 0; alt <= maxAlt; alt += altStep) {
        const y = yOf(alt);
        if (y < padTop - 5 || y > padTop + plotH + 5) continue;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 0.5;
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.fillText(alt >= 1000 ? (alt / 1000).toFixed(alt % 1000 === 0 ? 0 : 1) + 'k' : alt + '', padLeft - 4, y + 3);
    }

    ctx.save();
    ctx.translate(8, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#888';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ALT (ft)', 0, 0);
    ctx.restore();

    // X axis
    ctx.textAlign = 'center';
    const distStep = totalDist > 100 ? 20 : (totalDist > 50 ? 10 : 5);
    for (let d = 0; d <= totalDist; d += distStep) {
        ctx.fillStyle = '#888';
        ctx.font = '8px Arial';
        ctx.fillText(d + '', xOf(d), padTop + plotH + 22);
    }
    ctx.fillStyle = '#888';
    ctx.font = 'bold 8px Arial';
    ctx.fillText('NM', padLeft + plotW + 8, padTop + plotH + 22);

    // Border
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // Cruise altitude label & line
    ctx.fillStyle = 'rgba(217, 56, 41, 0.8)';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('CRZ ' + cruiseAlt + ' ft', padLeft + 4, yOf(cruiseAlt) - 4);
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(217, 56, 41, 0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(padLeft, yOf(cruiseAlt));
    ctx.lineTo(padLeft + plotW, yOf(cruiseAlt));
    ctx.stroke();
    ctx.setLineDash([]);

    // Peak elevation marker
    const peakPt = vpElevationData.reduce((max, p) => p.elevFt > max.elevFt ? p : max);
    ctx.fillStyle = '#333';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('▲', xOf(peakPt.distNM), yOf(peakPt.elevFt) - 3);
    ctx.font = 'bold 8px Arial';
    ctx.fillText(peakPt.elevFt + ' ft', xOf(peakPt.distNM), yOf(peakPt.elevFt) - 12);

    // Auto-update things that depend on the completed elevation data
    if (typeof renderAirspaceWarningsList === 'function') renderAirspaceWarningsList();
    if (typeof vpMapProfileVisible !== 'undefined' && vpMapProfileVisible && vpElevationData) {
        const mainAlt = document.getElementById('altSlider');
        const mapAlt = document.getElementById('altSliderMap');
        const mapDisplay = document.getElementById('altMapDisplay');
        if (mainAlt && mapAlt) { mapAlt.value = mainAlt.value; }
        if (mainAlt && mapDisplay) { mapDisplay.textContent = mainAlt.value; }
        renderMapProfile();
    }
}

function vpPointInPoly(pt, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > pt.lat) !== (yj > pt.lat)) && (pt.lon < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function airspaceLimitToFt(lim) {
    if (!lim) return null;
    if (lim.referenceDatum === 0 && lim.value === 0) return 0;
    if (lim.unit === 6) return lim.value * 100;
    if (lim.unit === 1) return lim.value;
    if (lim.unit === 0) return Math.round(lim.value * 3.28084);
    return lim.value;
}

function vpHexToRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return 'rgba(0,0,0,' + alpha + ')';
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/* =========================================================
   MAP TABLE PROFILE STRIP
   ========================================================= */
let vpMapProfileVisible = true;

function toggleMapProfile() {
    vpMapProfileVisible = !vpMapProfileVisible;
    const strip = document.getElementById('mapProfileStrip');
    const btn = document.getElementById('vpToggleBtn');
    if (strip) strip.style.display = vpMapProfileVisible ? '' : 'none';
    if (btn) {
        btn.textContent = vpMapProfileVisible ? '📊 Profil (An)' : '📊 Profil (Aus)';
        btn.style.background = vpMapProfileVisible ? '#2E8B57' : '#444';
    }
    if (vpMapProfileVisible) {
        renderMapProfile();
        // Marker wieder anzeigen, falls er existiert
        if (vpPositionLeafletMarker && map) vpPositionLeafletMarker.addTo(map);
    } else {
        // Marker von der Karte entfernen, wenn Profil ausgeblendet
        if (vpPositionLeafletMarker && map) map.removeLayer(vpPositionLeafletMarker);
    }
    // Invalidate map size since space changed
    if (typeof map !== 'undefined' && map) setTimeout(() => map.invalidateSize(), 100);
}

function syncAltFromMap(val) {
    const mainSlider = document.getElementById('altSlider');
    if (mainSlider) mainSlider.value = val;
    document.getElementById('altMapDisplay').textContent = val;
    handleSliderChange('alt', val);
    renderMapProfile();
    if (typeof renderAirspaceWarningsList === 'function') renderAirspaceWarningsList();
}

// Globale Fast-Render Steuerung
window.vpIsFastRendering = false;
let vpFastRenderTimeout = null;
window.activateFastRender = function() {
    window.vpIsFastRendering = true;
    if (vpFastRenderTimeout) clearTimeout(vpFastRenderTimeout);
    vpFastRenderTimeout = setTimeout(() => {
        window.vpIsFastRendering = false;
        if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
    }, 350);
};

let vpHighResFetchTimeout = null;
function vpZoom(delta) {
    window.activateFastRender();
    vpZoomLevel = Math.max(10, Math.min(100, vpZoomLevel + delta));
    const zd = document.getElementById('vpZoomDisplay');
    if (zd) zd.textContent = Math.round((100 - vpZoomLevel) / 90 * 100) + '%';

    // Ruckelfrei mit 60 FPS rendern statt bei jedem Event
    if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();

    // High-Res API Debounce
    if (vpHighResFetchTimeout) clearTimeout(vpHighResFetchTimeout);
    if (vpZoomLevel < 100 && routeWaypoints && routeWaypoints.length >= 2) {
        vpHighResFetchTimeout = setTimeout(() => {
            fetchHighResElevation().then(() => {
                if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
            });
        }, 400); 
    } else if (vpZoomLevel === 100) {
        vpHighResData = null;
        if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
    }
}

async function fetchHighResElevation() {
    if (!routeWaypoints || routeWaypoints.length < 2) return;

    const interpolated = [];
    let cumulativeDist = 0;

    for (let i = 0; i < routeWaypoints.length - 1; i++) {
        const p1 = routeWaypoints[i], p2 = routeWaypoints[i + 1];
        const lat1 = p1.lat, lon1 = p1.lng || p1.lon;
        const lat2 = p2.lat, lon2 = p2.lng || p2.lon;
        const segDist = calcNav(lat1, lon1, lat2, lon2).dist;
        // Higher resolution: every 0.25 NM instead of 1 NM
        const steps = Math.max(1, Math.round(segDist * 4));

        for (let j = 0; j <= steps; j++) {
            if (i > 0 && j === 0) continue;
            const f = j / steps;
            interpolated.push({
                lat: lat1 + (lat2 - lat1) * f,
                lon: lon1 + (lon2 - lon1) * f,
                distNM: cumulativeDist + segDist * f
            });
        }
        cumulativeDist += segDist;
    }

    // Resample to max 100 points
    let samplePts = interpolated;
    if (interpolated.length > 100) {
        samplePts = [];
        for (let i = 0; i < 100; i++) {
            const idx = Math.round(i * (interpolated.length - 1) / 99);
            samplePts.push(interpolated[idx]);
        }
    }

    const lats = samplePts.map(p => p.lat.toFixed(5)).join(',');
    const lons = samplePts.map(p => p.lon.toFixed(5)).join(',');

    try {
        const res = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + lats + '&longitude=' + lons);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.elevation || data.elevation.length !== samplePts.length) return;

        vpHighResData = samplePts.map((p, i) => ({
            distNM: p.distNM,
            elevFt: Math.round(data.elevation[i] * 3.28084),
            lat: p.lat,
            lon: p.lon
        }));
    } catch (e) {
        console.error('High-res elevation fetch error:', e);
    }
}

function renderMapProfile() {
    const canvas = document.getElementById('mapProfileCanvas');
    const scrollContainer = document.getElementById('mapProfileScroll');
    if (!canvas || !scrollContainer) return;

    const elevData = (vpZoomLevel < 100 && vpHighResData) ? vpHighResData : vpElevationData;
    if (!elevData || elevData.length < 2) return;

    const containerHeight = scrollContainer.clientHeight || 100;
    const baseWidth = scrollContainer.clientWidth || 600;

    // Zoom: canvas is wider than container when zoomed in
    const zoomFactor = 100 / vpZoomLevel;
    const canvasWidth = Math.round(baseWidth * zoomFactor);

    const dpr = window.devicePixelRatio || 1;
    const targetW = canvasWidth * dpr;
    const targetH = containerHeight * dpr;

    const ctx = canvas.getContext('2d');
    
    // Performance Fix: Speicher nur neu allokieren, wenn sich die echte Auflösung ändert (z.B. Zoom)!
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = containerHeight + 'px';
        ctx.scale(dpr, dpr);
    } else {
        // Bei reinem Dragging/Y-Achsen Änderung: Nur den alten Inhalt wegwischen (100x schneller!)
        ctx.clearRect(0, 0, canvasWidth, containerHeight);
    }
    
    // Viewport Culling Init: Ermittle, welcher Bereich gerade sichtbar ist (mit 200px Puffer)
    const viewMinX = scrollContainer.scrollLeft - 200;
    const viewMaxX = scrollContainer.scrollLeft + baseWidth + 200;

    const padLeft = 33, padRight = 16, padTop = 12, padBottom = 22;
    const plotW = canvasWidth - padLeft - padRight;
    const plotH = containerHeight - padTop - padBottom;

    const cruiseAlt = parseInt(document.getElementById('altSliderMap')?.value || document.getElementById('altSlider')?.value || 4500);
    const tas = parseInt(document.getElementById('tasSlider')?.value || 115);
    const totalDist = elevData[elevData.length - 1].distNM;
    const maxTerrain = Math.max(...elevData.map(p => p.elevFt));
    let maxCloudAlt = 0;
    if (vpShowClouds && vpWeatherData) {
        vpWeatherData.forEach(zone => {
            if (zone.clouds) zone.clouds.forEach(c => {
                if (c.baseMsl > maxCloudAlt) maxCloudAlt = c.baseMsl;
            });
        });
    }
    let autoMaxAlt = Math.max(cruiseAlt + 2500, maxTerrain + 1000);
    const maxAlt = vpMaxAltOverride > 0 ? vpMaxAltOverride : autoMaxAlt;
    const minAlt = 0;

    const fpResult = computeFlightProfile(elevData, cruiseAlt, vpClimbRate, vpDescentRate, tas);

    const xOf = (distNM) => padLeft + (distNM / totalDist) * plotW;
    const yOf = (altFt) => padTop + plotH - ((altFt - minAlt) / (maxAlt - minAlt)) * plotH;

    // Background - dark theme for map strip
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvasWidth, containerHeight);

    // Sky gradient (dark)
    const skyGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    skyGrad.addColorStop(0, '#1a2a3a');
    skyGrad.addColorStop(0.5, '#1a2030');
    skyGrad.addColorStop(1, '#151a20');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(padLeft, padTop, plotW, plotH);

    // Airspace blocks (dark theme) with pulse highlight support
    let occupiedASLabels = [];
    if (typeof activeAirspaces !== 'undefined' && activeAirspaces.length > 0) {
        const cachedAirspaces = getCachedAirspaceIntersections(elevData, totalDist);
        for (const item of cachedAirspaces) {
            const { asIdx, as, lowerFt, upperFt, isLowerAgl, isUpperAgl, asMinDist, asMaxDist, relevantPts } = item;
            
            const style = getAirspaceStyle(as);
            const x1 = xOf(asMinDist), x2 = xOf(asMaxDist);
            if (x2 < viewMinX || x1 > viewMaxX) continue; // CULLING

            // Pulsing highlight for the active airspace
            const isHighlighted = (vpHighlightPulseIdx >= 0 && asIdx === vpHighlightPulseIdx);
            const pulseOpacity = isHighlighted ? 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(vpPulsePhase * Math.PI * 2)) : 0.15;
            const strokeOpacity = isHighlighted ? 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(vpPulsePhase * Math.PI * 2)) : 0.5;
            const lineW = isHighlighted ? 2 + 2 * (0.5 + 0.5 * Math.sin(vpPulsePhase * Math.PI * 2)) : 2;

            ctx.fillStyle = vpHexToRgba(style.color, pulseOpacity);
            ctx.strokeStyle = vpHexToRgba(style.color, strokeOpacity);
            ctx.lineWidth = lineW;
            ctx.setLineDash(isHighlighted ? [] : [3, 3]);

            ctx.beginPath();
            for (let i = 0; i < relevantPts.length; i++) {
                const p = relevantPts[i];
                const realUpper = isUpperAgl ? p.elevFt + upperFt : upperFt;
                ctx.lineTo(xOf(p.distNM), yOf(Math.min(realUpper, maxAlt)));
            }
            for (let i = relevantPts.length - 1; i >= 0; i--) {
                const p = relevantPts[i];
                const realLower = isLowerAgl ? p.elevFt + lowerFt : lowerFt;
                ctx.lineTo(xOf(p.distNM), yOf(Math.max(realLower, minAlt)));
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            let sumUpper = 0;
            relevantPts.forEach(p => sumUpper += (isUpperAgl ? p.elevFt + upperFt : upperFt));
            const avgUpper = sumUpper / relevantPts.length;

            let labelY = yOf(Math.min(avgUpper, maxAlt));
            labelY = Math.max(padTop + 15, labelY); 
            if (zoomFactor >= 1.5 || (x2 - x1) > 40 || isHighlighted) {
                const displayName = getAirspaceDisplayName(as);
                ctx.font = isHighlighted ? 'bold 11px Arial' : 'bold 10px Arial';
                const tw = ctx.measureText(displayName).width;
                const tLeft = ((x1 + x2) / 2) - tw/2, tRight = tLeft + tw;

                let collision = false;
                if (!isHighlighted) {
                    for (let occ of occupiedASLabels) {
                        if (tLeft < occ.r && tRight > occ.l && labelY < occ.b && (labelY+25) > occ.t) { collision = true; break; }
                    }
                }

                if (!collision) {
                    if (!isHighlighted) occupiedASLabels.push({l: tLeft-5, r: tRight+5, t: labelY-5, b: labelY+25});
                    ctx.fillStyle = vpHexToRgba(style.color, isHighlighted ? 0.9 : 0.6);
                    ctx.textAlign = 'center';
                    ctx.fillText(displayName, (x1 + x2) / 2, labelY + 12);
                    if (zoomFactor >= 2 || isHighlighted) {
                        ctx.font = '9px Arial';
                        ctx.fillText(formatAsLimit(as.lowerLimit) + ' – ' + formatAsLimit(as.upperLimit), (x1 + x2) / 2, labelY + 23);
                    }
                }
            }
        }
    }
    ctx.textAlign = 'left';

    // Safety line
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(200, 120, 40, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < elevData.length; i++) {
        const x = xOf(elevData[i].distNM), y = yOf(elevData[i].elevFt + 1000);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Terrain polygon
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(0));
    for (let i = 0; i < elevData.length; i++) ctx.lineTo(xOf(elevData[i].distNM), yOf(elevData[i].elevFt));
    ctx.lineTo(xOf(totalDist), yOf(0));
    ctx.closePath();

    const terrainGrad = ctx.createLinearGradient(0, yOf(maxTerrain), 0, yOf(0));
    terrainGrad.addColorStop(0, '#6B5B3C');
    terrainGrad.addColorStop(0.3, '#3B5B23');
    terrainGrad.addColorStop(0.7, '#1B5B22');
    terrainGrad.addColorStop(1, '#1E5B37');
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < elevData.length; i++) {
        const x = xOf(elevData[i].distNM), y = yOf(elevData[i].elevFt);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4a7a30';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (vpShowLandmarks) vpDrawLandmarks(ctx, xOf, yOf, typeof elevData !== 'undefined' ? elevData : vpElevationData, totalDist, typeof zoomFactor !== 'undefined', typeof zoomFactor !== 'undefined' ? zoomFactor : 1.0);
    if (vpShowClouds) vpDrawClouds(ctx, xOf, yOf, padTop, plotH, totalDist, typeof zoomFactor !== 'undefined', typeof elevData !== 'undefined' ? elevData : vpElevationData);
    if (vpShowObstacles) vpDrawObstacles(ctx, xOf, yOf, totalDist, typeof zoomFactor !== 'undefined' ? zoomFactor : 1.0, typeof elevData !== 'undefined' ? elevData : vpElevationData);

    // Flight profile
    if (fpResult && fpResult.profile) {
        ctx.beginPath();
        for (let i = 0; i < fpResult.profile.length; i++) {
            const x = xOf(fpResult.profile[i].distNM), y = yOf(fpResult.profile[i].altFt) + 1;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < fpResult.profile.length; i++) {
            const x = xOf(fpResult.profile[i].distNM), y = yOf(fpResult.profile[i].altFt);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Cruise altitude line
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 68, 68, 0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(padLeft, yOf(cruiseAlt));
    ctx.lineTo(padLeft + plotW, yOf(cruiseAlt));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 68, 68, 0.7)';
    ctx.font = 'bold 10px Arial';
    ctx.fillText('CRZ ' + cruiseAlt + ' ft', padLeft + 4, yOf(cruiseAlt) - 4);

    // Waypoint markers
    let wpCumDist = 0;
    for (let i = 0; i < routeWaypoints.length; i++) {
        if (i > 0) {
            const prev = routeWaypoints[i - 1], curr = routeWaypoints[i];
            wpCumDist += calcNav(prev.lat, prev.lng || prev.lon, curr.lat, curr.lng || curr.lon).dist;
        }
        const x = xOf(wpCumDist);

        ctx.beginPath();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        let wpLabel;
        if (i === 0) wpLabel = currentStartICAO || 'DEP';
        else if (i === routeWaypoints.length - 1) wpLabel = (currentMissionData?.poiName ? 'POI' : currentDestICAO) || 'DEST';
        else wpLabel = routeWaypoints[i].name ? routeWaypoints[i].name.replace(/^RPP\s+/i, '').replace(/^APT\s+/i, '').split(' ')[0] : 'WP' + i;
        if (!zoomFactor || zoomFactor < 2) { if (wpLabel.length > 6) wpLabel = wpLabel.substring(0, 5) + '…'; }
        else { if (wpLabel.length > 12) wpLabel = wpLabel.substring(0, 11) + '…'; }

        // Colored dot
        ctx.beginPath();
        ctx.arc(x, padTop + plotH + 3, 3, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#44ff44' : (i === routeWaypoints.length - 1 ? '#ff4444' : '#ffcc00');
        ctx.fill();

        // Label  
        ctx.fillStyle = '#bbb';
        ctx.font = (zoomFactor >= 2) ? 'bold 11px Arial' : 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(wpLabel, x, padTop + plotH + 16);
    }

    // Y axis
    ctx.textAlign = 'right';
    const altStep = maxAlt > 6000 ? 2000 : (maxAlt > 3000 ? 1000 : 500);
    for (let alt = 0; alt <= maxAlt; alt += altStep) {
        const y = yOf(alt);
        if (y < padTop - 3 || y > padTop + plotH + 3) continue;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = '#777';
        ctx.font = '9px Arial';
        ctx.fillText(alt >= 1000 ? (alt / 1000).toFixed(0) + 'k' : alt + '', padLeft - 3, y + 3);
    }

    // X axis ticks
    ctx.textAlign = 'center';
    const distStep = totalDist > 150 ? 25 : (totalDist > 80 ? 10 : 5);
    for (let d = distStep; d < totalDist; d += distStep) {
        const x = xOf(d);
        ctx.fillStyle = '#666';
        ctx.font = '8px Arial';
        ctx.fillText(d + '', x, containerHeight - 1);
    }

    // Peak marker
    const peakPt = elevData.reduce((max, p) => p.elevFt > max.elevFt ? p : max);
    ctx.fillStyle = '#aaa';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('▲', xOf(peakPt.distNM), yOf(peakPt.elevFt) - 3);
    ctx.font = 'bold 9px Arial';
    ctx.fillText(peakPt.elevFt + ' ft', xOf(peakPt.distNM), yOf(peakPt.elevFt) - 13);

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // === POSITION MARKER (Magenta triangle + line) ===
    if (typeof vpPositionFraction === 'number' && vpPositionFraction >= 0) {
        const posDistNM = vpPositionFraction * totalDist;
        const posX = xOf(posDistNM);

        // Vertical magenta line
        ctx.beginPath();
        ctx.strokeStyle = '#ff00ff';
        ctx.lineWidth = 1.5;
        ctx.moveTo(posX, padTop);
        ctx.lineTo(posX, padTop + plotH);
        ctx.stroke();

        // Magenta triangle at bottom
        ctx.beginPath();
        ctx.moveTo(posX, padTop + plotH + 2);
        ctx.lineTo(posX - 5, padTop + plotH + 10);
        ctx.lineTo(posX + 5, padTop + plotH + 10);
        ctx.closePath();
        ctx.fillStyle = '#ff00ff';
        ctx.fill();
    }

    // === ALTITUDE WAYPOINTS (user markers on flight line) ===
    if (vpAltWaypoints.length > 0) {
        for (let i = 0; i < vpAltWaypoints.length; i++) {
            const wp = vpAltWaypoints[i];
            const wx = xOf(wp.distNM);
            const wy = yOf(wp.altFt);

            // Vertical dashed line from waypoint down to terrain
            ctx.beginPath();
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = 'rgba(255,0,255,0.3)';
            ctx.lineWidth = 1;
            ctx.moveTo(wx, wy);
            ctx.lineTo(wx, padTop + plotH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Diamond marker
            ctx.beginPath();
            ctx.moveTo(wx, wy - 7);
            ctx.lineTo(wx + 6, wy);
            ctx.lineTo(wx, wy + 7);
            ctx.lineTo(wx - 6, wy);
            ctx.closePath();
            ctx.fillStyle = '#ff00ff';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Label: show altitude
            ctx.fillStyle = '#ff00ff';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(wp.altFt + ' ft', wx, wy - 11);
        }
    }
}

// Removed arbitrary setTimeout hook in favor of synchronous hooks within renderVerticalProfile

/* =========================================================
   RESIZE HANDLE (Map / Profile split)
   ========================================================= */
let vpResizeActive = false;

function initProfileResize() {
    const handle = document.getElementById('profileResizeHandle');
    const strip = document.getElementById('mapProfileStrip');
    const maptable = document.querySelector('.maptable-content');
    if (!handle || !strip || !maptable) return;

    let startY = 0, startH = 0;

    function onStart(e) {
        window.activateFastRender();
        vpResizeActive = true;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startH = strip.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    }

    function onMove(e) {
        if (!vpResizeActive) return;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = startY - clientY; // pulling up = bigger profile
        let newH = startH + delta;
        const totalH = maptable.offsetHeight;
        const maxFraction = document.body.classList.contains('map-is-fullscreen') ? 0.75 : 0.6;
        newH = Math.max(60, Math.min(totalH * maxFraction, newH));
        strip.style.height = newH + 'px';

        if (typeof map !== 'undefined' && map) map.invalidateSize();
        renderMapProfile();
    }

    function onEnd() {
        if (!vpResizeActive) return;
        vpResizeActive = false;
        document.body.style.cursor = '';
    }

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
}



/* =========================================================
   POSITION MARKER (Magenta triangle + Leaflet marker sync)
   ========================================================= */
let vpPositionFraction = 0; // 0 = start of profile
let vpPositionLeafletMarker = null;

function vpUpdatePosition(fraction) {
    vpPositionFraction = fraction;
    renderMapProfile();

    // Update Leaflet marker on map
    if (!vpElevationData || vpElevationData.length < 2) return;
    const totalDist = vpElevationData[vpElevationData.length - 1].distNM;
    const targetDist = fraction * totalDist;

    // Find the interpolated lat/lon at this distance
    let lat, lon;
    for (let i = 0; i < vpElevationData.length - 1; i++) {
        if (vpElevationData[i + 1].distNM >= targetDist) {
            const segLen = vpElevationData[i + 1].distNM - vpElevationData[i].distNM;
            const f = segLen > 0 ? (targetDist - vpElevationData[i].distNM) / segLen : 0;
            lat = vpElevationData[i].lat + (vpElevationData[i + 1].lat - vpElevationData[i].lat) * f;
            lon = vpElevationData[i].lon + (vpElevationData[i + 1].lon - vpElevationData[i].lon) * f;
            break;
        }
    }
    if (!lat) { lat = vpElevationData[vpElevationData.length - 1].lat; lon = vpElevationData[vpElevationData.length - 1].lon; }

    if (typeof map !== 'undefined' && map && typeof L !== 'undefined') {
        if (!vpPositionLeafletMarker) {
            const magentaIcon = L.divIcon({
                className: 'vp-pos-marker',
                html: '<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #ff00ff;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></div>',
                iconSize: [16, 14],
                iconAnchor: [8, 14]
            });
            vpPositionLeafletMarker = L.marker([lat, lon], { icon: magentaIcon, interactive: false, zIndexOffset: 5000 });
            // Nur zur Map hinzufügen, wenn Profil sichtbar ist
            if (vpMapProfileVisible) vpPositionLeafletMarker.addTo(map);
        } else {
            vpPositionLeafletMarker.setLatLng([lat, lon]);
            // Sicherstellen, dass Sichtbarkeit synchron ist
            if (vpMapProfileVisible) {
                if (!map.hasLayer(vpPositionLeafletMarker)) vpPositionLeafletMarker.addTo(map);
            } else {
                if (map.hasLayer(vpPositionLeafletMarker)) map.removeLayer(vpPositionLeafletMarker);
            }
        }
    }
}

/* =========================================================
   ALTITUDE WAYPOINTS (Click to set, drag to move)
   ========================================================= */
let vpAltWaypoints = []; // [{distNM, altFt}] - fixed anchor points
let vpSegmentAlts = [];  // vpSegmentAlts[i] = cruise altitude between vpAltWaypoints[i] and [i+1]
let vpDraggingWP = -1;
let vpDraggingSegment = null; // { segIndex, origAlt }
let vpCanvasClickHandler = null;

function getExactAltAtDist(distNM, profObj, fallbackAlt) {
    if (!profObj || !profObj.profile || profObj.profile.length === 0) return fallbackAlt;
    const prof = profObj.profile;
    if (distNM <= prof[0].distNM) return prof[0].altFt;
    if (distNM >= prof[prof.length - 1].distNM) return prof[prof.length - 1].altFt;
    for (let j = 0; j < prof.length - 1; j++) {
        if (distNM >= prof[j].distNM && distNM <= prof[j + 1].distNM) {
            const f = (distNM - prof[j].distNM) / (prof[j + 1].distNM - prof[j].distNM || 1);
            return prof[j].altFt + f * (prof[j + 1].altFt - prof[j].altFt);
        }
    }
    return fallbackAlt;
}

function initAltWaypoints() {
    const canvas = document.getElementById('mapProfileCanvas');
    if (!canvas || vpCanvasClickHandler) return;

    vpCanvasClickHandler = true;

    // === SHARED HELPERS for mouse & touch ===
    function vpGetCanvasMetrics() {
        const elevData = (vpZoomLevel < 100 && vpHighResData) ? vpHighResData : vpElevationData;
        if (!elevData || elevData.length < 2) return null;
        const rect = canvas.getBoundingClientRect();
        const scrollContainer = document.getElementById('mapProfileScroll');
        const containerHeight = scrollContainer?.clientHeight || 100;
        const baseWidth = scrollContainer?.clientWidth || 600;
        const zoomFactor = 100 / vpZoomLevel;
        const canvasWidth = Math.round(baseWidth * zoomFactor);
        const totalDist = elevData[elevData.length - 1].distNM;

        // FIX: Aus dem neuen Span-Feld lesen
        const cruiseAlt = parseInt(document.getElementById('altMapInput')?.textContent || document.getElementById('altSlider')?.value || 4500);
        const maxTerrain = Math.max(...elevData.map(p => p.elevFt));

        // FIX: Exakt gleiche Skalierung wie beim Rendering (+ 2500)
        let autoMaxAlt = Math.max(cruiseAlt + 2500, maxTerrain + 1000);
        const maxAlt = vpMaxAltOverride > 0 ? vpMaxAltOverride : autoMaxAlt;
        const padLeft = 33, padRight = 16, padTop = 12, padBottom = 22;
        const plotW = canvasWidth - padLeft - padRight;
        const plotH = containerHeight - padTop - padBottom;
        const scaleX = canvasWidth / rect.width;
        const scaleY = containerHeight / rect.height;
        return { elevData, rect, containerHeight, baseWidth, zoomFactor, canvasWidth, totalDist, cruiseAlt, maxTerrain, maxAlt, padLeft, padRight, padTop, padBottom, plotW, plotH, scaleX, scaleY };
    }

    function vpClientToCanvas(clientX, clientY, m) {
        return { mx: (clientX - m.rect.left) * m.scaleX, my: (clientY - m.rect.top) * m.scaleY };
    }

    function vpHitTestWaypoint(mx, my, m) {
        for (let i = 0; i < vpAltWaypoints.length; i++) {
            const wp = vpAltWaypoints[i];
            const wpx = m.padLeft + (wp.distNM / m.totalDist) * m.plotW;
            const wpy = m.padTop + m.plotH - (wp.altFt / m.maxAlt) * m.plotH;
            if (Math.abs(mx - wpx) < 26 && Math.abs(my - wpy) < 26) return i;
        }
        return -1;
    }

    function vpHitTestFlightLine(mx, my, m) {
        const mouseDistNM = ((mx - m.padLeft) / m.plotW) * m.totalDist;
        if (mouseDistNM < 0 || mouseDistNM > m.totalDist) return null;
        const tas = parseInt(document.getElementById('tasSlider')?.value || 115);
        const profObj = typeof computeFlightProfile === 'function' ? computeFlightProfile(m.elevData, m.cruiseAlt, vpClimbRate, vpDescentRate, tas) : null;
        const altAtMouse = getExactAltAtDist(mouseDistNM, profObj, m.cruiseAlt);
        const lineY = m.padTop + m.plotH - (altAtMouse / m.maxAlt) * m.plotH;
        if (Math.abs(my - lineY) < 32) return mouseDistNM;
        return null;
    }

    function vpHitTestMagenta(mx, m) {
        if (typeof vpPositionFraction !== 'number' || vpPositionFraction < 0) return false;
        const posX = m.padLeft + (vpPositionFraction * m.totalDist / m.totalDist) * m.plotW;
        return Math.abs(mx - posX) < 18;
    }

    function vpFindSegmentIdx(mouseDistNM) {
        let segIdx = -1;
        if (vpAltWaypoints.length === 0) {
            segIdx = -1;
        } else if (vpAltWaypoints.length === 1) {
            segIdx = -2;
        } else {
            if (mouseDistNM <= vpAltWaypoints[0].distNM) {
                segIdx = -3;
            } else if (mouseDistNM >= vpAltWaypoints[vpAltWaypoints.length - 1].distNM) {
                segIdx = -4;
            } else {
                for (let k = 0; k < vpAltWaypoints.length - 1; k++) {
                    if (mouseDistNM >= vpAltWaypoints[k].distNM && mouseDistNM <= vpAltWaypoints[k + 1].distNM) {
                        segIdx = k; break;
                    }
                }
            }
        }
        return segIdx;
    }

    function vpRemoveWaypoint(clickDistNM, totalDist) {
        if (vpAltWaypoints.length === 0) return false;
        let nearestIdx = -1, nearestDist = Infinity;
        for (let i = 0; i < vpAltWaypoints.length; i++) {
            const d = Math.abs(vpAltWaypoints[i].distNM - clickDistNM);
            if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        }
        if (nearestIdx >= 0 && nearestDist < totalDist * 0.05) {
            vpAltWaypoints.splice(nearestIdx, 1);
            if (vpSegmentAlts.length > 0) {
                if (nearestIdx > 0 && nearestIdx < vpSegmentAlts.length) {
                    const merged = Math.round((vpSegmentAlts[nearestIdx - 1] + vpSegmentAlts[nearestIdx]) / 2);
                    vpSegmentAlts.splice(nearestIdx - 1, 2, merged);
                } else if (nearestIdx < vpSegmentAlts.length) {
                    vpSegmentAlts.splice(nearestIdx, 1);
                } else if (vpSegmentAlts.length > 0) {
                    vpSegmentAlts.splice(vpSegmentAlts.length - 1, 1);
                }
            }
            if (vpAltWaypoints.length < 2) vpSegmentAlts = [];
            renderMapProfile();
            if (typeof renderAirspaceWarningsList === 'function') renderAirspaceWarningsList();
            return true;
        }
        return false;
    }

    function vpAddWaypoint(clickDistNM, exactAlt, cruiseAlt, totalDist) {
        if (clickDistNM < 0 || clickDistNM > totalDist) return;
        for (const wp of vpAltWaypoints) {
            if (Math.abs(wp.distNM - clickDistNM) < totalDist * 0.03) return;
        }
        let insertIdx = vpAltWaypoints.length;
        for (let k = 0; k < vpAltWaypoints.length; k++) {
            if (clickDistNM < vpAltWaypoints[k].distNM) { insertIdx = k; break; }
        }
        vpAltWaypoints.splice(insertIdx, 0, { distNM: clickDistNM, altFt: exactAlt });
        if (vpSegmentAlts.length > 0 && insertIdx < vpSegmentAlts.length) {
            vpSegmentAlts.splice(insertIdx, 1, exactAlt, exactAlt);
        } else if (vpSegmentAlts.length > 0 && insertIdx >= vpSegmentAlts.length) {
            vpSegmentAlts.push(exactAlt);
        } else if (vpAltWaypoints.length >= 2 && vpSegmentAlts.length === 0) {
            vpSegmentAlts = [];
            for (let k = 0; k < vpAltWaypoints.length - 1; k++) {
                vpSegmentAlts.push(exactAlt);
            }
        }
        renderMapProfile();
        if (typeof renderAirspaceWarningsList === 'function') renderAirspaceWarningsList();
    }

    function vpHandleDoubleHit(mx, my, m) {
        // 1. Try removing existing waypoint
        const wpIdx = vpHitTestWaypoint(mx, my, m);
        if (wpIdx >= 0) {
            const wp = vpAltWaypoints[wpIdx];
            vpRemoveWaypoint(wp.distNM, m.totalDist);
            return true;
        }
        // 2. Try adding new waypoint on flight line
        const clickDistNM = vpHitTestFlightLine(mx, my, m);
        if (clickDistNM !== null) {
            const tas = parseInt(document.getElementById('tasSlider')?.value || 115);
            const profObj = typeof computeFlightProfile === 'function' ? computeFlightProfile(m.elevData, m.cruiseAlt, vpClimbRate, vpDescentRate, tas) : null;
            let exactAlt = getExactAltAtDist(clickDistNM, profObj, m.cruiseAlt);
            exactAlt = Math.round(exactAlt / 100) * 100;
            vpAddWaypoint(clickDistNM, exactAlt, m.cruiseAlt, m.totalDist);
            return true;
        }
        return false;
    }

    function vpHandleDragMove(clientX, clientY, dragStartX, dragStartY, dragOrigWP) {
        const m = vpGetCanvasMetrics();
        if (!m) return;
        const deltaY = dragStartY - clientY;
        const altChange = (deltaY / m.plotH) * m.maxAlt;
        if (vpDraggingWP >= 0) {
            const scaleX = m.canvasWidth / m.rect.width;
            const deltaX = (clientX - dragStartX) * scaleX;
            const distChange = (deltaX / m.plotW) * m.totalDist;
            let newDist = dragOrigWP.distNM + distChange;
            newDist = Math.max(0, Math.min(m.totalDist, newDist));
            let newAlt = Math.round((dragOrigWP.altFt + altChange) / 100) * 100;
            newAlt = Math.max(0, Math.min(m.maxAlt, newAlt));
            vpAltWaypoints[vpDraggingWP].distNM = newDist;
            vpAltWaypoints[vpDraggingWP].altFt = newAlt;
            if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
        } else if (vpDraggingSegment) {
            const seg = vpDraggingSegment;
            const newAlt = Math.max(0, Math.round((seg.origAlt + altChange) / 100) * 100);
            if (seg.segIdx >= 0 && seg.segIdx < vpSegmentAlts.length) {
                vpSegmentAlts[seg.segIdx] = newAlt;
                if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
            } else if (seg.segIdx === -1) {
                const newGlobalAlt = Math.max(1500, Math.min(13500, Math.round((seg.origCruiseAlt + altChange) / 500) * 500));
                const altMap = document.getElementById('altMapInput');
                if (altMap && altMap.textContent != newGlobalAlt) {
                    altMap.textContent = newGlobalAlt;
                    if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
                }
            } else if (seg.segIdx === -2 || seg.segIdx === -3) {
                if (vpAltWaypoints.length > 0) { vpAltWaypoints[0].altFt = newAlt; if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles(); }
            } else if (seg.segIdx === -4) {
                if (vpAltWaypoints.length > 0) { vpAltWaypoints[vpAltWaypoints.length - 1].altFt = newAlt; if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles(); }
            }
        } else if (vpDraggingMagenta) {
            const { mx } = vpClientToCanvas(clientX, clientY, m);
            let frac = (mx - m.padLeft) / m.plotW;
            frac = Math.max(0, Math.min(1, frac));
            vpUpdatePosition(frac);
        }
    }

    function vpHandleDragEnd() {
        if (vpDraggingWP >= 0 || vpDraggingSegment || vpDraggingMagenta) {
            const needsSave = vpDraggingWP >= 0 || !!vpDraggingSegment;

            // Bei globaler Höhenänderung einmalig am Ende synchronisieren
            if (vpDraggingSegment && vpDraggingSegment.segIdx === -1) {
                const finalAlt = parseInt(document.getElementById('altMapInput').textContent) || 4500;
                syncAltFromInput(finalAlt);
            }
            if (vpDraggingWP >= 0) vpAltWaypoints.sort((a, b) => a.distNM - b.distNM);

            vpDraggingWP = -1;
            vpDraggingSegment = null;
            vpDraggingMagenta = false;
            dragOrigWP = null;

            renderMapProfile();
            if (typeof renderVerticalProfile === 'function') renderVerticalProfile('verticalProfileCanvas');
            if (typeof renderAirspaceWarningsList === 'function') renderAirspaceWarningsList(); // Erst beim Loslassen berechnen!
            if (needsSave) window.debouncedSaveMissionState();
        }
    }

    // === STATE ===
    let vpWasDragging = false;
    let vpDraggingMagenta = false;
    let dragStartY = 0, dragStartX = 0, dragOrigWP = null;
    let lastTapTime = 0;
    let vpIsPanning = false;
    let vpPanStartScrollLeft = 0;
    let vpPanStartX = 0;
    let initialPinchDist = null;
    let initialTwoFingerY = null;

    // === DOUBLE CLICK: remove/add waypoint ===
    canvas.addEventListener('dblclick', (e) => {
        const m = vpGetCanvasMetrics();
        if (!m) return;
        const { mx, my } = vpClientToCanvas(e.clientX, e.clientY, m);
        if (vpHandleDoubleHit(mx, my, m)) window.debouncedSaveMissionState();
    });

    // === CLICK: no more single-click creation ===
    canvas.addEventListener('click', (e) => {
        // Logic removed to prevent accidental creation on iPhone
    });

    // === HOVER CURSOR ===
    canvas.addEventListener('mousemove', (e) => {
        if (vpDraggingWP >= 0 || vpDraggingSegment || vpDraggingMagenta) return;
        const m = vpGetCanvasMetrics();
        if (!m) return;
        const { mx, my } = vpClientToCanvas(e.clientX, e.clientY, m);
        let cursor = 'default';
        if (vpHitTestMagenta(mx, m)) cursor = 'ew-resize';
        else if (vpHitTestWaypoint(mx, my, m) >= 0) cursor = 'move';
        else if (vpHitTestFlightLine(mx, my, m) !== null) cursor = 'ns-resize';
        canvas.style.cursor = cursor;
    });

    // === MOUSEDOWN: start drag ===
    canvas.addEventListener('mousedown', (e) => {
        if (typeof window.activateFastRender === 'function') window.activateFastRender();
        vpWasDragging = false;
        const m = vpGetCanvasMetrics();
        if (!m) return;
        const { mx, my } = vpClientToCanvas(e.clientX, e.clientY, m);
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        // Priority 1: Magenta marker drag
        if (vpHitTestMagenta(mx, m)) {
            vpDraggingMagenta = true;
            e.preventDefault(); e.stopPropagation();
            return;
        }
        // Priority 2: Waypoint drag
        const wpIdx = vpHitTestWaypoint(mx, my, m);
        if (wpIdx >= 0) {
            vpDraggingWP = wpIdx;
            dragOrigWP = { ...vpAltWaypoints[wpIdx] };
            e.preventDefault(); e.stopPropagation();
            return;
        }
        // Priority 3: Flight line segment drag
        const mouseDistNM = vpHitTestFlightLine(mx, my, m);
        if (mouseDistNM !== null) {
            const segIdx = vpFindSegmentIdx(mouseDistNM);
            const origSegAlt = (segIdx >= 0 && segIdx < vpSegmentAlts.length) ? vpSegmentAlts[segIdx] : m.cruiseAlt;
            vpDraggingSegment = { segIdx, origAlt: origSegAlt, origCruiseAlt: m.cruiseAlt };
            e.preventDefault(); e.stopPropagation();
        }
    });

    // === MOUSEMOVE: drag ===
    document.addEventListener('mousemove', (e) => {
        if (vpDraggingWP < 0 && !vpDraggingSegment && !vpDraggingMagenta) return;
        if (Math.abs(e.clientX - dragStartX) > 2 || Math.abs(e.clientY - dragStartY) > 2) vpWasDragging = true;
        vpHandleDragMove(e.clientX, e.clientY, dragStartX, dragStartY, dragOrigWP);
    });

    // === MOUSEUP: end drag ===
    document.addEventListener('mouseup', () => vpHandleDragEnd());

    // === TOUCH EVENTS ===
    canvas.addEventListener('touchstart', (e) => {
        if (typeof window.activateFastRender === 'function') window.activateFastRender();
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            return;
        }

        const touch = e.touches[0];
        vpWasDragging = false;
        vpIsPanning = false;
        const m = vpGetCanvasMetrics();
        if (!m) return;
        const { mx, my } = vpClientToCanvas(touch.clientX, touch.clientY, m);
        dragStartX = touch.clientX;
        dragStartY = touch.clientY;

        const now = Date.now();
        if (now - lastTapTime < 300) {
            e.preventDefault();
            if (vpHandleDoubleHit(mx, my, m)) window.debouncedSaveMissionState();
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;

        if (vpHitTestMagenta(mx, m)) {
            e.preventDefault();
            vpDraggingMagenta = true;
            return;
        }
        const wpIdx = vpHitTestWaypoint(mx, my, m);
        if (wpIdx >= 0) {
            e.preventDefault();
            vpDraggingWP = wpIdx;
            dragOrigWP = { ...vpAltWaypoints[wpIdx] };
            return;
        }
        const mouseDistNM = vpHitTestFlightLine(mx, my, m);
        if (mouseDistNM !== null) {
            e.preventDefault();
            const segIdx = vpFindSegmentIdx(mouseDistNM);
            const origSegAlt = (segIdx >= 0 && segIdx < vpSegmentAlts.length) ? vpSegmentAlts[segIdx] : m.cruiseAlt;
            vpDraggingSegment = { segIdx, origAlt: origSegAlt, origCruiseAlt: m.cruiseAlt };
            return;
        }
        if (vpZoomLevel < 100) {
            e.preventDefault();
            vpIsPanning = true;
            const scrollContainer = document.getElementById('mapProfileScroll');
            vpPanStartScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
            vpPanStartX = touch.clientX;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDist !== null && initialTwoFingerY !== null) {
            e.preventDefault();
            
            // X-Achse: Pinch-to-Zoom
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const distDiff = currentDist - initialPinchDist;
            if (Math.abs(distDiff) > 10) {
                let zoomDelta = distDiff > 0 ? -3 : 3; 
                vpZoom(zoomDelta);
                initialPinchDist = currentDist;
            }

            // Y-Achse: Zwei-Finger vertikaler Wisch
            const currentTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const yDiff = currentTwoFingerY - initialTwoFingerY;
            if (Math.abs(yDiff) > 15) {
                let yDelta = yDiff > 0 ? -1000 : 1000; 
                vpChangeYAxis(yDelta);
                initialTwoFingerY = currentTwoFingerY;
            }
            return;
        }

        if (vpIsPanning) {
            e.preventDefault();
            const touch = e.touches[0];
            const deltaX = vpPanStartX - touch.clientX;
            const scrollContainer = document.getElementById('mapProfileScroll');
            if (scrollContainer) scrollContainer.scrollLeft = vpPanStartScrollLeft + deltaX;
            return;
        }
        if (vpDraggingWP < 0 && !vpDraggingSegment && !vpDraggingMagenta) return;
        e.preventDefault();
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - dragStartX) > 3 || Math.abs(touch.clientY - dragStartY) > 3) vpWasDragging = true;
        vpHandleDragMove(touch.clientX, touch.clientY, dragStartX, dragStartY, dragOrigWP);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) { initialPinchDist = null; initialTwoFingerY = null; }
        if (vpIsPanning) { vpIsPanning = false; return; }
        if (vpDraggingWP >= 0 || vpDraggingSegment || vpDraggingMagenta) vpHandleDragEnd();
    });

    canvas.addEventListener('touchcancel', (e) => {
        initialPinchDist = null; initialTwoFingerY = null;
        vpIsPanning = false; vpWasDragging = false;
        if (vpDraggingWP >= 0 || vpDraggingSegment || vpDraggingMagenta) vpHandleDragEnd();
    });

    // === MOUSE WHEEL ZOOM (Multi-Achsen) ===
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault(); 
        if (e.ctrlKey) {
            let yDelta = e.deltaY > 0 ? 1000 : -1000;
            vpChangeYAxis(yDelta);
        } else {
            let zoomDelta = e.deltaY > 0 ? 5 : -5;
            vpZoom(zoomDelta);
        }
    }, { passive: false });
}

// Override computeFlightProfile to use altitude waypoints + segment altitudes
const _origComputeProfile = computeFlightProfile;
computeFlightProfile = function (elevationData, cruiseAltFt, climbRateFpm, descentRateFpm, tasKts) {
    if (!elevationData || elevationData.length < 2) return null;
    if (vpAltWaypoints.length === 0) return _origComputeProfile(elevationData, cruiseAltFt, climbRateFpm, descentRateFpm, tasKts);

    tasKts = tasKts || parseInt(document.getElementById('tasSlider')?.value || 115);
    climbRateFpm = climbRateFpm || 500;
    descentRateFpm = descentRateFpm || 500;

    const totalDistNM = elevationData[elevationData.length - 1].distNM;
    const depElevFt = elevationData[0].elevFt;
    let destElevFt = elevationData[elevationData.length - 1].elevFt;
    // If destination is a POI (not an airport), keep cruise altitude — no descent to ground
    if (typeof currentMissionData !== 'undefined' && currentMissionData && currentMissionData.poiName) {
        destElevFt = cruiseAltFt;
    }
    const wps = vpAltWaypoints;

    // Ensure vpSegmentAlts has the right length
    while (vpSegmentAlts.length < wps.length - 1) {
        vpSegmentAlts.push(cruiseAltFt);
    }
    while (vpSegmentAlts.length > Math.max(0, wps.length - 1)) {
        vpSegmentAlts.pop();
    }

    const profile = [];

    // Climb: from departure to first WP altitude
    const firstWpAlt = wps[0].altFt;
    const climbFt = Math.max(0, firstWpAlt - depElevFt);
    const climbDistNM = Math.max(0.5, (climbFt / climbRateFpm / 60) * tasKts * 0.85);
    const tocDistNM = Math.min(climbDistNM, wps[0].distNM);

    // Descent: from last WP altitude to destination
    const lastWpAlt = wps[wps.length - 1].altFt;
    const descentFt = Math.max(0, lastWpAlt - destElevFt);
    const descentDistNM = Math.max(0.5, (descentFt / descentRateFpm / 60) * tasKts * 0.9);
    const todDistNM = Math.max(totalDistNM - descentDistNM, wps[wps.length - 1].distNM);

    for (const pt of elevationData) {
        const d = pt.distNM;
        let altFt = cruiseAltFt;

        if (d <= wps[0].distNM) {
            // CLIMB ZONE: departure → first WP
            if (d < tocDistNM) {
                const f = tocDistNM > 0 ? d / tocDistNM : 1;
                altFt = depElevFt + f * (firstWpAlt - depElevFt);
            } else {
                altFt = firstWpAlt;
            }
        } else if (d >= wps[wps.length - 1].distNM) {
            // DESCENT ZONE: last WP → destination
            if (d > todDistNM) {
                const rem = totalDistNM - todDistNM;
                const f = rem > 0 ? (d - todDistNM) / rem : 1;
                altFt = lastWpAlt - f * (lastWpAlt - destElevFt);
            } else {
                altFt = lastWpAlt;
            }
        } else if (wps.length === 1) {
            // Only 1 WP — hold at that altitude
            altFt = wps[0].altFt;
        } else {
            // MIDDLE: between two consecutive waypoints
            for (let i = 0; i < wps.length - 1; i++) {
                if (d >= wps[i].distNM && d <= wps[i + 1].distNM) {
                    const segAlt = vpSegmentAlts[i] !== undefined ? vpSegmentAlts[i] : Math.max(wps[i].altFt, wps[i + 1].altFt);
                    const segDist = wps[i + 1].distNM - wps[i].distNM;
                    const transitionDist = Math.min(segDist * 0.15, 3); // 15% of segment or max 3nm

                    const distFromLeft = d - wps[i].distNM;
                    const distFromRight = wps[i + 1].distNM - d;

                    if (distFromLeft < transitionDist && wps[i].altFt !== segAlt) {
                        // Transition from WP[i].alt to segAlt
                        const f = transitionDist > 0 ? distFromLeft / transitionDist : 1;
                        altFt = wps[i].altFt + f * (segAlt - wps[i].altFt);
                    } else if (distFromRight < transitionDist && wps[i + 1].altFt !== segAlt) {
                        // Transition from segAlt to WP[i+1].alt
                        const f = transitionDist > 0 ? distFromRight / transitionDist : 1;
                        altFt = wps[i + 1].altFt + f * (segAlt - wps[i + 1].altFt);
                    } else {
                        altFt = segAlt;
                    }
                    break;
                }
            }
        }

        profile.push({ distNM: pt.distNM, altFt: Math.round(altFt) });
    }

    return { profile, tocDistNM, todDistNM };
};

// Init altitude waypoints when map table canvas is ready

setTimeout(() => initAltWaypoints(), 2000);
// === VERTICAL PROFILE CONTROLS (V49) ===
let vpMaxAltOverride = 0; // 0 = Auto-Scaling
let vpShowClouds = localStorage.getItem('ga_show_clouds') !== 'false'; // Default: true
let vpShowLandmarks = localStorage.getItem('ga_show_landmarks') !== 'false';
let vpShowObstacles = localStorage.getItem('ga_show_obstacles') !== 'false';
document.addEventListener('DOMContentLoaded', () => {
    const bc = document.getElementById('btnToggleClouds'); if(bc) bc.classList.toggle('active', vpShowClouds);
    const bl = document.getElementById('btnToggleLandmarks'); if(bl) bl.classList.toggle('active', vpShowLandmarks);
    const bo = document.getElementById('btnToggleObstacles'); if(bo) bo.classList.toggle('active', vpShowObstacles);
});
function vpChangeAlt(delta) {
    let val = parseInt(document.getElementById('altMapInput').textContent) || 4500;
    val = Math.max(1500, Math.min(13500, val + delta));
    syncAltFromInput(val);
}
function syncAltFromInput(val) {
    val = parseInt(val) || 4500;
    const inp = document.getElementById('altMapInput');
    if (inp) inp.textContent = val;
    const mainSlider = document.getElementById('altSlider');
    if (mainSlider) mainSlider.value = val;
    handleSliderChange('alt', val); // handleSliderChange übernimmt jetzt den direkten Render
}
function vpChangeRate(delta) {
    let val = parseInt(document.getElementById('rateMapInput').textContent) || 500;
    val = Math.max(200, Math.min(1500, val + delta));
    syncRateFromInput(val);
}
function syncRateFromInput(val) {
    val = parseInt(val) || 500;
    const inp = document.getElementById('rateMapInput');
    inp.innerText = val;
    handleRateChange(val);
}
function vpChangeYAxis(delta) {
    window.activateFastRender();
    if (vpMaxAltOverride === 0) {
        const elevData = (typeof vpZoomLevel !== 'undefined' && vpZoomLevel < 100 && vpHighResData) ? vpHighResData : vpElevationData;
        if (!elevData) return;
        const cruiseAlt = parseInt(document.getElementById('altMapInput')?.textContent || 4500);
        const maxTerrain = Math.max(...elevData.map(p => p.elevFt));
        vpMaxAltOverride = Math.max(cruiseAlt + 2500, maxTerrain + 1000);
        vpMaxAltOverride = Math.ceil(vpMaxAltOverride / 1000) * 1000;
    }
    vpMaxAltOverride = Math.max(3000, vpMaxAltOverride + delta);
    document.getElementById('yAxisDisplay').textContent = (vpMaxAltOverride / 1000) + 'k';
    
    // Performance-Rendering!
    if (typeof window.throttledRenderProfiles === 'function') window.throttledRenderProfiles();
}
function vpResetYAxis() {
    window.activateFastRender();
    vpMaxAltOverride = 0;
    document.getElementById('yAxisDisplay').textContent = 'AUTO';
    renderMapProfile();
    if (document.getElementById('verticalProfileCanvas')) renderVerticalProfile('verticalProfileCanvas');
}
function vpToggleClouds() {
    vpShowClouds = !vpShowClouds;
    localStorage.setItem('ga_show_clouds', vpShowClouds);
    const btn = document.getElementById('btnToggleClouds');
    if (btn) btn.classList.toggle('active', vpShowClouds);
    
    if (vpShowClouds && window._lastVpRouteKey) {
        triggerVerticalProfileUpdate();
    } else if (typeof window.throttledRenderProfiles === 'function') {
        window.throttledRenderProfiles();
    }
}

function vpToggleLandmarks() {
    vpShowLandmarks = !vpShowLandmarks;
    localStorage.setItem('ga_show_landmarks', vpShowLandmarks);
    const btn = document.getElementById('btnToggleLandmarks');
    if (btn) btn.classList.toggle('active', vpShowLandmarks);
    
    if (vpShowLandmarks && window._lastVpRouteKey) {
        localStorage.removeItem('ga_lms_' + window._lastVpRouteKey);
        window._lastLmRouteKey = null; // Zwingt zum erneuten Fetch
        triggerVerticalProfileUpdate();
    } else if (typeof window.throttledRenderProfiles === 'function') {
        window.throttledRenderProfiles();
    }
}

function vpToggleObstacles() {
    vpShowObstacles = !vpShowObstacles;
    localStorage.setItem('ga_show_obstacles', vpShowObstacles);
    const btn = document.getElementById('btnToggleObstacles');
    if (btn) btn.classList.toggle('active', vpShowObstacles);
    
    if (vpShowObstacles && window._lastVpRouteKey) {
        localStorage.removeItem('ga_obs_' + window._lastVpRouteKey);
        window._lastObsRouteKey = null; // Zwingt zum erneuten Fetch
        triggerVerticalProfileUpdate();
    } else if (typeof window.throttledRenderProfiles === 'function') {
        window.throttledRenderProfiles();
    }
}

// === PROMPT-EINGABE für ALT / V/S (V57) ===
window.promptForAlt = function() {
    const current = document.getElementById('altMapInput').textContent;
    const res = prompt("Gewünschte Flughöhe (ALT) eingeben:", current);
    if (res !== null && !isNaN(parseInt(res))) {
        let val = parseInt(res);
        val = Math.max(1500, Math.min(13500, val));
        syncAltFromInput(val);
    }
};
window.promptForRate = function() {
    const current = document.getElementById('rateMapInput').textContent;
    const res = prompt("Gewünschte Steig-/Sinkrate (V/S) in ft/min eingeben:", current);
    if (res !== null && !isNaN(parseInt(res))) {
        let val = parseInt(res);
        val = Math.max(200, Math.min(1500, val));
        syncRateFromInput(val);
    }
};
