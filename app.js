const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const STORAGE = 'mileageTrackerTestDriveV4';
const LEGACY_STORAGES = ['mileageTrackerTestDriveV3','mileageTrackerTestDriveV2','mileageTrackerTestDriveV1'];
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
$('#resetBtn').onclick=()=>{if(confirm('Reset all Mileage Tracker test data on this device?')){state=clone(defaults);localStorage.removeItem(STORAGE);LEGACY_STORAGES.forEach(k=>localStorage.removeItem(k));save();$('#settingsModal').classList.add('hidden');showScreen('home')}};

$('#addMissedBtn').onclick=()=>{$('#missedDate').value=new Date().toISOString().slice(0,10);$('#missedFrom').value='';$('#missedTo').value='';$('#missedPurpose').value='';$('#missedMiles').value='';missedType='Work';$$('.missedType').forEach(b=>b.classList.toggle('selected',b.dataset.type==='Work'));$('#missedModal').classList.remove('hidden')};
$$('.missedType').forEach(b=>b.onclick=()=>{missedType=b.dataset.type;$$('.missedType').forEach(x=>x.classList.toggle('selected',x===b))});
$('#closeMissedBtn').onclick=()=>$('#missedModal').classList.add('hidden');
$('#saveMissedBtn').onclick=()=>{const m=Number($('#missedMiles').value);if(!$('#missedDate').value||!$('#missedFrom').value.trim()||!$('#missedTo').value.trim()||!Number.isFinite(m)||m<0)return alert('Please complete Date, From, To and Distance.');const d=new Date($('#missedDate').value+'T12:00:00');state.journeys.push({id:String(Date.now()),date:d.toISOString(),from:$('#missedFrom').value.trim(),to:$('#missedTo').value.trim(),type:missedType,purpose:$('#missedPurpose').value.trim(),miles:round2(m),routeSource:'manual',startOdo:null,endOdo:null,startTime:null,endTime:null,startCoords:null});$('#missedModal').classList.add('hidden');save()};

