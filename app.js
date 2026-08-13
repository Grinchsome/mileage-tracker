const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const STORAGE = 'mileageTrackerTestDriveV5';
const LEGACY_STORAGES = ['mileageTrackerTestDriveV4','mileageTrackerTestDriveV3','mileageTrackerTestDriveV2','mileageTrackerTestDriveV1'];
const defaults = {
  settings: {
    driver: '', vanReg: 'VN22 XBC', homeLocation: '', workLocation: 'Stage Electrics, Bristol',
    homeCoords: null, workCoords: null, mapsApiKey: '', currentOdo: 48236,
    monthStartOdo: null, monthEndOdo: null
  },
  journeys: [], active: null
};

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function loadState(){
  let raw = localStorage.getItem(STORAGE);
  if (!raw) {
    for (const key of LEGACY_STORAGES) {
      raw = localStorage.getItem(key);
      if (raw) break;
    }
  }
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
  const s = parsed || clone(defaults);
  s.settings = {...defaults.settings, ...(s.settings || {})};
  s.journeys = Array.isArray(s.journeys) ? s.journeys : [];
  s.active = s.active || null;
  return s;
}
let state = loadState();
let selectedType = 'Work', missedType = 'Work', deferredInstallPrompt = null;
let mapsLoadPromise = null, timerId = null;
let draftStartCoords = null, routeDraft = null;

const fmt = n => (Number(n) || 0).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const metersToMiles = m => Number(m) / 1609.344;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const save = () => { localStorage.setItem(STORAGE, JSON.stringify(state)); renderAll(); };
const currentMonthKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const monthJourneys = () => state.journeys.filter(j => (j.date || '').slice(0,7) === currentMonthKey());
const totals = () => monthJourneys().reduce((a,j)=>{const m=Number(j.miles)||0;a.all+=m;if(j.type==='Work')a.w+=m;else a.p+=m;return a;},{w:0,p:0,all:0});
const companyRows = () => monthJourneys().filter(j=>j.type==='Work').sort((a,b)=>new Date(a.date)-new Date(b.date));

function showScreen(id){
  $$('.screen').forEach(s=>s.classList.toggle('active',s.id===id));
  $$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.screen===id));
  if(id==='active') renderActive();
  if(id==='history') renderHistory();
  if(id==='monthly') renderMonthly();
  window.scrollTo(0,0);
}

function renderAll(){
  const t=totals();
  $('#vanRegHome').textContent=state.settings.vanReg||'—';
  $('#driverHome').textContent=state.settings.driver||'Driver';
  $('#odoHome').textContent=Number(state.settings.currentOdo||0).toLocaleString();
  $('#workTotal').textContent=fmt(t.w); $('#personalTotal').textContent=fmt(t.p); $('#allTotal').textContent=fmt(t.all);
  $('#monthLabel').textContent=new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'});
  $('#activeResume').classList.toggle('hidden',!state.active);
  renderHistory(); renderMonthly();
}

function renderHistory(){
  const list=$('#historyList');
  const rows=[...state.journeys].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!rows.length){list.innerHTML='<div class="center subtle">No journeys recorded yet.</div>';return;}
  list.innerHTML=rows.map(j=>`<div class="journey"><div class="row space"><div><div class="journey-title">${esc(j.from)} → ${esc(j.to)}</div><div class="journey-meta">${new Date(j.date).toLocaleString()} · ${j.routeSource==='google'?'Google route':j.routeSource==='manual'?'Manual route':'Recorded'}${j.purpose?' · '+esc(j.purpose):''}${j.adjustmentReason?' · '+esc(j.adjustmentReason):''}${Number(j.mileageAdjustment)?` · ${Number(j.mileageAdjustment)>0?'+':''}${Number(j.mileageAdjustment).toFixed(1)} mi vs planned`:''}</div></div><div class="miles">${Number(j.miles).toFixed(1)} mi</div></div><div class="top-gap-small"><span class="tag ${j.type==='Work'?'work':'personal'}">${esc(j.type.toUpperCase())}</span></div></div>`).join('');
}

