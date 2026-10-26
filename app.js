/* HAYP Dostawy – logika aplikacji (bez frameworków) */
'use strict';
(() => {
  const APP_VERSION = '1.0.1';
  // Nowe adresy HeiGIT (stary api.openrouteservice.org wyłączany w listopadzie 2026)
  const ROUTE_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
  const GEO_BASE = 'https://api.heigit.org/pelias/v1';

  // Domyślne ceny: średnie e-petrol z 14.10.2026; spalanie – typowe auto miejskie.
  const FUEL_PRESETS = {
    Pb95: { price: 6.97, consumption: 7.0, label: 'Pb95' },
    ON:   { price: 7.98, consumption: 6.0, label: 'Diesel' },
    LPG:  { price: 3.39, consumption: 9.0, label: 'LPG' },
  };
  const DEFAULT_SETTINGS = {
    apiKey: '',
    startAddress: 'ul. Puławska 14, Baniocha',
    startLat: null,
    startLon: null,
    fuelType: 'Pb95',
    fuelPrice: FUEL_PRESETS.Pb95.price,
    consumption: FUEL_PRESETS.Pb95.consumption,
    showMap: true,
    retentionDays: 30,
  };
  const KEYS = { settings: 'hayp.settings.v1', deliveries: 'hayp.deliveries.v1' };
  const DAY_MS = 86400000;

  /* ---------- Pamięć telefonu ---------- */
  function load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
  let deliveries = load(KEYS.deliveries, []);
  if (!Array.isArray(deliveries)) deliveries = [];

  function persistSettings() { if (!save(KEYS.settings, settings)) toast('Nie udało się zapisać ustawień w telefonie.'); }
  function persistDeliveries() { if (!save(KEYS.deliveries, deliveries)) toast('Nie udało się zapisać historii w telefonie.'); }

  function purgeOld() {
    const cutoff = Date.now() - Number(settings.retentionDays || 30) * DAY_MS;
    const before = deliveries.length;
    deliveries = deliveries.filter(d => Date.parse(d.createdAt) >= cutoff);
    if (deliveries.length !== before) persistDeliveries();
  }

  /* ---------- Formatowanie i obliczenia ---------- */
  const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtKm = km => `${nf1.format(km)} km`;
  const fmtMoney = v => money.format(v);
  const fmtMin = s => (s == null ? '' : `ok. ${Math.max(1, Math.round(s / 60))} min`);
  const fmtTime = iso => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = iso => new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const round2 = n => Math.round(n * 100) / 100;
  const toInput = n => String(n).replace('.', ',');

  function parseNum(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  /** Koszt paliwa: km × (l/100 km) / 100 × zł/l */
  function fuelCost(km, consumption, price) {
    if (!(km >= 0) || !(consumption >= 0) || !(price >= 0)) return 0;
    return km * consumption / 100 * price;
  }

  function normalizePhone(raw) {
    let s = String(raw || '').replace(/[\s\-().]/g, '');
    if (/^0048\d{9}$/.test(s)) s = '+48' + s.slice(4);
    if (/^48\d{9}$/.test(s)) s = '+' + s;
    return /^\+?\d{7,15}$/.test(s) ? s : null;
  }
  function displayPhone(p) {
    if (/^\d{9}$/.test(p)) return p.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    if (/^\+48\d{9}$/.test(p)) return '+48 ' + p.slice(3).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    return p;
  }
  const telHref = p => 'tel:' + (/^\d{9}$/.test(p) ? '+48' + p : p);

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- openrouteservice ---------- */
  const msg0 = e => (e && typeof e === 'object' ? e.message : e);

  class OrsError extends Error {
    constructor(message, status) { super(message); this.name = 'OrsError'; this.status = status; }
  }

  async function orsFetch(url, opts = {}) {
    let res;
    try { res = await fetch(url, opts); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new OrsError('Brak internetu albo serwer map nie odpowiada. Spróbuj ponownie albo wpisz km ręcznie.', 0);
    }
    if (res.ok) return res.json();
    let body = null;
    try { body = await res.json(); } catch { /* brak treści */ }
    const err = body && body.error;
    const code = err && typeof err === 'object' ? err.code : null;
    const errText = String(msg0(err) || '').toLowerCase();
    if (res.status === 403 && /quota|limit/.test(errText)) throw new OrsError('Wyczerpany dzienny limit zapytań (odnawia się po 24 h). Wpisz km ręcznie.', 403);
    if (res.status === 401 || res.status === 403) throw new OrsError('Nieprawidłowy albo nieaktywny klucz API (albo wyczerpany dzienny limit) – sprawdź Ustawienia.', res.status);
    if (res.status === 429) throw new OrsError('Wyczerpany limit zapytań do map. Odczekaj chwilę albo wpisz km ręcznie.', 429);
    if (res.status === 404 || code === 2009 || code === 2010) throw new OrsError('Nie da się wyznaczyć trasy do tego punktu. Wybierz inny adres albo wpisz km ręcznie.', res.status);
    const msg = err && (err.message || (typeof err === 'string' ? err : ''));
    throw new OrsError(`Błąd serwera map (${res.status})${msg ? ': ' + msg : ''}.`, res.status);
  }

  function geoParams(text, size) {
    const p = new URLSearchParams({ text, 'boundary.country': 'PL', size: String(size) });
    if (hasStart()) {
      p.set('focus.point.lat', String(settings.startLat));
      p.set('focus.point.lon', String(settings.startLon));
    }
    return p;
  }

  function toPlaces(json) {
    return (json && json.features ? json.features : [])
      .filter(f => f.geometry && Array.isArray(f.geometry.coordinates))
      .map(f => {
        const pr = f.properties || {};
        return {
          label: pr.label || pr.name || '',
          name: pr.name || pr.label || '',
          area: [pr.locality || pr.localadmin, pr.county].filter(Boolean).join(', '),
          lon: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          distance: typeof pr.distance === 'number' ? pr.distance : null,
        };
      });
  }

  async function geocodeAutocomplete(text, signal) {
    const p = geoParams(text, 6);
    p.set('layers', 'address,street,venue,locality');
    return toPlaces(await orsFetch(`${GEO_BASE}/autocomplete?${p}`, { signal, headers: { Authorization: settings.apiKey } }));
  }

  async function geocodeSearch(text, signal, size = 6, key) {
    const p = geoParams(text, size);
    return toPlaces(await orsFetch(`${GEO_BASE}/search?${p}`, { signal, headers: { Authorization: key || settings.apiKey } }));
  }

  /** Trasa: restauracja → klient → restauracja (dwa odcinki, bo powrót bywa inny przez jednokierunkowe ulice). */
  async function fetchRoute(start, dest, signal) {
    const body = {
      coordinates: [[start.lon, start.lat], [dest.lon, dest.lat], [start.lon, start.lat]],
      radiuses: [2000, 2000, 2000],
      instructions: true,
    };
    const json = await orsFetch(ROUTE_URL, {
      method: 'POST',
      headers: {
        'Authorization': settings.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json',
      },
      body: JSON.stringify(body),
      signal,
    });
    return parseRoute(json);
  }

  function parseRoute(json) {
    const f = json && json.features && json.features[0];
    if (!f || !f.properties) throw new OrsError('Serwer nie zwrócił trasy.', 0);
    const segs = f.properties.segments || [];
    const sum = f.properties.summary || {};
    let mOne, mBack, sOne, sBack;
    if (segs.length >= 2) {
      mOne = segs[0].distance || 0; mBack = segs[1].distance || 0;
      sOne = segs[0].duration || 0; sBack = segs[1].duration || 0;
    } else if (typeof sum.distance === 'number') {
      mOne = mBack = sum.distance / 2;
      sOne = sBack = (sum.duration || 0) / 2;
    } else {
      throw new OrsError('Serwer zwrócił trasę bez długości.', 0);
    }
    return {
      kmOne: mOne / 1000,
      kmBack: mBack / 1000,
      kmTotal: (mOne + mBack) / 1000,
      secOne: sOne,
      secBack: sBack,
      geometry: (f.geometry && f.geometry.coordinates) || [],
    };
  }

  const hasStart = () => Number.isFinite(settings.startLat) && Number.isFinite(settings.startLon);

  async function ensureStart() {
    if (hasStart()) return true;
    if (!settings.apiKey) return false;
    try {
      const res = await geocodeSearch(settings.startAddress, undefined, 1);
      if (!res.length) throw new OrsError('Nie znalazłem adresu startowego – popraw go w Ustawieniach.', 0);
      settings.startLat = res[0].lat;
      settings.startLon = res[0].lon;
      persistSettings();
      return true;
    } catch (e) {
      setStatus(e.message, 'err');
      return false;
    }
  }

  /* ---------- DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const els = {
    views: { new: $('#view-new'), history: $('#view-history'), settings: $('#view-settings') },
    tabs: [...document.querySelectorAll('.tab')],
    setupWarning: $('#setup-warning'),
    addr: $('#addr'), addrSearch: $('#addr-search'), suggestions: $('#suggestions'), status: $('#addr-status'),
    manualToggle: $('#manual-toggle'), manualBox: $('#manual-box'), manualKm: $('#manual-km'), manualApply: $('#manual-apply'),
    result: $('#result'), pickedLabel: $('#picked-label'),
    kmOne: $('#km-one'), kmBoth: $('#km-both'), minOne: $('#min-one'), minBoth: $('#min-both'),
    costBoth: $('#cost-both'), costOne: $('#cost-one'), costBasis: $('#cost-basis'), map: $('#map'),
    form: $('#order-form'), fName: $('#f-name'), fPhone: $('#f-phone'), fOrder: $('#f-order'), fComment: $('#f-comment'),
    formError: $('#form-error'), clearForm: $('#clear-form'),
    historyList: $('#history-list'), historyEmpty: $('#history-empty'),
    sumCount: $('#sum-count'), sumKm: $('#sum-km'), sumCost: $('#sum-cost'), exportCsv: $('#export-csv'),
    sForm: $('#settings-form'), sKey: $('#s-key'), sKeyShow: $('#s-key-show'), sStart: $('#s-start'), sStartCoords: $('#s-start-coords'),
    sStartFind: $('#s-start-find'), sStartGps: $('#s-start-gps'), sFuel: $('#s-fuel'), sPrice: $('#s-price'), sCons: $('#s-cons'),
    sMap: $('#s-map'), sRetention: $('#s-retention'), sMsg: $('#settings-msg'), sWipe: $('#s-wipe'), appVersion: $('#app-version'),
    detail: $('#detail'), dTitle: $('#d-title'), dBody: $('#d-body'), dClose: $('#d-close'), dShare: $('#d-share'),
    dSms: $('#d-sms'), dWa: $('#d-wa'), dNav: $('#d-nav'), dCall: $('#d-call'), dDone: $('#d-done'), dDelete: $('#d-delete'),
    toast: $('#toast'), installBtn: $('#install-btn'),
  };

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
  }

  function setStatus(msg, kind = '') {
    els.status.textContent = msg || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* ---------- Zakładki ---------- */
  let activeView = 'new';
  function showView(name) {
    activeView = name;
    Object.entries(els.views).forEach(([k, v]) => {
      const on = k === name;
      v.hidden = !on;
      v.classList.toggle('active', on);
    });
    els.tabs.forEach(t => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    if (name === 'history') renderHistory();
    if (name === 'settings') fillSettings();
    if (name === 'new') { updateSetupWarning(); renderResult(); }
    window.scrollTo(0, 0);
  }
  els.tabs.forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));

  function updateSetupWarning() { els.setupWarning.hidden = !!settings.apiKey; }

  /* ---------- Nowa dostawa: adres ---------- */
  let current = { dest: null, route: null, manualKm: null };
  let acTimer = null, acController = null, acSeq = 0, routeController = null;
  const acCache = new Map();

  function resetRoute() {
    current.dest = null;
    current.route = null;
    if (routeController) routeController.abort();
    renderResult();
  }

  function hideSuggestions() {
    els.suggestions.hidden = true;
    els.suggestions.innerHTML = '';
  }

  function showSuggestions(places) {
    els.suggestions.innerHTML = '';
    if (!places.length) { els.suggestions.hidden = true; return; }
    places.forEach(pl => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const main = document.createElement('span');
      main.className = 'sg-main';
      main.textContent = pl.name;
      const sub = document.createElement('span');
      sub.className = 'sg-sub';
      const extra = pl.distance != null ? ` · ${nf1.format(pl.distance)} km w linii prostej` : '';
      sub.textContent = (pl.label !== pl.name ? pl.label : pl.area) + extra;
      li.append(main, sub);
      li.addEventListener('click', () => pick(pl));
      els.suggestions.appendChild(li);
    });
    els.suggestions.hidden = false;
  }

  async function runSuggest(text, full) {
    if (!settings.apiKey) {
      setStatus('Najpierw wklej klucz API w Ustawieniach albo wpisz km ręcznie.', 'err');
      return;
    }
    if (!hasStart()) await ensureStart();
    const cacheKey = (full ? 's:' : 'a:') + text.toLowerCase();
    if (acController) acController.abort();
    acController = new AbortController();
    const seq = ++acSeq;
    setStatus('Szukam…');
    try {
      let places = acCache.get(cacheKey);
      if (!places) {
        places = full ? await geocodeSearch(text, acController.signal) : await geocodeAutocomplete(text, acController.signal);
        acCache.set(cacheKey, places);
      }
      if (seq !== acSeq) return;
      if (full && places.length === 1) { pick(places[0]); return; }
      showSuggestions(places);
      if (places.length) setStatus('Wybierz adres z listy.');
      else setStatus('Nic nie znaleziono. Dopisz miejscowość albo naciśnij lupę.', 'err');
    } catch (e) {
      if (e.name === 'AbortError' || seq !== acSeq) return;
      hideSuggestions();
      setStatus(e.message, 'err');
    }
  }

  els.addr.addEventListener('input', () => {
    const text = els.addr.value.trim();
    if (current.dest && text !== current.dest.label) resetRoute();
    clearTimeout(acTimer);
    if (text.length < 3 || !settings.apiKey) { hideSuggestions(); if (!text) setStatus(''); return; }
    acTimer = setTimeout(() => runSuggest(text, false), 350);
  });
  els.addr.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(acTimer);
      const text = els.addr.value.trim();
      if (text.length >= 3) runSuggest(text, true);
    }
  });
  els.addrSearch.addEventListener('click', () => {
    clearTimeout(acTimer);
    const text = els.addr.value.trim();
    if (text.length >= 3) runSuggest(text, true);
    else setStatus('Wpisz co najmniej 3 znaki adresu.', 'err');
  });

  async function pick(place) {
    hideSuggestions();
    clearTimeout(acTimer);
    if (acController) acController.abort();
    els.addr.value = place.label;
    els.addr.blur();
    current = { dest: place, route: null, manualKm: null };
    els.manualBox.hidden = true;
    els.manualKm.value = '';
    renderResult();
    if (!hasStart() && !(await ensureStart())) return;
    setStatus('Liczę trasę…');
    if (routeController) routeController.abort();
    routeController = new AbortController();
    try {
      const r = await fetchRoute({ lat: settings.startLat, lon: settings.startLon }, place, routeController.signal);
      if (current.dest !== place) return;
      current.route = r;
      setStatus('');
      renderResult();
    } catch (e) {
      if (e.name === 'AbortError') return;
      setStatus(e.message, 'err');
    }
  }

  /* ---------- Ręczne km ---------- */
  els.manualToggle.addEventListener('click', () => {
    els.manualBox.hidden = !els.manualBox.hidden;
    if (!els.manualBox.hidden) els.manualKm.focus();
  });
  function applyManual() {
    const km = parseNum(els.manualKm.value);
    if (!(km > 0) || km > 500) { setStatus('Wpisz poprawną liczbę km (np. 6,5).', 'err'); return; }
    current.route = null;
    current.manualKm = km;
    setStatus('');
    renderResult();
  }
  els.manualApply.addEventListener('click', applyManual);
  els.manualKm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyManual(); } });

  /* ---------- Wynik ---------- */
  function currentCalc() {
    if (current.route) return Object.assign({ manual: false }, current.route);
    if (current.manualKm != null) {
      const km = current.manualKm;
      return { kmOne: km, kmBack: km, kmTotal: km * 2, secOne: null, secBack: null, geometry: [], manual: true };
    }
    return null;
  }

  function fuelBasisText() {
    const preset = FUEL_PRESETS[settings.fuelType];
    return `${preset ? preset.label : settings.fuelType} · ${nf2.format(settings.fuelPrice)} zł/l · ${nf1.format(settings.consumption)} l/100 km · koszt orientacyjny`;
  }

  function renderResult() {
    const c = currentCalc();
    els.result.hidden = !c;
    if (!c) { els.map.hidden = true; return; }
    els.pickedLabel.textContent = current.dest ? current.dest.label : (els.addr.value.trim() || 'Adres wpisany ręcznie');
    els.kmOne.textContent = fmtKm(c.kmOne);
    els.kmBoth.textContent = fmtKm(c.kmTotal);
    els.minOne.textContent = c.manual ? 'km wpisane ręcznie' : fmtMin(c.secOne);
    const backNote = !c.manual && Math.abs(c.kmBack - c.kmOne) >= 0.1 ? ` · powrót ${fmtKm(c.kmBack)}` : '';
    els.minBoth.textContent = c.manual ? 'tam i z powrotem' : fmtMin(c.secOne + c.secBack) + backNote;
    els.costBoth.textContent = fmtMoney(fuelCost(c.kmTotal, settings.consumption, settings.fuelPrice));
    els.costOne.textContent = fmtMoney(fuelCost(c.kmOne, settings.consumption, settings.fuelPrice));
    els.costBasis.textContent = fuelBasisText();
    drawMap(c);
  }

  let map = null, routeLayer = null;
  function drawMap(c) {
    const box = els.map;
    if (!settings.showMap || !window.L || c.manual || !c.geometry.length || !current.dest || activeView !== 'new') {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    try {
      if (!map) {
        map = L.map(box, { zoomControl: false, attributionControl: true });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© <a href="https://account.heigit.org">openrouteservice by HeiGIT</a> | Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        map.attributionControl.setPrefix(false);
      }
      if (routeLayer) routeLayer.remove();
      const latlngs = c.geometry.map(([lon, lat]) => [lat, lon]);
      routeLayer = L.layerGroup([
        L.polyline(latlngs, { color: '#00c8ff', weight: 5, opacity: 0.9 }),
        L.circleMarker([settings.startLat, settings.startLon], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#ff2bd6', fillOpacity: 1 }).bindTooltip('HAYP'),
        L.circleMarker([current.dest.lat, current.dest.lon], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#ffe600', fillOpacity: 1 }).bindTooltip('Klient'),
      ]).addTo(map);
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 16 });
      });
    } catch {
      box.hidden = true;
    }
  }

  /* ---------- Zapis dostawy ---------- */
  function markInvalid(el, bad) { el.classList.toggle('invalid', !!bad); }

  els.form.addEventListener('submit', e => {
    e.preventDefault();
    const c = currentCalc();
    const name = els.fName.value.trim();
    const phone = normalizePhone(els.fPhone.value);
    const orderNo = els.fOrder.value.trim().replace(/^#/, '');
    const comment = els.fComment.value.trim();
    const address = current.dest ? current.dest.label : els.addr.value.trim();
    const errors = [];
    if (!address) errors.push('Wpisz adres dostawy.');
    else if (!c) errors.push('Wybierz adres z listy, żeby policzyć trasę (albo wpisz km ręcznie).');
    if (!name) errors.push('Wpisz imię i nazwisko.');
    if (!phone) errors.push('Wpisz poprawny numer telefonu.');
    if (!orderNo) errors.push('Wpisz numer zamówienia.');
    markInvalid(els.addr, !address || !c);
    markInvalid(els.fName, !name);
    markInvalid(els.fPhone, !phone);
    markInvalid(els.fOrder, !orderNo);
    if (errors.length) {
      els.formError.textContent = errors.join('\n');
      els.formError.hidden = false;
      return;
    }
    els.formError.hidden = true;

    const dup = deliveries.find(d => d.orderNo === orderNo && Date.now() - Date.parse(d.createdAt) < DAY_MS);
    if (dup && !confirm(`Zamówienie #${orderNo} jest już zapisane (${fmtTime(dup.createdAt)}). Zapisać jeszcze raz?`)) return;

    const d = {
      id: uid(),
      createdAt: new Date().toISOString(),
      address,
      lat: current.dest ? current.dest.lat : null,
      lon: current.dest ? current.dest.lon : null,
      kmOne: round2(c.kmOne),
      kmBack: round2(c.kmBack),
      kmTotal: round2(c.kmTotal),
      secOne: c.secOne,
      secTotal: c.secOne != null ? c.secOne + c.secBack : null,
      manualKm: c.manual,
      fuelType: settings.fuelType,
      fuelPrice: settings.fuelPrice,
      consumption: settings.consumption,
      costOne: round2(fuelCost(c.kmOne, settings.consumption, settings.fuelPrice)),
      costTotal: round2(fuelCost(c.kmTotal, settings.consumption, settings.fuelPrice)),
      name,
      phone,
      orderNo,
      comment,
      done: false,
    };
    deliveries.unshift(d);
    persistDeliveries();
    resetForm();
    toast('Zapisano dostawę');
    openDetail(d.id);
  });

  function resetForm() {
    els.form.reset();
    els.addr.value = '';
    els.manualKm.value = '';
    els.manualBox.hidden = true;
    els.formError.hidden = true;
    [els.addr, els.fName, els.fPhone, els.fOrder].forEach(el => el.classList.remove('invalid'));
    hideSuggestions();
    setStatus('');
    current = { dest: null, route: null, manualKm: null };
    renderResult();
  }
  els.clearForm.addEventListener('click', resetForm);

  /* ---------- Szczegóły / wysyłka ---------- */
  function navUrl(d) {
    const dest = d.lat != null && d.lon != null ? `${d.lat},${d.lon}` : encodeURIComponent(d.address);
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  }

  function shareText(d) {
    const lines = [
      `HAYP – dostawa #${d.orderNo}`,
      `Klient: ${d.name}`,
      `Tel: ${displayPhone(d.phone)}`,
      `Adres: ${d.address}`,
      `Trasa: ${fmtKm(d.kmOne)} (tam i z powrotem ${fmtKm(d.kmTotal)})`,
    ];
    if (d.comment) lines.push(`Uwagi: ${d.comment}`);
    lines.push(`Nawigacja: ${navUrl(d)}`);
    return lines.join('\n');
  }

  let detailId = null;
  function openDetail(id) {
    const d = deliveries.find(x => x.id === id);
    if (!d) return;
    detailId = id;
    els.dTitle.textContent = `Zamówienie #${d.orderNo}`;
    const rows = [
      ['Klient', d.name],
      ['Telefon', displayPhone(d.phone)],
      ['Adres', d.address],
      ['Trasa', `${fmtKm(d.kmOne)} w jedną · ${fmtKm(d.kmTotal)} w obie${d.manualKm ? ' (ręcznie)' : ''}`],
      ['Paliwo', `${fmtMoney(d.costTotal)} w obie strony`],
      ['Komentarz', d.comment || '–'],
      ['Zapisano', fmtDateTime(d.createdAt)],
    ];
    els.dBody.innerHTML = '';
    rows.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      els.dBody.append(dt, dd);
    });
    const text = shareText(d);
    els.dSms.href = 'sms:?body=' + encodeURIComponent(text);
    els.dWa.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    els.dNav.href = navUrl(d);
    els.dCall.href = telHref(d.phone);
    els.dDone.textContent = d.done ? 'Cofnij „dostarczone”' : 'Oznacz jako dostarczone';
    if (!els.detail.open) {
      if (typeof els.detail.showModal === 'function') els.detail.showModal();
      else els.detail.setAttribute('open', '');
    }
  }
  function closeDetail() {
    detailId = null;
    if (typeof els.detail.close === 'function') els.detail.close();
    else els.detail.removeAttribute('open');
  }
  els.dClose.addEventListener('click', closeDetail);
  els.detail.addEventListener('click', e => { if (e.target === els.detail) closeDetail(); });
  els.detail.addEventListener('close', () => { detailId = null; if (activeView === 'history') renderHistory(); });

  els.dShare.addEventListener('click', async () => {
    const d = deliveries.find(x => x.id === detailId);
    if (!d) return;
    const text = shareText(d);
    if (navigator.share) {
      try { await navigator.share({ title: `HAYP – dostawa #${d.orderNo}`, text }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Skopiowano – wklej kierowcy.'); }
    catch { window.prompt('Skopiuj tekst:', text); }
  });

  els.dDone.addEventListener('click', () => {
    const d = deliveries.find(x => x.id === detailId);
    if (!d) return;
    d.done = !d.done;
    d.doneAt = d.done ? new Date().toISOString() : null;
    persistDeliveries();
    toast(d.done ? 'Oznaczono jako dostarczone' : 'Cofnięto oznaczenie');
    closeDetail();
  });

  els.dDelete.addEventListener('click', () => {
    const d = deliveries.find(x => x.id === detailId);
    if (!d || !confirm(`Usunąć dostawę #${d.orderNo}?`)) return;
    deliveries = deliveries.filter(x => x.id !== d.id);
    persistDeliveries();
    toast('Usunięto');
    closeDetail();
  });

  /* ---------- Historia ---------- */
  let range = 'today';
  function startOfDay(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); }
  function inRange(d, r) {
    const t = new Date(d.createdAt);
    const today = startOfDay(new Date());
    if (r === 'today') return t >= today;
    if (r === 'yesterday') { const y = new Date(today); y.setDate(y.getDate() - 1); return t >= y && t < today; }
    if (r === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); return t >= s; }
    return true;
  }
  const filtered = () => deliveries.filter(d => inRange(d, range)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function renderHistory() {
    purgeOld();
    const list = filtered();
    els.sumCount.textContent = String(list.length);
    els.sumKm.textContent = nf1.format(list.reduce((s, d) => s + (d.kmTotal || 0), 0));
    els.sumCost.textContent = fmtMoney(list.reduce((s, d) => s + (d.costTotal || 0), 0));
    els.historyList.innerHTML = '';
    els.historyEmpty.hidden = list.length > 0;
    let lastDay = '';
    list.forEach(d => {
      const day = new Date(d.createdAt).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
      if (day !== lastDay) {
        const h = document.createElement('li');
        h.className = 'day-head';
        h.textContent = day;
        els.historyList.appendChild(h);
        lastDay = day;
      }
      const li = document.createElement('li');
      li.className = 'h-item' + (d.done ? ' done' : '');
      li.tabIndex = 0;
      const top = document.createElement('div');
      top.className = 'h-top';
      top.textContent = `${fmtTime(d.createdAt)} · #${d.orderNo} · ${d.name}`;
      if (d.done) {
        const b = document.createElement('span');
        b.className = 'badge done';
        b.textContent = 'Dostarczone';
        top.appendChild(b);
      }
      const addr = document.createElement('div');
      addr.className = 'h-addr';
      addr.textContent = d.address;
      const right = document.createElement('div');
      right.className = 'h-right';
      const km = document.createElement('span'); km.className = 'h-km'; km.textContent = fmtKm(d.kmTotal);
      const cost = document.createElement('span'); cost.className = 'h-cost'; cost.textContent = fmtMoney(d.costTotal);
      right.append(km, cost);
      li.append(top, right, addr);
      li.addEventListener('click', () => openDetail(d.id));
      li.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(d.id); });
      els.historyList.appendChild(li);
    });
  }

  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    range = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach(x => x.classList.toggle('active', x === b));
    renderHistory();
  }));

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // ochrona przed formułami w Excelu
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Polskie numery bez +48, żeby Excel nie traktował ich jak formuły/liczby
  const csvPhone = p => (/^\+48\d{9}$/.test(p) ? displayPhone(p.slice(3)) : displayPhone(p));
  const dec = n => (n == null || Number.isNaN(n) ? '' : Number(n).toFixed(2).replace('.', ','));

  els.exportCsv.addEventListener('click', () => {
    const list = filtered();
    if (!list.length) { toast('Brak dostaw do eksportu.'); return; }
    const header = ['Data', 'Godzina', 'Nr zamówienia', 'Klient', 'Telefon', 'Adres', 'Km w jedną', 'Km w obie', 'Koszt paliwa (zł)', 'Paliwo', 'Cena (zł/l)', 'Spalanie (l/100 km)', 'Km ręcznie', 'Dostarczone', 'Komentarz'];
    const rows = list.map(d => [
      new Date(d.createdAt).toLocaleDateString('pl-PL'), fmtTime(d.createdAt), d.orderNo, d.name, csvPhone(d.phone), d.address,
      dec(d.kmOne), dec(d.kmTotal), dec(d.costTotal), d.fuelType, dec(d.fuelPrice), dec(d.consumption),
      d.manualKm ? 'tak' : 'nie', d.done ? 'tak' : 'nie', d.comment,
    ]);
    const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hayp-dostawy-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  /* ---------- Ustawienia ---------- */
  let pendingStart; // undefined = bez zmian, null = do ustalenia, {lat,lon,label} = nowe
  let pendingFuel = settings.fuelType;

  function coordsText(lat, lon, label) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Punkt startu: jeszcze nieustalony (ustali się przy pierwszej trasie).';
    return `Punkt startu: ${label ? label + ' · ' : ''}${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  function setSettingsMsg(msg, kind = '') {
    els.sMsg.textContent = msg || '';
    els.sMsg.className = 'status' + (kind ? ' ' + kind : '');
  }

  function markFuel(type) {
    pendingFuel = type;
    els.sFuel.querySelectorAll('[data-fuel]').forEach(b => b.classList.toggle('active', b.dataset.fuel === type));
  }

  function fillSettings() {
    pendingStart = undefined;
    els.sKey.value = settings.apiKey;
    els.sStart.value = settings.startAddress;
    els.sStartCoords.textContent = coordsText(settings.startLat, settings.startLon);
    markFuel(settings.fuelType);
    els.sPrice.value = toInput(settings.fuelPrice);
    els.sCons.value = toInput(settings.consumption);
    els.sMap.checked = !!settings.showMap;
    els.sRetention.value = String(settings.retentionDays);
    setSettingsMsg('');
  }

  els.sFuel.querySelectorAll('[data-fuel]').forEach(b => b.addEventListener('click', () => {
    const p = FUEL_PRESETS[b.dataset.fuel];
    markFuel(b.dataset.fuel);
    els.sPrice.value = toInput(p.price);
    els.sCons.value = toInput(p.consumption);
  }));

  els.sKeyShow.addEventListener('click', () => {
    const show = els.sKey.type === 'password';
    els.sKey.type = show ? 'text' : 'password';
    els.sKeyShow.textContent = show ? 'Ukryj' : 'Pokaż';
  });

  els.sStart.addEventListener('input', () => {
    pendingStart = null;
    els.sStartCoords.textContent = 'Punkt startu: zostanie ustalony po zapisaniu.';
  });

  els.sStartFind.addEventListener('click', async () => {
    const key = els.sKey.value.trim();
    const text = els.sStart.value.trim();
    if (!key) { setSettingsMsg('Najpierw wklej klucz API.', 'err'); return; }
    if (!text) { setSettingsMsg('Wpisz adres startowy.', 'err'); return; }
    setSettingsMsg('Szukam adresu startowego…');
    try {
      const res = await geocodeSearch(text, undefined, 1, key);
      if (!res.length) { setSettingsMsg('Nie znalazłem tego adresu.', 'err'); return; }
      pendingStart = { lat: res[0].lat, lon: res[0].lon };
      els.sStartCoords.textContent = coordsText(res[0].lat, res[0].lon, res[0].label);
      setSettingsMsg('Klucz działa, adres znaleziony. Zapisz ustawienia.', 'ok');
    } catch (e) {
      setSettingsMsg(e.message, 'err');
    }
  });

  els.sStartGps.addEventListener('click', () => {
    if (!navigator.geolocation) { setSettingsMsg('Ten telefon nie udostępnia GPS w przeglądarce.', 'err'); return; }
    setSettingsMsg('Pobieram pozycję GPS… (stój w restauracji)');
    navigator.geolocation.getCurrentPosition(pos => {
      pendingStart = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      els.sStartCoords.textContent = coordsText(pendingStart.lat, pendingStart.lon, `GPS ±${Math.round(pos.coords.accuracy)} m`);
      setSettingsMsg('Pozycja pobrana. Zapisz ustawienia.', 'ok');
    }, err => {
      setSettingsMsg(err.code === 1 ? 'Brak zgody na lokalizację.' : 'Nie udało się pobrać pozycji GPS.', 'err');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  els.sForm.addEventListener('submit', async e => {
    e.preventDefault();
    const price = parseNum(els.sPrice.value);
    const cons = parseNum(els.sCons.value);
    const start = els.sStart.value.trim();
    if (!(price > 0) || price > 50) { setSettingsMsg('Wpisz poprawną cenę paliwa (zł/l).', 'err'); return; }
    if (!(cons > 0) || cons > 40) { setSettingsMsg('Wpisz poprawne spalanie (l/100 km).', 'err'); return; }
    if (!start) { setSettingsMsg('Wpisz adres startowy.', 'err'); return; }
    const keyChanged = els.sKey.value.trim() !== settings.apiKey;
    settings.apiKey = els.sKey.value.trim();
    settings.startAddress = start;
    if (pendingStart === null) { settings.startLat = null; settings.startLon = null; }
    else if (pendingStart) { settings.startLat = pendingStart.lat; settings.startLon = pendingStart.lon; }
    settings.fuelType = pendingFuel;
    settings.fuelPrice = round2(price);
    settings.consumption = Math.round(cons * 10) / 10;
    settings.showMap = els.sMap.checked;
    settings.retentionDays = Number(els.sRetention.value) || 30;
    persistSettings();
    purgeOld();
    if (keyChanged) acCache.clear();
    pendingStart = undefined;
    updateSetupWarning();
    renderResult();
    setSettingsMsg('Zapisano.', 'ok');
    if (settings.apiKey && !hasStart()) {
      const ok = await ensureStart();
      els.sStartCoords.textContent = coordsText(settings.startLat, settings.startLon);
      setSettingsMsg(ok ? 'Zapisano. Punkt startu ustalony.' : 'Zapisano, ale nie udało się ustalić punktu startu – sprawdź klucz i adres.', ok ? 'ok' : 'err');
    }
  });

  els.sWipe.addEventListener('click', () => {
    if (!deliveries.length) { toast('Historia jest pusta.'); return; }
    if (!confirm(`Usunąć wszystkie dostawy (${deliveries.length})? Tego nie da się cofnąć.`)) return;
    deliveries = [];
    persistDeliveries();
    toast('Historia usunięta');
  });

  /* ---------- Instalacja PWA ---------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignoruj */ }
    deferredPrompt = null;
    els.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { els.installBtn.hidden = true; });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ---------- Start ---------- */
  els.appVersion.textContent = `HAYP Dostawy v${APP_VERSION}`;
  purgeOld();
  updateSetupWarning();
  if (!window.L) els.map.hidden = true;

  // Do testów automatycznych
  window.__HAYP = { fuelCost, parseRoute, normalizePhone, displayPhone, csvCell, getSettings: () => settings, getDeliveries: () => deliveries };
})();