$('#previewReturnBtn').onclick=()=>{const t=totals(),rows=companyRows();$('#returnTable').innerHTML=`<tr><th colspan="3">STAGE ELECTRICS VEHICLE MILEAGE RETURN</th></tr><tr><td>Employee</td><td colspan="2">${esc(state.settings.driver||'—')}</td></tr><tr><td>Register No</td><td colspan="2">${esc(state.settings.vanReg||'—')}</td></tr><tr><th>Date</th><th>Details of journey</th><th>Business miles</th></tr>${rows.map(r=>`<tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${esc(r.from)} → ${esc(r.to)}${r.purpose?' · '+esc(r.purpose):''}</td><td>${(+r.miles).toFixed(1)}</td></tr>`).join('')}<tr><td colspan="2"><strong>Total business</strong></td><td><strong>${t.w.toFixed(1)}</strong></td></tr><tr><td colspan="2"><strong>Private miles</strong></td><td><strong>${t.p.toFixed(1)}</strong></td></tr>`;$('#returnModal').classList.remove('hidden')};
$('#closeReturnBtn').onclick=()=>$('#returnModal').classList.add('hidden');
$('#exportCsvBtn').onclick=()=>{const rows=[['Date','From','To','Type','Purpose','Planned Miles','Actual Miles','Adjustment','Adjustment Reason','Route Source','Start Latitude','Start Longitude','Start Odometer','End Odometer'],...monthJourneys().map(j=>[new Date(j.date).toLocaleDateString(),j.from,j.to,j.type,j.purpose,j.plannedMiles??j.miles,j.miles,j.mileageAdjustment??0,j.adjustmentReason||'',j.routeSource||'',j.startCoords?.lat??'',j.startCoords?.lng??'',j.startOdo??'',j.endOdo??''])],csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');download(`Mileage_${currentMonthKey()}.csv`,csv,'text/csv')};
// --- Version 4: native XLSX company mileage return ---
function xmlEsc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function excelCol(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function u16le(n){return [n&255,(n>>>8)&255];} function u32le(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
function makeZip(files){
  const enc=new TextEncoder(), chunks=[], central=[]; let offset=0;
  const add=arr=>{chunks.push(Uint8Array.from(arr));offset+=arr.length;};
  for(const f of files){const name=enc.encode(f.name),data=typeof f.data==='string'?enc.encode(f.data):f.data,crc=crc32(data),start=offset;
    add([...u32le(0x04034b50),...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(crc),...u32le(data.length),...u32le(data.length),...u16le(name.length),...u16le(0),...name]); chunks.push(data);offset+=data.length;
    central.push({name,data,crc,start});
  }
  const centralStart=offset;
  for(const f of central){add([...u32le(0x02014b50),...u16le(20),...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(f.crc),...u32le(f.data.length),...u32le(f.data.length),...u16le(f.name.length),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(0),...u32le(f.start),...f.name]);}
  const centralSize=offset-centralStart; add([...u32le(0x06054b50),...u16le(0),...u16le(0),...u16le(central.length),...u16le(central.length),...u32le(centralSize),...u32le(centralStart),...u16le(0)]);
  return new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function xlsxCell(ref,value,style=0,formula=null){
  if(formula!==null)return `<c r="${ref}" s="${style}"><f>${xmlEsc(formula)}</f><v>0</v></c>`;
  if(value===null||value===undefined||value==='')return `<c r="${ref}" s="${style}"/>`;
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEsc(value)}</t></is></c>`;
}
function companySheetXml(rows,monthLabel,startOdo,endOdo,isContinuation=false,offset=0){
  const c=[];
  const set=(ref,val,style=0,formula=null)=>c.push(xlsxCell(ref,val,style,formula));
  set('B2','VEHICLE MILEAGE RETURN FOR THE MONTH OF',4); set('G2',isContinuation?`${monthLabel} - CONTINUATION`:monthLabel,4);
  set('B4','NAME',3); set('C4',state.settings.driver||'',2); set('F4','       Mileage at start of month',3); set('I4',Number.isFinite(startOdo)?startOdo:'',5);
  set('F5','       Mileage at end of month',3); set('I5',Number.isFinite(endOdo)?endOdo:'',5); set('B6','VEHICLE REG',3); set('D6',state.settings.vanReg||'',2);
  set('G6','Miles in Month',3); set('I6','',5,'I5-I4'); set('C8',isContinuation?'RECORD OF BUSINESS MILEAGE - CONTINUATION':'RECORD OF BUSINESS MILEAGE',4);
  for(const [ref,val,st] of [['B10','DATE',3],['C10','JOURNEY DETAILS',3],['H10','START',3],['I10','END',3],['J10','MILES',3],['H11','MILES',3],['I11','MILES',3],['J11','DRIVEN',3]]) set(ref,val,st);
  rows.slice(0,31).forEach((j,i)=>{const r=12+i,d=new Date(j.date),date=`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const detail=`${j.from} → ${j.to}${j.purpose?' · '+j.purpose:''}${j.adjustmentReason?' · '+j.adjustmentReason:''}`;
    set(`B${r}`,date,7); set(`C${r}`,detail,8); set(`H${r}`,Number.isFinite(Number(j.startOdo))?Number(j.startOdo):'',5); set(`I${r}`,Number.isFinite(Number(j.endOdo))?Number(j.endOdo):'',5);
    // If odometer values exist, retain the company-style formula; otherwise write the recorded mileage.
    if(Number.isFinite(Number(j.startOdo))&&Number.isFinite(Number(j.endOdo))) set(`J${r}`,'',5,`I${r}-H${r}`); else set(`J${r}`,Number(j.miles)||0,5);
  });
  for(let r=12+Math.min(rows.length,31);r<=42;r++) set(`J${r}`,'',5,'0');
  set('F43','TOTAL BUSINESS MILES IN MONTH',3); set('J43','',6,'SUM(J12:J42)'); set('F44','TOTAL PRIVATE MILES IN MONTH',3);
  // On the first sheet private mileage is total van mileage less all business mileage across all sheets; continuation sheet shows only its business subtotal.
  if(!isContinuation) set('J44','',6,`MAX(0,I6-${rows._allBusinessCell||'J43'})`); else { set('J44','',6,'0'); }
  if(!isContinuation){set('C48','Driver Signature',3);set('C50','Authorised by:   ',3);set('I50','H.O.D.',3);set('C52','Signed off:',3);set('I52','Management Team',3);}
  const rowMap={}; for(const x of c){const m=x.match(/ r="[A-Z]+(\d+)"/); if(m)(rowMap[m[1]]??=[]).push(x);} 
  const rowsXml=Object.keys(rowMap).map(Number).sort((a,b)=>a-b).map(r=>`<row r="${r}"${r>=12&&r<=44?' ht="17.65" customHeight="1"':''}>${rowMap[r].join('')}</row>`).join('');
  const merges=['G2:I2','C4:E4','I4:J4','I5:J5','D6:E6','I6:J6','C8:G8',...Array.from({length:31},(_,i)=>`C${12+i}:G${12+i}`),...(!isContinuation?['E47:H48','E49:H50']:[])];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="11" topLeftCell="B12" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="13.5"/><cols><col min="1" max="1" width="3.6" customWidth="1"/><col min="2" max="2" width="10.1" customWidth="1"/><col min="3" max="6" width="11.5" customWidth="1"/><col min="7" max="7" width="5.4" customWidth="1"/><col min="8" max="8" width="13.4" customWidth="1"/><col min="9" max="9" width="12.7" customWidth="1"/><col min="10" max="10" width="12.2" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData><mergeCells count="${merges.length}">${merges.map(r=>`<mergeCell ref="${r}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></worksheet>`;
}
function buildCompanyXlsx(){
  const work=companyRows(); const now=new Date(), monthLabel=now.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const startRaw=state.settings.monthStartOdo, endRaw=state.settings.monthEndOdo;
  const startOdo=(startRaw!==null&&startRaw!==''&&Number.isFinite(Number(startRaw)))?Number(startRaw):null;
  const endOdo=(endRaw!==null&&endRaw!==''&&Number.isFinite(Number(endRaw)))?Number(endRaw):(Number.isFinite(Number(state.settings.currentOdo))?Number(state.settings.currentOdo):null);
  const chunks=[]; for(let i=0;i<work.length;i+=31) chunks.push(work.slice(i,i+31)); if(!chunks.length)chunks.push([]);
  // Total business across sheets: first sheet J43 + continuation J43 cells.
  let allBusiness='J43'; for(let i=1;i<chunks.length;i++) allBusiness+=`+'Continuation ${i}'!J43`;
  chunks[0]._allBusinessCell=allBusiness;
  const sheetNames=chunks.map((_,i)=>i===0?'Mileage Return':`Continuation ${i}`);
  const sheets=chunks.map((rows,i)=>companySheetXml(rows,monthLabel,startOdo,endOdo,i>0,i*31));
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${sheetNames.map((n,i)=>`<sheet name="${xmlEsc(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font><font><sz val="9"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Stage Electrics Vehicle Mileage Return</dc:title><dc:creator>Mileage Tracker V4</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;
  const props=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Mileage Tracker V4</Application></Properties>`;
  const files=[{name:'[Content_Types].xml',data:contentTypes},{name:'_rels/.rels',data:rootRels},{name:'xl/workbook.xml',data:workbook},{name:'xl/_rels/workbook.xml.rels',data:wbRels},{name:'xl/styles.xml',data:styles},{name:'docProps/core.xml',data:core},{name:'docProps/app.xml',data:props},...sheets.map((x,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,data:x}))];
  return makeZip(files);
}
$('#exportXlsBtn').onclick=()=>{try{const blob=buildCompanyXlsx(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Stage_Electrics_Mileage_Return_${currentMonthKey()}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}catch(err){console.error(err);alert('Could not create the company Excel workbook: '+(err.message||err));}};

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
