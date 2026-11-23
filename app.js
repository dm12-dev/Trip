/* 가족 여행 일정표 - Vanilla JS, 백엔드 없음 */
(() => {
  'use strict';

  // ---------- 유틸 ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const toStr = (m) => { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const endMin = (it) => toMin(it.start) + (Number(it.dur) || 0);
  const searchUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const dirUrl = (origin, dest, waypoints) => {
    let u = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(dest);
    if (waypoints.length) u += '&waypoints=' + waypoints.map(encodeURIComponent).join('%7C');
    return u;
  };

  // ---------- 시간 연쇄 로직 (순수 함수) ----------
  // 같은 날 idx 이후 일정들을 delta분 이동
  function shiftAfter(items, idx, delta) {
    if (!delta) return;
    for (let i = idx + 1; i < items.length; i++) {
      const d = Number(items[i].dur) || 0;
      const s = Math.max(0, Math.min(1439 - d, toMin(items[i].start) + delta));
      items[i].start = toStr(s);
    }
  }
  // 일정 수정: 시작시간/소요시간 변경 → 종료시각 차이만큼 후속 일정 이동
  function applyEdit(items, idx, patch, cascade) {
    const oldEnd = endMin(items[idx]);
    Object.assign(items[idx], patch);
    if (cascade) shiftAfter(items, idx, endMin(items[idx]) - oldEnd);
  }
  // 일정 삽입: 소요시간만큼 후속 일정 밀기
  function applyInsert(items, afterIdx, item, cascade) {
    items.splice(afterIdx + 1, 0, item);
    if (cascade) shiftAfter(items, afterIdx + 1, Number(item.dur) || 0);
  }
  // 일정 삭제: 소요시간만큼 후속 일정 당기기
  function applyDelete(items, idx, cascade) {
    const [rm] = items.splice(idx, 1);
    if (cascade) shiftAfter(items, idx - 1, -(Number(rm.dur) || 0));
  }

  // ---------- 상태 ----------
  const S = { index: [], orig: null, mod: null, sel: { choice: {}, rain: {} }, mode: 'orig', tripId: null, tab: 'day', spotCat: '관광', day: 1, stop: 0, mapMode: 'place', infoOpen: false, detailsOpen: false, hiddenDays: {} };
  const DAY_COLORS = ['#0381fe', '#12a150', '#e65100', '#8e24aa', '#d81b60', '#00897b'];
  const K = (suffix) => `ftrip:${S.tripId}:${suffix}`;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { alert('저장 실패: ' + e.message); } },
    del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
  };
  const view = () => (S.mode === 'mod' ? (S.mod || S.orig) : S.orig);
  const cascadeOn = () => $('#cascade').checked;
  function ensureMod() { if (!S.mod) S.mod = clone(S.orig); return S.mod; }
  function saveMod() { store.set(K('mod'), S.mod); }
  const origItems = (() => { let cache = null, src = null; return () => { if (src !== S.orig) { src = S.orig; cache = {}; S.orig.days.forEach((d) => d.items.forEach((it) => { cache[it.id] = it; })); } return cache; }; })();

  // ---------- 선택(식사안/우천) ----------
  const choiceOf = (it) => S.sel.choice[it.id] ?? it.choice ?? 0;
  const rainOf = (it) => S.sel.rain[it.id] ?? it.rainOn ?? false;
  const isMeal = (it) => it.cat === '식사' && it.options && !it.optLabel;
  // 지도/경로에 쓰이는 실제 대표 장소
  function primary(it) {
    if (isMeal(it)) { const o = it.options[choiceOf(it)] || it.options[0]; return { name: o.name, q: o.q }; }
    if (it.rain && rainOf(it)) return { name: it.rain.name, q: it.rain.q };
    return it.q ? { name: it.name, q: it.q } : null;
  }

  // ---------- 변경 비교 ----------
  const FIELDS = ['start', 'dur', 'name', 'memo', 'q', 'mode', 'cost', 'cat'];
  function diffOf(it) {
    const o = origItems()[it.id];
    if (!o) return { isNew: true, fields: [] };
    return { isNew: false, fields: FIELDS.filter((f) => String(o[f] ?? '') !== String(it[f] ?? '')), o };
  }

  // ---------- 렌더 ----------
  const moveIcon = (m = '') => (/택시/.test(m) ? '🚕' : /버스/.test(m) ? '🚌' : /전철|지하철|철도/.test(m) ? '🚆' : '🚶');
  const timeText = (it) => ((Number(it.dur) || 0) > 0 ? `${it.start} ~ ${toStr(endMin(it))}` : it.start);

  function renderItem(it, day, idx, items) {
    const d = S.mode === 'mod' ? diffOf(it) : { fields: [], isNew: false };
    const changed = d.isNew || d.fields.length;
    const timeChanged = d.fields.includes('start') || d.fields.includes('dur');
    const prev = items[idx - 1];
    const overlap = prev && toMin(it.start) < endMin(prev);
    const badges = (d.isNew ? '<span class="badge new">추가됨</span>' : d.fields.length ? '<span class="badge">변경됨</span>' : '')
      + (overlap ? '<span class="warn-overlap">⚠ 앞 일정과 겹침</span>' : '');
    const o = d.o;
    const oldTime = timeChanged ? `<span class="old">${esc(timeText(o))}</span> ` : '';
    const dur = (Number(it.dur) || 0) > 0 ? `<span class="dur">${it.dur}분${d.fields.includes('dur') ? ` <span class="old">${o.dur}분</span>` : ''}</span>` : '';
    const oldName = d.fields.includes('name') ? `<span class="old">${esc(o.name)}</span> ` : '';
    const editable = S.mode === 'mod';
    const actions = editable ? `
      <div class="actions">
        <button class="btn" data-act="edit" data-id="${it.id}">✏️ 수정</button>
        <button class="btn" data-act="dur" data-id="${it.id}" data-d="-15">−15분</button>
        <button class="btn" data-act="dur" data-id="${it.id}" data-d="15">+15분</button>
        <button class="btn danger" data-act="del" data-id="${it.id}">🗑 삭제</button>
      </div>` : '';

    let body;
    if (it.type === 'move') {
      body = `
        <h3>${moveIcon(it.mode)} ${oldName}${esc(it.name)}</h3>
        <div class="move-line"><b>${esc(it.mode || '')}</b>${it.from || it.to ? ` · ${esc(it.from || '')} → ${esc(it.to || '')}` : ''}</div>
        ${it.cost ? `<div class="move-line">예상 요금 <span class="cost">${esc(it.cost)}</span></div>` : ''}
        ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ''}`;
    } else {
      const p = primary(it);
      let opts = '';
      if (it.options && it.options.length) {
        const c = choiceOf(it);
        const sel = it.options[c] || it.options[0];
        opts = `
          ${it.optLabel ? `<div class="opt-label">${esc(it.optLabel)} 선택</div>` : ''}
          <div class="opts" role="radiogroup">${it.options.map((op, i) => `<button role="radio" aria-checked="${i === c}" class="${i === c ? 'on' : ''}" data-act="choose" data-id="${it.id}" data-i="${i}">${i === c ? '✓ ' : ''}${i + 1}안</button>`).join('')}</div>
          <div class="opt-name">🍽 ${esc(sel.name)}</div>
          ${sel.menu ? `<div class="opt-menu">🍴 ${esc(sel.menu)}</div>` : ''}
          <a class="maplink ${isMeal(it) ? '' : 'alt'}" target="_blank" rel="noopener" href="${searchUrl(sel.q)}">📍 ${esc(sel.name)} 지도</a>`;
      }
      let rain = '';
      if (it.rain) {
        const on = rainOf(it);
        rain = `
          <div class="rainbox ${on ? 'on' : ''}">
            <label class="switch"><input type="checkbox" data-act="rain" data-id="${it.id}" ${on ? 'checked' : ''}> ☔ 우천 시 대체 코스</label>
            ${on ? `<div class="opt-name">${esc(it.rain.name)}</div>${it.rain.memo ? `<div class="memo">${esc(it.rain.memo)}</div>` : ''}<a class="maplink" target="_blank" rel="noopener" href="${searchUrl(it.rain.q)}">📍 대체 코스 지도</a>` : `<div class="memo" style="margin:4px 0 0">${esc(it.rain.name)}</div>`}
          </div>`;
      }
      const mainName = (it.rain && rainOf(it) && !isMeal(it)) ? `<span class="old">${esc(it.name)}</span> ${esc(it.rain.name)}` : esc(it.name);
      const mainBtn = p && !isMeal(it) ? `<a class="maplink" target="_blank" rel="noopener" href="${searchUrl(p.q)}">📍 구글 지도</a>` : '';
      body = `
        <h3>${oldName}${mainName}</h3>
        ${it.memo ? `<div class="memo">${esc(it.memo)}${d.fields.includes('memo') ? ` <span class="old">(기존: ${esc(o.memo || '')})</span>` : ''}</div>` : ''}
        ${mainBtn}${opts}${rain}`;
    }
    return `
      <article class="card ${it.type === 'move' ? 'move' : 'place'}" id="${it.id}">
        <div class="item-top">
          <span class="time">${oldTime}${esc(timeText(it))}</span>${dur}
          <span class="tag ${esc(it.cat)}">${esc(it.cat)}</span>${badges}
        </div>
        ${body}${actions}
      </article>
      ${editable ? `<div class="add-row"><button class="btn" data-act="add" data-day="${day.day}" data-after="${idx}">＋ 여기 아래에 일정 추가</button></div>` : ''}`;
  }

  function routeStops(day) {
    const stops = [{ name: day.origin.name, q: day.origin.query, t: '출발', idx: -1 }];
    day.items.forEach((it, idx) => { if (it.type !== 'move') { const p = primary(it); if (p) stops.push({ ...p, t: it.start, cat: it.cat, idx }); } });
    stops.push({ name: day.destination.name, q: day.destination.query, t: '도착', idx: day.items.length });
    return stops.filter((s, i, a) => i === 0 || s.q !== a[i - 1].q);
  }

  // ---------- 지도 (Leaflet + OpenStreetMap, 키 불필요) ----------
  const ll = (p) => [p[0], p[1]];
  const rad = (d) => d * Math.PI / 180;
  const haversine = (a, b) => { const R = 6371; const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]); const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const fmtDur = (s) => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
  const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let PLACES = {};
  const geoCache = store.get('ftrip:geo') || {};
  async function geoFetch(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  // 장소 → [lat, lng]. 우선순위: trips/places.json → 캐시 → 무료 지오코더(Photon, Nominatim)
  async function geocode(s, anchor) {
    if (PLACES[s.q]) return PLACES[s.q];
    if (geoCache[s.q]) return geoCache[s.q];
    const near = (c) => !anchor || haversine(anchor, c) < 80;
    const tries = [s.q, s.name];
    for (const q of tries) {
      const bias = anchor ? `&lat=${anchor[0]}&lon=${anchor[1]}` : '';
      const j = await geoFetch('https://photon.komoot.io/api/?limit=5&q=' + encodeURIComponent(q) + bias);
      for (const f of (j && j.features) || []) { const c = [f.geometry.coordinates[1], f.geometry.coordinates[0]]; if (near(c)) { geoCache[s.q] = c; store.set('ftrip:geo', geoCache); return c; } }
    }
    for (const q of tries) {
      await sleep(1100);
      const j = await geoFetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&q=' + encodeURIComponent(q));
      for (const f of j || []) { const c = [+f.lat, +f.lon]; if (near(c)) { geoCache[s.q] = c; store.set('ftrip:geo', geoCache); return c; } }
    }
    return null;
  }
  async function resolveStops(stops) {
    const out = new Array(stops.length).fill(null);
    let anchor = null;
    stops.forEach((s, i) => { if (!anchor && PLACES[s.q]) anchor = PLACES[s.q]; });
    for (let i = 0; i < stops.length; i++) {
      out[i] = await geocode(stops[i], anchor);
      if (!anchor && out[i]) anchor = out[i];
    }
    return out;
  }
  function plannedMove(day, a, b) {
    const ms = day.items.filter((it, i) => it.type === 'move' && i > a.idx && i < b.idx);
    return ms.map((m) => `${m.mode || m.name} ${m.dur}분${m.cost ? ' · ' + m.cost : ''}`).join(' + ');
  }
  async function drawMap(day, stops, token) {
    const el = $('#map');
    if (!el) return;
    if (S.map) { S.map.remove(); S.map = null; }
    if (!window.L) { el.innerHTML = '<p class="loading">지도 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.</p>'; return; }
    const map = L.map(el, { scrollWheelZoom: false }).setView([35.0, 135.0], 5);
    S.map = map; S.markers = []; S.legLines = [];
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const status = $('#mapStatus');
    status.textContent = '장소 위치를 찾는 중…';
    const coords = await resolveStops(stops);
    if (token !== S.mapToken) return;
    const pts = [];
    stops.forEach((s, i) => {
      if (!coords[i]) return;
      pts.push(coords[i]);
      const icon = L.divIcon({ className: '', html: `<div class="pin ${i === 0 ? 'start' : i === stops.length - 1 ? 'end' : ''}">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const m = L.marker(coords[i], { icon, title: s.name }).addTo(map).bindPopup(`<b>${i + 1}. ${esc(s.name)}</b><br>${esc(s.t)}`);
      S.markers[i] = m;
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25)); 
    const missing = stops.map((s, i) => (coords[i] ? null : `${i + 1}. ${s.name}`)).filter(Boolean);
    status.textContent = missing.length ? `⚠ 위치를 찾지 못한 장소: ${missing.join(', ')} (trips/places.json에 좌표를 추가하면 표시됩니다)` : '';
    // 구간별 이동 경로 (OSRM 공개 서버: 도로 기준, 실패 시 직선)
    const idxs = stops.map((s, i) => i).filter((i) => coords[i]);
    const legs = idxs.slice(0, -1).map((i, k) => [i, idxs[k + 1]]);
    let osrm = null;
    if (idxs.length > 1) {
      const path = idxs.map((i) => coords[i][1] + ',' + coords[i][0]).join(';');
      osrm = await geoFetch('https://router.project-osrm.org/route/v1/driving/' + path + '?overview=false&steps=true&geometries=geojson');
      if (token !== S.mapToken) return;
    }
    legs.forEach(([a, b], k) => {
      const leg = osrm && osrm.routes && osrm.routes[0] && osrm.routes[0].legs[k];
      let line, info;
      if (leg) {
        const pts2 = [];
        leg.steps.forEach((st) => st.geometry.coordinates.forEach((c) => pts2.push([c[1], c[0]])));
        line = L.polyline(pts2, { color: '#0381fe', weight: 5, opacity: .8 });
        info = `🚗 차량 약 ${fmtDur(leg.duration)} · ${fmtDist(leg.distance)}`;
      } else {
        const d = haversine(coords[a], coords[b]);
        line = L.polyline([coords[a], coords[b]], { color: '#0381fe', weight: 4, opacity: .7, dashArray: '6 8' });
        info = `직선 ${d.toFixed(1)}km · 도보 약 ${fmtDur(d * 1.3 / 4.5 * 3600)}`;
      }
      line.addTo(map);
      S.legLines[a] = line;
      const planned = plannedMove(day, stops[a], stops[b]);
      const row = document.getElementById('leg-' + a);
      if (row) { row.innerHTML = `<span class="leg-i">${info}</span>${planned ? `<span class="leg-p">계획: ${esc(planned)}</span>` : ''}`; row.dataset.ok = '1'; }
    });
    stops.forEach((s, i) => {
      const row = document.getElementById('leg-' + i);
      if (row && !row.dataset.ok) row.innerHTML = `<span class="leg-i">${(coords[i] && coords[i + 1]) ? '경로 계산 실패' : '위치 미확인'}</span>`;
    });
  }

  async function drawAllDaysMap(t, token) {
    const el = $('#map');
    if (!el) return;
    if (S.map) { S.map.remove(); S.map = null; }
    if (!window.L) { el.innerHTML = '<p class="loading">지도 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.</p>'; return; }
    const map = L.map(el, { scrollWheelZoom: false }).setView([35.0, 135.0], 5);
    S.map = map; S.dayLayers = {};
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const status = $('#mapStatus');
    status.textContent = '전체 일정 경로를 불러오는 중…';

    const allPts = [];
    const missingAll = [];
    for (let di = 0; di < t.days.length; di++) {
      const day = t.days[di];
      const color = DAY_COLORS[(day.day - 1) % DAY_COLORS.length];
      const stops = routeStops(day);
      const coords = await resolveStops(stops);
      if (token !== S.mapToken) return;

      const lg = L.layerGroup();
      S.dayLayers[day.day] = lg;

      stops.forEach((s, i) => {
        if (!coords[i]) { missingAll.push(`D${day.day} ${s.name}`); return; }
        allPts.push(coords[i]);
        const icon = L.divIcon({
          className: '',
          html: `<div class="pin pin-all" style="background:${color}">${i + 1}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker(coords[i], { icon, title: `[DAY ${day.day}] ${s.name}` })
          .bindPopup(`<b style="color:${color}">DAY ${day.day} · ${i + 1}. ${esc(s.name)}</b><br>${esc(s.t)}`)
          .addTo(lg);
      });

      const idxs = stops.map((s, i) => i).filter((i) => coords[i]);
      const legs = idxs.slice(0, -1).map((i, k) => [i, idxs[k + 1]]);
      let osrm = null;
      if (idxs.length > 1) {
        const path = idxs.map((i) => coords[i][1] + ',' + coords[i][0]).join(';');
        osrm = await geoFetch('https://router.project-osrm.org/route/v1/driving/' + path + '?overview=false&steps=true&geometries=geojson');
        if (token !== S.mapToken) return;
      }
      legs.forEach(([a, b], k) => {
        const leg = osrm && osrm.routes && osrm.routes[0] && osrm.routes[0].legs[k];
        if (leg) {
          const pts2 = [];
          leg.steps.forEach((st) => st.geometry.coordinates.forEach((c) => pts2.push([c[1], c[0]])));
          L.polyline(pts2, { color, weight: 4.5, opacity: 0.85 }).addTo(lg);
        } else {
          L.polyline([coords[a], coords[b]], { color, weight: 3.5, opacity: 0.75, dashArray: '6 8' }).addTo(lg);
        }
      });

      if (!S.hiddenDays[day.day]) lg.addTo(map);
    }

    if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.18));
    status.textContent = missingAll.length ? `⚠ 위치 미확인: ${missingAll.join(', ')}` : '';
  }

  function renderAllDaysMap(t) {
    S.mapToken = (S.mapToken || 0) + 1;
    const token = S.mapToken;
    setTimeout(() => drawAllDaysMap(t, token), 0);
    const legend = t.days.map((d) => {
      const color = DAY_COLORS[(d.day - 1) % DAY_COLORS.length];
      const off = !!S.hiddenDays[d.day];
      return `<button class="legend-chip ${off ? 'off' : ''}" data-act="toggleDayLayer" data-day="${d.day}" aria-pressed="${!off}"><span class="dot" style="background:${color}"></span>DAY ${d.day} (${esc(d.label)})</button>`;
    }).join('');
    const summaries = t.days.map((d) => {
      const color = DAY_COLORS[(d.day - 1) % DAY_COLORS.length];
      const stops = routeStops(d);
      return `
        <article class="card all-day-card" style="border-left:4px solid ${color}">
          <div class="all-day-head">
            <strong style="color:${color}">DAY ${d.day} · ${esc(d.label)}</strong>
            <span>${esc(d.title || '')}</span>
            <button class="btn all-day-go" data-act="day" data-day="${d.day}">상세 지도 →</button>
          </div>
          <div class="all-day-route">${stops.map((s) => esc(s.name)).join(' → ')}</div>
        </article>`;
    }).join('');
    return `
      <section id="day-all">
        <div class="day-head"><h2>전체 일정 지도</h2><span>일자별 색상 구분 · 범례를 눌러 켜고 끌 수 있습니다</span></div>
        <div class="map-wrap"><div id="map" class="map" role="img" aria-label="전체 일정 경로 지도"></div></div>
        <div id="mapStatus" class="map-status"></div>
        <div class="legend" role="group" aria-label="일자별 동선 표시">${legend}</div>
        <div class="all-days-list">${summaries}</div>
      </section>`;
  }

  function renderDay(day) {
    const stops = routeStops(day);
    const rows = stops.map((s, i) => `
      <button class="stop" data-act="stop" data-i="${i}"><span class="num">${i + 1}</span><span class="stop-t">${esc(s.t)}</span><span class="stop-n">${esc(s.name)}</span></button>
      ${i < stops.length - 1 ? `<div class="leg" id="leg-${i}" data-act="leg" data-i="${i}"><span class="leg-i">경로 계산 중…</span></div>` : ''}`).join('');
    const mid = stops.slice(1, -1).map((s) => s.q).slice(0, 9);
    const url = dirUrl(stops[0].q, stops[stops.length - 1].q, mid);
    S.curStops = stops;
    S.mapToken = (S.mapToken || 0) + 1;
    const token = S.mapToken;
    setTimeout(() => drawMap(day, stops, token), 0);
    const removed = S.mode === 'mod' ? origItemsOfDay(day.day).filter((o) => !day.items.some((i) => i.id === o.id)) : [];
    return `
      <section id="day${day.day}">
        <div class="day-head"><h2>DAY ${day.day}</h2><span>${esc(day.label)} · ${esc(day.title || '')}</span></div>
        <div class="map-wrap"><div id="map" class="map" role="img" aria-label="DAY ${day.day} 전체 경로 지도"></div></div>
        <div id="mapStatus" class="map-status"></div>
        <div class="stops" aria-label="일자별 방문 순서">${rows}</div>
        <a class="maplink route-btn" target="_blank" rel="noopener" href="${url}">🗺 Google 지도에서 열기 (대중교통 경로 확인)</a>
        <details class="details" ${S.detailsOpen ? 'open' : ''}>
          <summary>세부 일정 보기 (${day.items.length}개)</summary>
          ${S.mode === 'mod' ? `<div class="add-row"><button class="btn" data-act="add" data-day="${day.day}" data-after="-1">＋ 맨 앞에 일정 추가</button></div>` : ''}
          ${day.items.map((it, i) => renderItem(it, day, i, day.items)).join('')}
          ${removed.map((o) => `<article class="card removed"><div class="item-top"><span class="time">${esc(timeText(o))}</span><span class="badge">삭제됨</span></div><h3>${esc(o.name)}</h3></article>`).join('')}
        </details>
      </section>`;
  }
  const origItemsOfDay = (n) => S.orig.days.find((d) => d.day === n).items;

  function renderFoodView(t) {
    const rows = [];
    t.days.forEach((d) => {
      d.items.filter((it) => (it.options && it.options.length) || it.cat === '식사').forEach((it) => {
        const mealName = it.optLabel ? `${it.optLabel}` : it.name;
        const c = choiceOf(it);
        const cells = (it.options && it.options.length)
          ? [0, 1, 2].map((i) => {
              const op = it.options[i];
              if (!op) return '<td><span class="muted">-</span></td>';
              const on = i === c;
              return `
                <td class="cell-opt ${on ? 'on' : ''}">
                  <button class="cell-pick" data-act="choose" data-id="${it.id}" data-i="${i}" aria-pressed="${on}">
                    <span class="cell-title">${on ? '✓ ' : ''}${esc(op.name)}</span>
                    ${op.menu ? `<span class="cell-sub">${esc(op.menu)}</span>` : ''}
                  </button>
                  <a class="cell-map" target="_blank" rel="noopener" href="${searchUrl(op.q)}">📍 지도</a>
                </td>`;
            }).join('')
          : `<td colspan="3"><strong>${esc(it.name)}</strong>${it.memo ? `<div class="cell-sub">${esc(it.memo)}</div>` : ''}${it.q ? ` <a class="cell-map" target="_blank" rel="noopener" href="${searchUrl(it.q)}">📍 지도</a>` : ''}</td>`;
        rows.push(`
          <tr>
            <th scope="row">
              <div class="t-day">DAY ${d.day}</div>
              <div class="t-meal">${esc(mealName)}</div>
              <div class="t-time">${esc(it.start)}</div>
            </th>
            ${cells}
          </tr>`);
      });
    });
    if (!rows.length) return '<p class="loading">등록된 식사 일정이 없습니다.</p>';
    return `
      <div class="table-hint">식당을 눌러 1·2·3안을 선택할 수 있습니다 (지도 경로와 연동)</div>
      <div class="card table-wrap">
        <table class="tbl tbl-food">
          <thead><tr><th>일자/식사</th><th>1안</th><th>2안</th><th>3안</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
  }

  function renderSpotsView(t) {
    const includeShop = S.spotCat === 'all';
    const filterBar = `
      <div class="spot-filter" role="group" aria-label="장소 분류">
        <button class="btn ${!includeShop ? 'primary' : ''}" data-act="spotcat" data-cat="관광">🎡 관광지만</button>
        <button class="btn ${includeShop ? 'primary' : ''}" data-act="spotcat" data-cat="all">🛍 쇼핑 포함 전체</button>
      </div>`;
    const rows = [];
    t.days.forEach((d) => {
      d.items.filter((it) => it.type !== 'move' && (includeShop ? (it.cat === '관광' || it.cat === '쇼핑') : it.cat === '관광')).forEach((it) => {
        rows.push(`
          <tr>
            <th scope="row">
              <div class="t-day">DAY ${d.day}</div>
              <div class="t-time">${esc(timeText(it))}</div>
            </th>
            <td>
              <span class="tag ${esc(it.cat)}">${esc(it.cat)}</span>
              <div class="cell-title" style="margin-top:4px">${esc(it.name)}</div>
              ${it.q ? `<a class="cell-map" target="_blank" rel="noopener" href="${searchUrl(it.q)}">📍 지도</a>` : ''}
            </td>
            <td><div class="cell-memo">${esc(it.memo || '-')}</div></td>
            <td>${it.rain ? `<div class="cell-rain">☔ ${esc(it.rain.name)}</div><a class="cell-map" target="_blank" rel="noopener" href="${searchUrl(it.rain.q)}">📍 대체 지도</a>` : '<span class="muted">-</span>'}</td>
          </tr>`);
      });
    });
    return filterBar + (rows.length
      ? `<div class="card table-wrap"><table class="tbl tbl-spots"><thead><tr><th>일자/시간</th><th>장소</th><th>주요 내용</th><th>우천 대체</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<p class="loading">해당하는 장소가 없습니다.</p>');
  }

  function render() {
    const t = view();
    const lod = t.lodging;
    $('#app').innerHTML = `
      <section class="viewing">
        <h1>${esc(t.title)}</h1>
        <div class="sub">${esc(t.subtitle || '')}</div>
      </section>
      <details class="card info-card info-details" ${S.infoOpen ? 'open' : ''}>
        <summary class="info-summary">
          <span class="info-summary-text">✈ 항공 · 🏨 ${esc(lod.name)} · 👨‍👩‍👧‍👦 ${esc(t.party)}</span>
          <span class="chev" aria-hidden="true"></span>
        </summary>
        <div class="info">
          ${(t.flights || []).map((f) => `<div class="info-row"><b>✈ ${esc(f.label)}</b><span>${esc(f.text)}</span></div>`).join('')}
          <div class="info-row"><b>🏨 숙소</b><span>${esc(lod.name)}<br><small>${esc(lod.note || '')}</small><br><br><a class="maplink" style="margin-top:8px" target="_blank" rel="noopener" href="${searchUrl(lod.query)}">📍 구글 지도</a></span></div>
          <div class="info-row"><b>👨‍👩‍👧‍👦 인원</b><span>${esc(t.party)}</span></div>
          <div class="info-row"><b>💴 예산</b><span>${esc(t.budget)}</span></div>
        </div>
      </details>
      <div class="viewtabs" role="tablist" aria-label="보기 방식">
        <button class="${S.tab === 'day' ? 'on' : ''}" data-act="tab" data-tab="day" role="tab" aria-selected="${S.tab === 'day'}">🗺 일자별 지도</button>
        <button class="${S.tab === 'food' ? 'on' : ''}" data-act="tab" data-tab="food" role="tab" aria-selected="${S.tab === 'food'}">🍽 식당 모음</button>
        <button class="${S.tab === 'spots' ? 'on' : ''}" data-act="tab" data-tab="spots" role="tab" aria-selected="${S.tab === 'spots'}">🎡 관광지 모음</button>
      </div>
      ${S.tab === 'day' ? `<nav class="daynav">${t.days.map((d) => `<button class="${S.day === d.day ? 'on' : ''}" data-act="day" data-day="${d.day}">DAY ${d.day} · ${esc(d.label)}</button>`).join('')}<button class="${S.day === 'all' ? 'on' : ''}" data-act="day" data-day="all">🗺 전체</button></nav>
      ${S.day === 'all' ? renderAllDaysMap(t) : renderDay(t.days.find((d) => d.day === S.day) || t.days[0])}` : S.tab === 'food' ? renderFoodView(t) : renderSpotsView(t)}`;
    $('#modeOrig').classList.toggle('on', S.mode === 'orig');
    $('#modeMod').classList.toggle('on', S.mode === 'mod');
    $('#tools').classList.toggle('hidden', S.mode !== 'mod');
    const note = $('#modeNote');
    note.className = 'mode-note' + (S.mode === 'mod' ? ' mod' : '');
    note.textContent = S.mode === 'orig' ? '🔒 원본 계획 (읽기 전용) · 식사안/우천 선택만 가능' : '✏️ 변경된 일정 · 수정 즉시 이 브라우저에 자동 저장됩니다';
    document.title = t.title + ' · 일정표';
  }

  // ---------- 다이얼로그 ----------
  const CATS = ['식사', '관광', '쇼핑', '이동', '숙소'];
  function openDialog(mode, dayNo, ref) {
    const day = S.mod.days.find((d) => d.day === dayNo);
    let it, title;
    if (mode === 'edit') { it = day.items[ref]; title = '일정 수정'; }
    else {
      const prev = day.items[ref];
      it = { type: 'place', cat: '관광', name: '', start: prev ? toStr(endMin(prev)) : '09:00', dur: 60, q: '', memo: '' };
      title = '일정 추가';
    }
    const isMove = it.type === 'move';
    $('#dlgForm').innerHTML = `
      <h3>${title}</h3>
      ${mode === 'add' ? `<label class="f">유형<select name="type"><option value="place">장소/활동</option><option value="move">이동</option></select></label>` : ''}
      <label class="f">장소/일정명<input type="text" name="name" required value="${esc(it.name)}"></label>
      <div class="f-row">
        <label class="f">시작<input type="time" name="start" required value="${it.start}"></label>
        <label class="f">소요(분)<input type="number" name="dur" min="0" step="5" required value="${it.dur}"></label>
        <label class="f">카테고리<select name="cat">${CATS.map((c) => `<option ${c === it.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <label class="f">구글 지도 검색어 (장소명)<input type="text" name="q" value="${esc(it.q || '')}"></label>
      <div class="f-row">
        <label class="f">교통수단 (이동일 때)<input type="text" name="mode" value="${esc(it.mode || '')}"></label>
        <label class="f">예상 요금<input type="text" name="cost" value="${esc(it.cost || '')}"></label>
      </div>
      <label class="f">메모<textarea name="memo" rows="2">${esc(it.memo || '')}</textarea></label>
      <div class="f" style="font-size:12px">${cascadeOn() ? '✅ 저장 시 같은 날 이후 일정 시간이 함께 조정됩니다.' : '⚠ "이후 일정 함께 밀기"가 꺼져 있어 이 일정만 변경됩니다.'}</div>
      <div class="dlg-actions"><button type="button" class="btn" data-act="dlgcancel">취소</button><button type="submit" class="btn primary">저장</button></div>`;
    const dlg = $('#dlg');
    $('#dlgForm').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData($('#dlgForm'));
      const patch = { name: f.get('name').trim(), start: f.get('start'), dur: Math.max(0, parseInt(f.get('dur'), 10) || 0), cat: f.get('cat'), q: f.get('q').trim(), mode: f.get('mode').trim(), cost: f.get('cost').trim(), memo: f.get('memo').trim() };
      if (!patch.name || !patch.start) return;
      ensureMod();
      const d = S.mod.days.find((x) => x.day === dayNo);
      if (mode === 'edit') applyEdit(d.items, ref, patch, cascadeOn());
      else {
        const type = f.get('type') || 'place';
        const item = { id: 'n' + Date.now().toString(36), type, ...patch };
        if (type === 'move') { item.from = ''; item.to = ''; item.cat = '이동'; }
        applyInsert(d.items, ref, item, cascadeOn());
      }
      saveMod(); dlg.close(); render();
    };
    dlg.showModal();
  }

  // ---------- 이벤트 ----------
  function findItem(id) {
    for (const d of S.mod.days) { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) return { day: d, idx: i }; }
    return null;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'choose') { S.sel.choice[id] = +b.dataset.i; store.set(K('sel'), S.sel); render(); return; }
    if (act === 'dlgcancel') { $('#dlg').close(); return; }
    if (act === 'tab') {
      S.tab = b.dataset.tab; render();
      const vt = $('.viewtabs'), bar = $('.appbar');
      if (vt) window.scrollTo({ top: Math.max(0, vt.offsetTop - (bar ? bar.offsetHeight : 0) - 4) });
      return;
    }
    if (act === 'spotcat') { S.spotCat = b.dataset.cat; render(); return; }
    if (act === 'toggleDayLayer') {
      const dno = +b.dataset.day;
      S.hiddenDays[dno] = !S.hiddenDays[dno];
      const lg = S.dayLayers && S.dayLayers[dno];
      if (lg && S.map) { if (S.hiddenDays[dno]) S.map.removeLayer(lg); else lg.addTo(S.map); }
      b.classList.toggle('off', !!S.hiddenDays[dno]);
      b.setAttribute('aria-pressed', String(!S.hiddenDays[dno]));
      return;
    }
    if (act === 'day') {
      S.day = b.dataset.day === 'all' ? 'all' : +b.dataset.day; S.stop = 0; render();
      const nav = $('.daynav'), bar = $('.appbar');
      if (nav) window.scrollTo({ top: Math.max(0, nav.offsetTop - (bar ? bar.offsetHeight : 0) - 4) });
      return;
    }
    if (act === 'stop') { const m = S.markers && S.markers[+b.dataset.i]; if (m && S.map) { S.map.setView(m.getLatLng(), Math.max(S.map.getZoom(), 14)); m.openPopup(); document.getElementById('map').scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    if (act === 'leg') { const l = S.legLines && S.legLines[+b.dataset.i]; if (l && S.map) { S.map.fitBounds(l.getBounds().pad(0.3)); document.getElementById('map').scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    if (S.mode !== 'mod') return;
    ensureMod();
    if (act === 'edit') { const r = findItem(id); openDialog('edit', r.day.day, r.idx); }
    else if (act === 'add') openDialog('add', +b.dataset.day, +b.dataset.after);
    else if (act === 'dur') {
      const r = findItem(id); const nd = Math.max(0, (Number(r.day.items[r.idx].dur) || 0) + (+b.dataset.d));
      applyEdit(r.day.items, r.idx, { dur: nd }, cascadeOn()); saveMod(); render();
    } else if (act === 'del') {
      const r = findItem(id);
      if (confirm(`"${r.day.items[r.idx].name}" 일정을 삭제할까요?`)) { applyDelete(r.day.items, r.idx, cascadeOn()); saveMod(); render(); }
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.act === 'rain') { S.sel.rain[t.dataset.id] = t.checked; store.set(K('sel'), S.sel); render(); }
    if (t.id === 'cascade') localStorage.setItem('ftrip:cascade', t.checked ? '1' : '0');
  });
  document.addEventListener('toggle', (e) => {
    const cl = e.target.classList;
    if (!cl) return;
    if (cl.contains('details')) S.detailsOpen = e.target.open;
    if (cl.contains('info-details')) S.infoOpen = e.target.open;
  }, true);
  $('#modeOrig').onclick = () => setMode('orig');
  $('#modeMod').onclick = () => setMode('mod');
  function setMode(m) { S.mode = m; localStorage.setItem('ftrip:mode', m); render(); }
  $('#tripSelect').onchange = (e) => { location.hash = 'trip=' + e.target.value; };
  $('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg')) $('#dlg').close(); });
  window.addEventListener('hashchange', () => loadTrip(tripFromHash()));
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; localStorage.setItem('ftrip:theme', next);
  };
  $('#exportBtn').onclick = () => {
    const out = clone(S.mod || S.orig);
    out.days.forEach((d) => d.items.forEach((it) => {
      if (it.options) it.choice = choiceOf(it); if (it.rain) it.rainOn = rainOf(it);
    }));
    const blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = S.tripId + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('변경된 일정을 모두 버리고 원본 계획으로 초기화할까요?')) return;
    S.mod = null; store.del(K('mod')); render();
  };

  // ---------- 로딩 ----------
  const tripFromHash = () => (location.hash.match(/trip=([^&]+)/) || [])[1];
  async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function loadTrip(id) {
    const entry = S.index.find((t) => t.id === id) || S.index[0];
    if (!entry) { $('#app').innerHTML = '<p class="loading">등록된 여행이 없습니다.</p>'; return; }
    S.tripId = entry.id; S.day = 1; S.stop = 0;
    $('#tripSelect').value = entry.id;
    try { S.orig = await getJson(`trips/${entry.file || entry.id + '.json'}`); }
    catch (e) { $('#app').innerHTML = `<p class="loading">여행 데이터를 불러올 수 없습니다: ${esc(e.message)}</p>`; return; }
    S.mod = store.get(K('mod'));
    S.sel = store.get(K('sel')) || { choice: {}, rain: {} };
    render();
  }
  const statusOf = (t) => {
    const today = new Date().toISOString().slice(0, 10);
    return t.end < today ? '지난 여행' : t.start > today ? '예정' : '진행 중';
  };
  async function init() {
    const th = localStorage.getItem('ftrip:theme'); if (th) document.documentElement.dataset.theme = th;
    $('#cascade').checked = localStorage.getItem('ftrip:cascade') !== '0';
    S.mode = localStorage.getItem('ftrip:mode') === 'mod' ? 'mod' : 'orig';
    try { S.index = await getJson('trips/index.json'); }
    catch (e) { $('#app').innerHTML = `<p class="loading">trips/index.json 로드 실패 (${esc(e.message)}).<br>로컬에서는 간단한 웹서버로 열어주세요.</p>`; return; }
    try { PLACES = await getJson('trips/places.json'); } catch { PLACES = {}; }
    S.index.sort((a, b) => (a.start < b.start ? 1 : -1));
    $('#tripSelect').innerHTML = S.index.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} · ${esc(t.dates || '')} (${statusOf(t)})</option>`).join('');
    loadTrip(tripFromHash());
  }
  window.__tp = { shiftAfter, applyEdit, applyInsert, applyDelete, toMin, toStr, dirUrl, searchUrl };
  init();
})();