function renderMonthly(){
  const t=totals(), s=state.settings.monthStartOdo, e=state.settings.monthEndOdo;
  $('#monthStartOdo').textContent=s??'—'; $('#monthEndOdo').textContent=e??'—';
  $('#monthWork').textContent=fmt(t.w); $('#monthPersonal').textContent=fmt(t.p); $('#monthTotal').textContent=fmt(t.all);
  const box=$('#reconcileBox');
  if(s!==null&&s!==''&&e!==null&&e!==''){
    const odo=Number(e)-Number(s), diff=round2(odo-t.all);
    box.className='notice top-gap '+(Math.abs(diff)<0.11?'ok':'warn');
    box.innerHTML=`Van travelled <strong>${fmt(odo)}</strong> miles. Recorded <strong>${fmt(t.all)}</strong>. ${Math.abs(diff)<0.11?'Mileage reconciles ✓':`Difference: <strong>${fmt(diff)}</strong> miles.`}`;
  } else {box.className='notice top-gap';box.textContent='Enter monthly start/end odometer in Settings to reconcile mileage.';}
}

function setChoice(type){
  selectedType=type;
  $$('.choice').forEach(b=>b.classList.toggle('selected',b.dataset.type===type));
  $('#purposeField').classList.toggle('hidden',type!=='Work');
}

function clearNewJourney(){
  $('#fromInput').value=''; $('#destInput').value=''; $('#purposeInput').value='';
  $('#startOdoInput').value=state.settings.currentOdo||''; $('#fromStatus').textContent='';
  draftStartCoords=null; routeDraft=null; renderRouteDraft(); setChoice('Work');
}

function renderRouteDraft(){
  if(!routeDraft){
    $('#routeMilesText').textContent='Not calculated'; $('#routeStatusTag').textContent='ROUTE'; $('#routeStatusTag').className='tag neutral';
    $('#routeMessage').textContent='Calculate the route before opening Google Maps. You can still adjust the mileage when you finish.'; return;
  }
  $('#routeMilesText').textContent=`${Number(routeDraft.miles).toFixed(1)} miles`;
  $('#routeStatusTag').textContent=routeDraft.source==='google'?'GOOGLE':'MANUAL';
  $('#routeStatusTag').className='tag '+(routeDraft.source==='google'?'ok-tag':'neutral');
  $('#routeMessage').textContent=routeDraft.durationText ? `Estimated driving time: ${routeDraft.durationText}. Mileage can be adjusted when you finish.` : 'Mileage can be adjusted when you finish.';
}

function nearestSavedLabel(coords){
  if(!coords) return null;
  const candidates=[['Home',state.settings.homeCoords,state.settings.homeLocation],['Work',state.settings.workCoords,state.settings.workLocation]];
  for(const [label,c,addr] of candidates){
    if(!c) continue;
    if(distanceMeters(coords,c) <= 120) return {label,address:addr};
  }
  return null;
}
function distanceMeters(a,b){
  const R=6371000, toRad=x=>x*Math.PI/180;
  const p1=toRad(a.lat), p2=toRad(b.lat), dp=toRad(b.lat-a.lat), dl=toRad(b.lng-a.lng);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function loadGoogleMaps(){
  const key=(state.settings.mapsApiKey||'').trim();
  if(!key) return Promise.reject(new Error('No Google Maps API key saved. Open Settings and add one, or enter route mileage manually.'));
  if(window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if(mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise=new Promise((resolve,reject)=>{
    const cb='__mileageMapsReady';
    window[cb]=()=>{delete window[cb];resolve(window.google.maps);};
    const script=document.createElement('script');
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=${cb}`;
    script.async=true; script.defer=true;
    script.onerror=()=>{mapsLoadPromise=null;reject(new Error('Google Maps could not load. Check the API key and its website restrictions.'));};
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
}

async function reverseGeocode(coords){
  await loadGoogleMaps();
  const {Geocoder}=await google.maps.importLibrary('geocoding');
  const geocoder=new Geocoder();
  const result=await geocoder.geocode({location:coords});
  const best=(result.results||[])[0];
  return best?.formatted_address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
}

async function geocodeAddress(address){
  if(!address?.trim()) return null;
  await loadGoogleMaps();
  const {Geocoder}=await google.maps.importLibrary('geocoding');
  const geocoder=new Geocoder();
  const result=await geocoder.geocode({address:address.trim()});
  const loc=result.results?.[0]?.geometry?.location;
  if(!loc) return null;
  return {lat:loc.lat(),lng:loc.lng()};
}

async function calculateGoogleRoute(){
  const from=$('#fromInput').value.trim(), to=$('#destInput').value.trim();
  if(!from||!to) throw new Error('Please enter both the start and destination first.');
  await loadGoogleMaps();
  const {Route}=await google.maps.importLibrary('routes');
  const origin=draftStartCoords || from;
  const request={origin,destination:to,travelMode:'DRIVING',routingPreference:'TRAFFIC_AWARE_OPTIMAL',fields:['distanceMeters','durationMillis','localizedValues']};
  const {routes}=await Route.computeRoutes(request);
  if(!routes?.length) throw new Error('Google could not find a driving route between those locations.');
  const route=routes[0];
  let meters=Number(route.distanceMeters)||0;
  if(!meters && route.legs?.length) meters=route.legs.reduce((s,l)=>s+(Number(l.distanceMeters)||0),0);
  if(!meters) throw new Error('Google returned a route but no distance.');
  const durationText=route.localizedValues?.duration || (route.durationMillis ? `${Math.round(route.durationMillis/60000)} min` : '');
  return {miles:round2(metersToMiles(meters)),meters,durationText,source:'google',routingPreference:'TRAFFIC_AWARE_OPTIMAL',calculatedAt:new Date().toISOString()};
}

async function useCurrentLocation(){
  if(!navigator.geolocation){alert('Location is not available in this browser.');return;}
  const btn=$('#useLocationBtn'); const old=btn.textContent; btn.disabled=true; btn.textContent='Locating…'; $('#fromStatus').textContent='Getting your GPS position…';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const coords={lat:pos.coords.latitude,lng:pos.coords.longitude}; draftStartCoords=coords; routeDraft=null; renderRouteDraft();
    const saved=nearestSavedLabel(coords);
    if(saved){
      $('#fromInput').value=saved.address || saved.label;
      $('#fromStatus').textContent=`Recognised as ${saved.label} · GPS accuracy ±${Math.round(pos.coords.accuracy)} m`;
      btn.disabled=false;btn.textContent=old;return;
    }
    try{
      const address=await reverseGeocode(coords);
      $('#fromInput').value=address;
      $('#fromStatus').textContent=`Current address found · GPS accuracy ±${Math.round(pos.coords.accuracy)} m`;
    }catch(err){
      $('#fromInput').value=`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      $('#fromStatus').textContent='GPS position found. Add a Google API key in Settings to convert it to a street address.';
    }
    btn.disabled=false;btn.textContent=old;
  },err=>{
    btn.disabled=false;btn.textContent=old; $('#fromStatus').textContent='';
    alert('Could not get your current location. Check Chrome location permission for Mileage Tracker.');
  },{enableHighAccuracy:true,timeout:15000,maximumAge:15000});
}

function startJourney(){
  const from=$('#fromInput').value.trim(), to=$('#destInput').value.trim();
  if(!from||!to){alert('Please enter both the start and destination.');return;}
  if(!routeDraft){alert('Please calculate the route mileage or enter it manually before starting.');return;}
  state.active={
    id:String(Date.now()), date:new Date().toISOString(), from, to, type:selectedType,
    purpose:selectedType==='Work'?$('#purposeInput').value.trim():'', startOdo:$('#startOdoInput').value?Number($('#startOdoInput').value):null,
    startTime:new Date().toISOString(), startCoords:draftStartCoords, plannedMiles:Number(routeDraft.miles), routeMeters:routeDraft.meters||null,
    routeSource:routeDraft.source, routeDuration:routeDraft.durationText||'', routeCalculatedAt:routeDraft.calculatedAt||new Date().toISOString()
  };
  save(); renderActive(); showScreen('active'); openGoogleMaps(); startTimer();
}

function renderActive(){
  if(!state.active){showScreen('home');return;}
  const a=state.active;
  $('#activeFrom').textContent=a.from; $('#activeTo').textContent=a.to; $('#liveMiles').textContent=Number(a.plannedMiles||0).toFixed(2);
  $('#activeType').textContent=a.type.toUpperCase(); $('#activeType').className='tag '+(a.type==='Work'?'work':'personal'); startTimer();
}
function startTimer(){
  clearInterval(timerId); if(!state.active)return;
  const tick=()=>{const s=Math.max(0,Math.floor((Date.now()-new Date(state.active.startTime).getTime())/1000));$('#timer').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};tick();timerId=setInterval(tick,1000);
}
function openGoogleMaps(){
  if(!state.active)return;
  const origin=state.active.startCoords ? `${state.active.startCoords.lat},${state.active.startCoords.lng}` : state.active.from;
  const url=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(state.active.to)}&travelmode=driving&dir_action=navigate`;
  window.open(url,'_blank');
}

function updateFinishOdometerPreview(){
  if(!state.active)return;
  const miles=Number($('#finishMilesInput').value);
  const startOdo=Number.isFinite(Number(state.active.startOdo)) ? Number(state.active.startOdo) : Number(state.settings.currentOdo||0);
  const entered=$('#finishOdoInput').value.trim();
  if(entered){
    const endOdo=Number(entered);
    if(Number.isFinite(endOdo) && endOdo>=startOdo){
      const odoMiles=round2(endOdo-startOdo);
      $('#odoPreview').innerHTML=`Ending odometer gives <strong>${odoMiles.toFixed(1)} miles</strong>. <button class="inline-btn" id="useOdoMilesBtn">Use this as actual mileage</button>`;
      const btn=$('#useOdoMilesBtn'); if(btn) btn.onclick=()=>{$('#finishMilesInput').value=odoMiles.toFixed(2);updateFinishOdometerPreview();};
      return;
    }
  }
  const autoEnd=startOdo+(Number.isFinite(miles)?miles:0);
  $('#odoPreview').innerHTML=`If you do not enter the van reading, the app will automatically advance the odometer to <strong>${autoEnd.toFixed(1)}</strong>.`;
}

function finishJourney(){
  if(!state.active)return;
  const a=state.active;
  const planned=Number(a.plannedMiles||0);
  $('#finishSummary').innerHTML=`<div><strong>${esc(a.from)}</strong> → <strong>${esc(a.to)}</strong></div><div class="journey-meta">${a.type}${a.routeSource==='google'?' · Google traffic-aware route':' · manual route'}</div><div class="planned-actual"><div><span>PLANNED</span><strong>${planned.toFixed(1)} mi</strong></div><div><span>ACTUAL</span><strong id="actualPreviewMiles">${planned.toFixed(1)} mi</strong></div></div>`;
  $('#finishMilesInput').value=planned.toFixed(2);
  $('#finishOdoInput').value='';
  $('#adjustmentReasonInput').value='';
  $('#detourQuickBtn').classList.remove('selected-adjustment');
  $('#finishModal').classList.remove('hidden');
  updateFinishOdometerPreview();
}
function saveJourney(){
  if(!state.active)return;
  const miles=Number($('#finishMilesInput').value); if(!Number.isFinite(miles)||miles<0){alert('Please enter a valid actual mileage.');return;}
  const planned=Number(state.active.plannedMiles||0);
  const startOdo=Number.isFinite(Number(state.active.startOdo)) ? Number(state.active.startOdo) : Number(state.settings.currentOdo||0);
  const enteredEnd=$('#finishOdoInput').value.trim();
  const endOdo=enteredEnd ? Number(enteredEnd) : round2(startOdo+miles);
  if(!Number.isFinite(endOdo)||endOdo<startOdo){alert('Please check the ending odometer reading.');return;}
  const reason=$('#adjustmentReasonInput').value.trim();
  const j={...state.active,miles:round2(miles),plannedMiles:round2(planned),mileageAdjustment:round2(miles-planned),adjustmentReason:reason,endOdo:round2(endOdo),endTime:new Date().toISOString()};
  state.journeys.push(j);
  state.settings.currentOdo=round2(endOdo);
  state.active=null; clearInterval(timerId); $('#finishModal').classList.add('hidden'); save(); showScreen('home');
}

function download(filename,content,type){const b=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

$$('nav button').forEach(b=>b.onclick=()=>showScreen(b.dataset.screen));
$('#newJourneyBtn').onclick=()=>{clearNewJourney();showScreen('new')}; $('#cancelNewBtn').onclick=()=>showScreen('home'); $('#resumeBtn').onclick=()=>showScreen('active');
$$('.choice').forEach(b=>b.onclick=()=>setChoice(b.dataset.type));
$('#useLocationBtn').onclick=useCurrentLocation;
$('#fromHomeBtn').onclick=()=>{if(!state.settings.homeLocation)return alert('Set Default Home Location in Settings first.');$('#fromInput').value=state.settings.homeLocation;draftStartCoords=state.settings.homeCoords;$('#fromStatus').textContent='Using saved Home location.';routeDraft=null;renderRouteDraft()};
$('#fromWorkBtn').onclick=()=>{if(!state.settings.workLocation)return alert('Set Default Work Location in Settings first.');$('#fromInput').value=state.settings.workLocation;draftStartCoords=state.settings.workCoords;$('#fromStatus').textContent='Using saved Work location.';routeDraft=null;renderRouteDraft()};
$('#toHomeBtn').onclick=()=>{if(!state.settings.homeLocation)return alert('Set Default Home Location in Settings first.');$('#destInput').value=state.settings.homeLocation;routeDraft=null;renderRouteDraft()};
$('#toWorkBtn').onclick=()=>{if(!state.settings.workLocation)return alert('Set Default Work Location in Settings first.');$('#destInput').value=state.settings.workLocation;routeDraft=null;renderRouteDraft()};
$('#fromInput').addEventListener('input',()=>{draftStartCoords=null;routeDraft=null;renderRouteDraft();$('#fromStatus').textContent=''}); $('#destInput').addEventListener('input',()=>{routeDraft=null;renderRouteDraft()});
$('#calculateRouteBtn').onclick=async()=>{const b=$('#calculateRouteBtn'),old=b.textContent;b.disabled=true;b.textContent='CALCULATING…';try{routeDraft=await calculateGoogleRoute();renderRouteDraft()}catch(err){alert(err.message||'Could not calculate route.');}finally{b.disabled=false;b.textContent=old}};
$('#manualRouteBtn').onclick=()=>{$('#manualRouteMilesInput').value=routeDraft?.miles||'';$('#manualRouteModal').classList.remove('hidden')};
$('#closeManualRouteBtn').onclick=()=>$('#manualRouteModal').classList.add('hidden');
$('#saveManualRouteBtn').onclick=()=>{const m=Number($('#manualRouteMilesInput').value);if(!Number.isFinite(m)||m<=0)return alert('Please enter a valid mileage greater than zero.');routeDraft={miles:round2(m),source:'manual',calculatedAt:new Date().toISOString()};renderRouteDraft();$('#manualRouteModal').classList.add('hidden')};
$('#startBtn').onclick=startJourney; $('#openMapsBtn').onclick=openGoogleMaps; $('#finishBtn').onclick=finishJourney; $('#continueJourneyBtn').onclick=()=>$('#finishModal').classList.add('hidden'); $('#saveJourneyBtn').onclick=saveJourney;
$('#finishMilesInput').addEventListener('input',()=>{const v=Number($('#finishMilesInput').value);if(Number.isFinite(v))$('#actualPreviewMiles').textContent=`${v.toFixed(1)} mi`;updateFinishOdometerPreview();});
$('#finishOdoInput').addEventListener('input',updateFinishOdometerPreview);
$('#detourQuickBtn').onclick=()=>{const input=$('#adjustmentReasonInput');if(!input.value.trim())input.value='Detour / road closure';$('#detourQuickBtn').classList.add('selected-adjustment');input.focus();};
$('#usePlannedBtn').onclick=()=>{if(!state.active)return;$('#finishMilesInput').value=Number(state.active.plannedMiles||0).toFixed(2);$('#actualPreviewMiles').textContent=`${Number(state.active.plannedMiles||0).toFixed(1)} mi`;updateFinishOdometerPreview();};

$('#settingsBtn').onclick=()=>{
  const s=state.settings; $('#driverInput').value=s.driver||'';$('#vanRegInput').value=s.vanReg||'';$('#homeLocationInput').value=s.homeLocation||'';$('#workLocationInput').value=s.workLocation||'';$('#mapsApiKeyInput').value=s.mapsApiKey||'';$('#currentOdoInput').value=s.currentOdo??'';$('#monthStartInput').value=s.monthStartOdo??'';$('#monthEndInput').value=s.monthEndOdo??'';
  $('#mapsApiStatus').textContent=s.mapsApiKey?'Google features configured on this device.':'Google features not configured yet; manual mileage still works.'; $('#settingsModal').classList.remove('hidden');
};
$('#closeSettingsBtn').onclick=()=>$('#settingsModal').classList.add('hidden');
$('#saveSettingsBtn').onclick=async()=>{
  const oldKey=state.settings.mapsApiKey||'';
  state.settings.driver=$('#driverInput').value.trim(); state.settings.vanReg=$('#vanRegInput').value.trim().toUpperCase();
  state.settings.homeLocation=$('#homeLocationInput').value.trim(); state.settings.workLocation=$('#workLocationInput').value.trim();
  state.settings.mapsApiKey=$('#mapsApiKeyInput').value.trim(); state.settings.currentOdo=Number($('#currentOdoInput').value)||0;
  state.settings.monthStartOdo=$('#monthStartInput').value===''?null:Number($('#monthStartInput').value); state.settings.monthEndOdo=$('#monthEndInput').value===''?null:Number($('#monthEndInput').value);
  if(oldKey!==state.settings.mapsApiKey) mapsLoadPromise=null;
  save();
  if(state.settings.mapsApiKey){
    $('#mapsApiStatus').textContent='Saving locations…';
    try{
      state.settings.homeCoords=state.settings.homeLocation?await geocodeAddress(state.settings.homeLocation):null;
      state.settings.workCoords=state.settings.workLocation?await geocodeAddress(state.settings.workLocation):null;
      localStorage.setItem(STORAGE,JSON.stringify(state)); $('#mapsApiStatus').textContent='Google features ready. Home/Work coordinates saved for automatic recognition.';
    }catch(err){ $('#mapsApiStatus').textContent='Settings saved, but Google could not verify Home/Work locations. Check the API key/API restrictions.'; }
  }
  setTimeout(()=>$('#settingsModal').classList.add('hidden'),700); renderAll();
};
$('#resetBtn').onclick=()=>{
  if(!confirm('Clear all journey/test data on this device?\n\nYour driver, van, Home/Work locations, Google API key and current odometer will be kept. This cannot be undone.')) return;
  const kept={...state.settings};
  kept.monthStartOdo=Number.isFinite(Number(kept.currentOdo))?Number(kept.currentOdo):null;
  kept.monthEndOdo=null;
  state={settings:kept,journeys:[],active:null};
  LEGACY_STORAGES.forEach(k=>localStorage.removeItem(k));
  localStorage.setItem(STORAGE,JSON.stringify(state));
  renderAll();
  $('#settingsModal').classList.add('hidden');
  showScreen('home');
  setTimeout(()=>alert('Journey data cleared. Your settings and current odometer have been kept.'),100);
};

$('#addMissedBtn').onclick=()=>{$('#missedDate').value=new Date().toISOString().slice(0,10);$('#missedFrom').value='';$('#missedTo').value='';$('#missedPurpose').value='';$('#missedMiles').value='';missedType='Work';$$('.missedType').forEach(b=>b.classList.toggle('selected',b.dataset.type==='Work'));$('#missedModal').classList.remove('hidden')};
$$('.missedType').forEach(b=>b.onclick=()=>{missedType=b.dataset.type;$$('.missedType').forEach(x=>x.classList.toggle('selected',x===b))});
$('#closeMissedBtn').onclick=()=>$('#missedModal').classList.add('hidden');
$('#saveMissedBtn').onclick=()=>{const m=Number($('#missedMiles').value);if(!$('#missedDate').value||!$('#missedFrom').value.trim()||!$('#missedTo').value.trim()||!Number.isFinite(m)||m<0)return alert('Please complete Date, From, To and Distance.');const d=new Date($('#missedDate').value+'T12:00:00');state.journeys.push({id:String(Date.now()),date:d.toISOString(),from:$('#missedFrom').value.trim(),to:$('#missedTo').value.trim(),type:missedType,purpose:$('#missedPurpose').value.trim(),miles:round2(m),routeSource:'manual',startOdo:null,endOdo:null,startTime:null,endTime:null,startCoords:null});$('#missedModal').classList.add('hidden');save()};

$('#previewReturnBtn').onclick=()=>{const t=totals(),rows=companyRows();$('#returnTable').innerHTML=`<tr><th colspan="3">STAGE ELECTRICS VEHICLE MILEAGE RETURN</th></tr><tr><td>Employee</td><td colspan="2">${esc(state.settings.driver||'—')}</td></tr><tr><td>Register No</td><td colspan="2">${esc(state.settings.vanReg||'—')}</td></tr><tr><th>Date</th><th>Details of journey</th><th>Business miles</th></tr>${rows.map(r=>`<tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${esc(r.from)} → ${esc(r.to)}${r.purpose?' · '+esc(r.purpose):''}</td><td>${(+r.miles).toFixed(1)}</td></tr>`).join('')}<tr><td colspan="2"><strong>Total business</strong></td><td><strong>${t.w.toFixed(1)}</strong></td></tr><tr><td colspan="2"><strong>Private miles</strong></td><td><strong>${t.p.toFixed(1)}</strong></td></tr>`;$('#returnModal').classList.remove('hidden')};
$('#closeReturnBtn').onclick=()=>$('#returnModal').classList.add('hidden');
function setExportFeedback(button, workingText, successText, action){
  if(button.disabled) return;
  const original=button.textContent;
  button.disabled=true;
  button.classList.remove('download-success');
  button.textContent=workingText;
  Promise.resolve().then(action).then(()=>{
    button.textContent=successText;
    button.classList.add('download-success');
    setTimeout(()=>{button.textContent=original;button.classList.remove('download-success');button.disabled=false;},2200);
  }).catch(err=>{
    console.error(err);
    button.textContent='TRY AGAIN';
    setTimeout(()=>{button.textContent=original;button.disabled=false;},1800);
    alert(err.message||'The export could not be created.');
  });
}

$('#exportCsvBtn').onclick=()=>setExportFeedback($('#exportCsvBtn'),'PREPARING…','DOWNLOADED ✓',()=>{
  const rows=[['Date','From','To','Type','Purpose','Planned Miles','Actual Miles','Adjustment','Adjustment Reason','Route Source','Start Latitude','Start Longitude','Start Odometer','End Odometer'],...monthJourneys().map(j=>[new Date(j.date).toLocaleDateString(),j.from,j.to,j.type,j.purpose,j.plannedMiles??j.miles,j.miles,j.mileageAdjustment??0,j.adjustmentReason||'',j.routeSource||'',j.startCoords?.lat??'',j.startCoords?.lng??'',j.startOdo??'',j.endOdo??''])];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  download(`Mileage_${currentMonthKey()}.csv`,csv,'text/csv');
});

// --- Version 5: populate the exact company workbook template ---
function xmlEsc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function u16le(n){return [n&255,(n>>>8)&255];} function u32le(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
function makeZip(files){
  const enc=new TextEncoder(), chunks=[], central=[]; let offset=0;
  const add=arr=>{chunks.push(Uint8Array.from(arr));offset+=arr.length;};
  for(const f of files){const name=enc.encode(f.name),data=typeof f.data==='string'?enc.encode(f.data):f.data,crc=crc32(data),start=offset;
    add([...u32le(0x04034b50),...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(crc),...u32le(data.length),...u32le(data.length),...u16le(name.length),...u16le(0),...name]);chunks.push(data);offset+=data.length;central.push({name,data,crc,start});
  }
  const centralStart=offset;
  for(const f of central){add([...u32le(0x02014b50),...u16le(20),...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(f.crc),...u32le(f.data.length),...u32le(f.data.length),...u16le(f.name.length),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(0),...u32le(f.start),...f.name]);}
  const centralSize=offset-centralStart;add([...u32le(0x06054b50),...u16le(0),...u16le(0),...u16le(central.length),...u16le(central.length),...u32le(centralSize),...u32le(centralStart),...u16le(0)]);
  return new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function b64Bytes(s){const bin=atob(s),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}
function templateFiles(){
  if(!window.COMPANY_TEMPLATE_FILES) throw new Error('The company Excel template is missing from this version.');
  return Object.entries(window.COMPANY_TEMPLATE_FILES).map(([name,b64])=>({name,data:b64Bytes(b64)}));
}
function replaceCell(xml,ref,value,{formula=null,cached=null}={}){
  const re=new RegExp(`<c\\s+([^>]*\\br="${ref}"[^>]*?)(?:\\s*/>|>([\\s\\S]*?)<\\/c>)`);
  const m=xml.match(re); if(!m) throw new Error(`Template cell ${ref} was not found.`);
  const attrs=m[1].replace(/\\s+t="[^"]*"/g,'');
  let cell='';
  if(formula!==null){cell=`<c ${attrs}><f>${xmlEsc(formula)}</f><v>${Number.isFinite(Number(cached))?Number(cached):0}</v></c>`;}
  else if(value===null||value===undefined||value===''){cell=`<c ${attrs}/>`;}
  else if(typeof value==='number'&&Number.isFinite(value)){cell=`<c ${attrs}><v>${value}</v></c>`;}
  else {cell=`<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;}
  return xml.replace(re,cell);
}
function journeyDetail(j){return `${j.from} - ${j.to}${j.purpose?' - '+j.purpose:''}${j.adjustmentReason?' - '+j.adjustmentReason:''}`;}
function buildCompanyXlsx(){
  const work=companyRows();
  if(work.length>31) throw new Error(`This month has ${work.length} business journeys. The company form has 31 lines. Export the first 31 now; continuation-sheet support will be added if you need it.`);
  const dec=new TextDecoder(), enc=new TextEncoder();
  const files=templateFiles();
  const sheetFile=files.find(f=>f.name==='xl/worksheets/sheet1.xml');
  const wbFile=files.find(f=>f.name==='xl/workbook.xml');
  if(!sheetFile||!wbFile) throw new Error('The company workbook template is incomplete.');
  let xml=dec.decode(sheetFile.data);
  const now=new Date(); const monthLabel=now.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const startRaw=state.settings.monthStartOdo, endRaw=state.settings.monthEndOdo;
  const startOdo=(startRaw!==null&&startRaw!==''&&Number.isFinite(Number(startRaw)))?Number(startRaw):null;
  const endOdo=(endRaw!==null&&endRaw!==''&&Number.isFinite(Number(endRaw)))?Number(endRaw):(Number.isFinite(Number(state.settings.currentOdo))?Number(state.settings.currentOdo):null);
  const milesMonth=(startOdo!==null&&endOdo!==null)?round2(endOdo-startOdo):0;
  const businessTotal=round2(work.reduce((s,j)=>s+(Number(j.miles)||0),0));
  const privateTotal=Math.max(0,round2(milesMonth-businessTotal));
  xml=replaceCell(xml,'G2',monthLabel);
  xml=replaceCell(xml,'C4',state.settings.driver||'');
  xml=replaceCell(xml,'I4',startOdo===null?'':startOdo);
  xml=replaceCell(xml,'I5',endOdo===null?'':endOdo);
  xml=replaceCell(xml,'D6',state.settings.vanReg||'');
  xml=replaceCell(xml,'I6','',{formula:'I5-I4',cached:milesMonth});
  for(let i=0;i<31;i++){
    const r=12+i,j=work[i];
    if(j){
      const d=new Date(j.date); const date=`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      const so=Number.isFinite(Number(j.startOdo))?Number(j.startOdo):null, eo=Number.isFinite(Number(j.endOdo))?Number(j.endOdo):null;
      xml=replaceCell(xml,`B${r}`,date); xml=replaceCell(xml,`C${r}`,journeyDetail(j)); xml=replaceCell(xml,`H${r}`,so===null?'':so); xml=replaceCell(xml,`I${r}`,eo===null?'':eo);
      const miles=round2(Number(j.miles)||0); xml=replaceCell(xml,`J${r}`,'',{formula:`I${r}-H${r}`,cached:miles});
    }else{
      xml=replaceCell(xml,`B${r}`,''); xml=replaceCell(xml,`C${r}`,''); xml=replaceCell(xml,`H${r}`,''); xml=replaceCell(xml,`I${r}`,''); xml=replaceCell(xml,`J${r}`,'',{formula:`I${r}-H${r}`,cached:0});
    }
  }
  xml=replaceCell(xml,'J43','',{formula:'SUM(J12:J42)',cached:businessTotal});
  xml=replaceCell(xml,'J44','',{formula:'I6-J43',cached:privateTotal});
  sheetFile.data=enc.encode(xml);
  let wb=dec.decode(wbFile.data);
  wb=wb.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>');
  wbFile.data=enc.encode(wb);
  return makeZip(files);
}

$('#exportXlsBtn').onclick=()=>setExportFeedback($('#exportXlsBtn'),'PREPARING…','DOWNLOADED ✓',()=>{
  const blob=buildCompanyXlsx(),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`Stage_Electrics_Mileage_Return_${currentMonthKey()}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
});

window.addEventListener('beforeinstallprompt' ,e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').classList.remove('hidden');$('#installHint').classList.remove('hidden');$('#installHint').textContent='Mileage Tracker is ready to install on this device.'});
$('#installBtn').onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('#installBtn').classList.add('hidden');$('#installHint').classList.add('hidden')};
window.addEventListener('appinstalled',()=>{$('#installBtn').classList.add('hidden');$('#installHint').classList.add('hidden')});
$('#reloadBtn').onclick=()=>location.reload();
if('serviceWorker' in navigator){
  window.addEventListener('load',async()=>{
    try{
      const reg=await navigator.serviceWorker.register('./sw.js');
      if(reg.waiting) $('#updateHint').classList.remove('hidden');
      reg.addEventListener('updatefound',()=>{const nw=reg.installing;if(!nw)return;nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller)$('#updateHint').classList.remove('hidden')})});
    }catch(_){ }
  });
}

renderAll(); if(state.active){renderActive();}
