const BITGET='https://api.bitget.com/api/v3/market';
const STORE_KEY='ripplemap-investigations-v2';
const SESSION_KEY='ripplemap-session-id';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:6});
const pct=value=>(Number(value)*100).toFixed(2)+'%';
const uuid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;

let instruments=[];
let currentRecord=null;
let records=loadLocal();
let cloud=null;
let user=null;

function loadLocal(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'[]')}catch{return[]}}
function persistLocal(){localStorage.setItem(STORE_KEY,JSON.stringify(records));updateSavedCount()}
function updateSavedCount(){$('#savedCount').textContent=records.length}
function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600)}
function showError(message){$('#error').textContent=message;$('#error').style.display='block'}
function clearError(){$('#error').style.display='none'}
function sessionId(){let id=localStorage.getItem(SESSION_KEY);if(!id){id=uuid();localStorage.setItem(SESSION_KEY,id)}return id}
function safeJson(value,fallback){try{return JSON.parse(value)}catch{return fallback}}

function track(name,properties={}){
  const event={event_name:name,anonymous_session_id:sessionId(),properties,created_at:new Date().toISOString()};
  const queue=safeJson(localStorage.getItem('ripplemap-analytics')||'[]',[]);queue.push(event);localStorage.setItem('ripplemap-analytics',JSON.stringify(queue.slice(-100)));
  if(cloud)cloud.from('ripplemap_events').insert({...event,user_id:user?.id||null}).then(()=>{});
}

window.addEventListener('error',event=>track('client_error',{message:String(event.message||'Unknown client error').slice(0,300)}));
window.addEventListener('unhandledrejection',event=>track('client_error',{message:String(event.reason?.message||event.reason||'Unhandled rejection').slice(0,300)}));

async function initCloud(){
  try{
    const response=await fetch('/api/config');
    if(!response.ok)return;
    const config=await response.json();
    if(!config.supabaseUrl||!config.supabaseKey||!window.supabase)return;
    cloud=window.supabase.createClient(config.supabaseUrl,config.supabaseKey);
    const {data}=await cloud.auth.getSession();await applySession(data.session);
    cloud.auth.onAuthStateChange((_event,session)=>setTimeout(()=>applySession(session),0));
  }catch(error){console.warn('Cloud unavailable',error)}
}

async function applySession(session){
  user=session?.user||null;
  $('#signedOutControls').hidden=Boolean(user);$('#signOut').hidden=!user;
  $('#accountState').textContent=user?user.email:'Local workspace';
  if(user){$('#authMessage').textContent='Cloud sync active';await syncCloud()}
  else $('#authMessage').textContent=cloud?'Sign in to sync across devices':'Local storage active';
}

async function signIn(){
  const email=$('#email').value.trim();if(!email)return toast('Enter your email first');
  if(!cloud)return toast('Cloud sync is being provisioned');
  const {error}=await cloud.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+'/app'}});
  $('#authMessage').textContent=error?error.message:'Check your email for the secure sign-in link.';
  if(!error)track('sign_in_requested');
}

async function syncCloud(){
  if(!cloud||!user)return;
  for(const record of records.filter(item=>!item.synced_at)){
    const payload=toCloudRecord(record);const {error}=await cloud.from('ripplemap_investigations').upsert(payload);
    if(!error)record.synced_at=new Date().toISOString();
  }
  const {data,error}=await cloud.from('ripplemap_investigations').select('*').order('created_at',{ascending:false});
  if(!error){const merged=new Map(records.map(item=>[item.id,item]));for(const row of data||[])merged.set(row.id,fromCloudRecord(row));records=[...merged.values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));persistLocal();renderSaved()}
}

function toCloudRecord(record){return{id:record.id,user_id:user.id,event:record.event,symbols:record.symbols,market_data:record.marketData,analysis:record.analysis,sources:record.sources,is_public:Boolean(record.is_public),created_at:record.created_at,updated_at:new Date().toISOString()}}
function fromCloudRecord(row){return{id:row.id,event:row.event,symbols:row.symbols,marketData:row.market_data,analysis:row.analysis,sources:row.sources,is_public:row.is_public,created_at:row.created_at,synced_at:row.updated_at}}

async function bootMarket(){
  try{
    const response=await fetch(`${BITGET}/instruments?category=SPOT`);const payload=await response.json();
    if(payload.code!=='00000')throw new Error(payload.msg||'Bitget instrument request failed');
    instruments=(payload.data||[]).filter(item=>item.status==='online');renderAssetResults('');$('#feed').textContent=`Bitget live · ${instruments.length} markets`;track('workspace_loaded',{instrument_count:instruments.length});
  }catch(error){$('#feed').textContent='Bitget directory unavailable';showError(error.message)}
}

function renderAssetResults(query){
  const term=query.trim().toUpperCase();let rows=instruments;
  if(term)rows=rows.filter(item=>`${item.symbol} ${item.baseCoin}`.toUpperCase().includes(term));else rows=rows.filter(item=>item.isReality==='yes');
  $('#assetResults').innerHTML=rows.slice(0,12).map(item=>`<button class="asset-tag" data-symbol="${esc(item.symbol)}">${esc(item.baseCoin)} <small>${item.isReality==='yes'?'rToken':esc(item.quoteCoin||'')}</small></button>`).join('')||'<span class="micro">No matching Bitget instrument.</span>';
}

function addSymbol(symbol){const values=$('#symbols').value.split(',').map(item=>item.trim().toUpperCase()).filter(Boolean);if(!values.includes(symbol))values.push(symbol);$('#symbols').value=values.join(', ');toast(`${symbol} added`)}

async function selectedSymbols(){
  if($('#universe').value==='chosen')return $('#symbols').value.split(',').map(item=>item.trim().toUpperCase()).filter(Boolean);
  const response=await fetch(`${BITGET}/tickers?category=SPOT`);const payload=await response.json();let rows=payload.data||[];
  if($('#universe').value==='rwa'){const set=new Set(instruments.filter(item=>item.isReality==='yes').map(item=>item.symbol));rows=rows.filter(item=>set.has(item.symbol))}
  return rows.sort((a,b)=>Number(b.turnover24h)-Number(a.turnover24h)).slice(0,8).map(item=>item.symbol);
}

async function fetchTickers(symbols){
  const rows=[],invalid=[];
  for(const symbol of symbols){const response=await fetch(`${BITGET}/tickers?category=SPOT&symbol=${encodeURIComponent(symbol)}`);const payload=await response.json();if(payload.code==='00000'&&payload.data?.[0])rows.push(payload.data[0]);else invalid.push(symbol)}
  return{rows,invalid};
}

function renderMarket(rows,invalid){
  const total=rows.reduce((sum,row)=>sum+Number(row.turnover24h||0),0);const average=rows.reduce((sum,row)=>sum+Math.abs(Number(row.price24hPcnt||0)),0)/rows.length;
  const spread=row=>10000*(Number(row.ask1Price)-Number(row.bid1Price))/((Number(row.ask1Price)+Number(row.bid1Price))/2);const widest=rows.reduce((a,b)=>spread(b)>spread(a)?b:a);
  $('#results').innerHTML=`<div class="panel-heading"><h2>Current market evidence</h2><span class="step">LIVE</span></div><div class="market-wrap"><table class="market-table"><thead><tr><th>Instrument</th><th>Last</th><th>24H</th><th>Bid / Ask</th><th>Turnover</th></tr></thead><tbody>${rows.map(row=>`<tr><td><b>${esc(row.symbol)}</b></td><td>${fmt(row.lastPrice)}</td><td>${pct(row.price24hPcnt)}</td><td>${fmt(row.bid1Price)} / ${fmt(row.ask1Price)}</td><td>$${fmt(row.turnover24h)}</td></tr>`).join('')}</tbody></table></div><div class="facts"><div class="fact"><span>INSTRUMENTS</span><strong>${rows.length}</strong></div><div class="fact"><span>MEAN ABS 24H</span><strong>${pct(average)}</strong></div><div class="fact"><span>COMBINED TURNOVER</span><strong>$${fmt(total)}</strong></div></div>${invalid.length?`<p class="micro">No live data returned for: ${esc(invalid.join(', '))}</p>`:''}`;
  const movers=rows.filter(row=>Math.abs(Number(row.price24hPcnt))>=.03);
  $('#supported').innerHTML=`<li>${rows.length} live ticker records were returned directly by Bitget.</li><li>${movers.length?esc(movers.map(row=>`${row.symbol} ${pct(row.price24hPcnt)}`).join(', '))+' moved at least 3% in 24 hours.':'No selected instrument moved at least 3% in the last 24 hours.'}</li><li>${esc(widest.symbol)} currently has the widest quoted spread among the returned instruments.</li>`;
}

function renderAnalysis(analysis,sources){
  $('#aiPanel').innerHTML=`<b>Research synthesis · ${esc(analysis.summary)}</b><p>${analysis.transmissionPaths.map(path=>`<strong>${esc(path.driver)} → ${esc(path.expectedDirection)}</strong><br>${esc(path.mechanism)}<br><small>${esc(path.confidence)} confidence · Evidence: ${esc(path.evidence)} · Invalidation: ${esc(path.invalidation)}</small>`).join('<br><br>')}</p>${analysis.contradictions?.length?`<p><strong>Contradictions:</strong> ${analysis.contradictions.map(esc).join(' · ')}</p>`:''}<p><strong>Watch:</strong> ${analysis.watchConditions.map(esc).join(' · ')}</p><p><strong>Caveats:</strong> ${analysis.caveats.map(esc).join(' · ')}</p>${sources.length?`<hr><p><strong>Recent source leads</strong><br>${sources.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener">[${source.index}] ${esc(source.title)}</a> <small>· ${esc(source.domain)} · ${esc(source.seenDate)}</small>`).join('<br>')}</p>`:'<hr><p class="micro">No closely matching recent source leads were returned.</p>'}`;
}

async function runInvestigation(){
  const event=$('#event').value.trim();if(!event)return showError('Describe the event or question first.');clearError();const button=$('#run');button.disabled=true;button.textContent='Fetching live market evidence…';
  try{
    const symbols=await selectedSymbols();if(!symbols.length)throw new Error('Add at least one Bitget symbol.');
    const {rows,invalid}=await fetchTickers(symbols);if(!rows.length)throw new Error('No valid Bitget ticker data returned.');renderMarket(rows,invalid);$('#audit').hidden=false;$('#aiPanel').innerHTML='<b>Tracing causal paths…</b><p>Prices, recent reporting, and inference are being kept separate.</p>';button.textContent='Analyzing evidence…';
    const marketData=rows.map(row=>({symbol:row.symbol,lastPrice:Number(row.lastPrice),price24hPcnt:Number(row.price24hPcnt),bid1Price:Number(row.bid1Price),ask1Price:Number(row.ask1Price),turnover24h:Number(row.turnover24h),sourceTimestamp:row.ts}));
    const response=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-ripplemap-session':sessionId()},body:JSON.stringify({event,marketData})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Analysis failed');renderAnalysis(payload.analysis,payload.sources||[]);
    currentRecord={id:uuid(),event,symbols:rows.map(row=>row.symbol),marketData,analysis:payload.analysis,sources:payload.sources||[],is_public:false,created_at:new Date().toISOString()};$('#timestamp').textContent=`Fetched ${new Date().toLocaleString()} · Bitget source timestamps preserved.`;$('#feed').textContent=`Live · ${new Date().toLocaleTimeString()}`;track('investigation_completed',{symbols:rows.length,sources:(payload.sources||[]).length});
  }catch(error){track('investigation_failed',{message:String(error.message||'Unknown failure').slice(0,200)});showError(error.message||'Live investigation failed.');if(!$('#audit').hidden)$('#aiPanel').innerHTML=`<b>Analysis unavailable</b><p>${esc(error.message)}</p>`}finally{button.disabled=false;button.textContent='Refresh evidence and analysis →'}
}

async function saveCurrent(){
  if(!currentRecord)return toast('Run an investigation first');
  const existing=records.findIndex(item=>item.id===currentRecord.id);if(existing>=0)records[existing]=currentRecord;else records.unshift(currentRecord);persistLocal();
  if(cloud&&user){const {error}=await cloud.from('ripplemap_investigations').upsert(toCloudRecord(currentRecord));if(!error)currentRecord.synced_at=new Date().toISOString()}
  track('investigation_saved');toast(user?'Saved and synced':'Saved on this device');
}

async function shareCurrent(){
  if(!currentRecord)return toast('Run or open an investigation first');await saveCurrent();
  if(!cloud||!user)return toast('Sign in to create a public share link');
  currentRecord.is_public=true;const {error}=await cloud.from('ripplemap_investigations').update({is_public:true,updated_at:new Date().toISOString()}).eq('id',currentRecord.id);if(error)return toast(error.message);
  const url=`${location.origin}/app?share=${encodeURIComponent(currentRecord.id)}`;await navigator.clipboard.writeText(url);track('share_created');toast('Public read-only link copied');
}

function renderSaved(){
  const query=$('#savedSearch').value.trim().toLowerCase();const visible=records.filter(item=>`${item.event} ${item.symbols.join(' ')}`.toLowerCase().includes(query));
  $('#savedList').innerHTML=visible.length?visible.map(item=>`<article class="saved-card" data-id="${esc(item.id)}"><div class="meta">${new Date(item.created_at).toLocaleString()} · ${esc(item.symbols.join(', '))}${item.synced_at?' · CLOUD':''}</div><h2>${esc(item.event)}</h2><p>${esc(item.analysis?.summary||'Saved market investigation')}</p><div class="saved-actions"><button class="secondary compact" data-action="open">Open</button><button class="secondary compact" data-action="share">Share</button><button class="secondary compact" data-action="delete">Delete</button></div></article>`).join(''):'<div class="panel empty"><div><b>No saved investigations</b><span>Complete an analysis and save it to build your research library.</span></div></div>';
}

function openRecord(record){currentRecord=record;$('#event').value=record.event;$('#symbols').value=record.symbols.join(', ');renderMarket(record.marketData,[]);renderAnalysis(record.analysis,record.sources||[]);$('#audit').hidden=false;$('#timestamp').textContent=`Saved ${new Date(record.created_at).toLocaleString()}`;switchView('workspace');track('saved_investigation_opened')}
async function deleteRecord(record){records=records.filter(item=>item.id!==record.id);persistLocal();renderSaved();if(cloud&&user)await cloud.from('ripplemap_investigations').delete().eq('id',record.id);track('investigation_deleted');toast('Investigation deleted')}
function exportRecords(){const blob=new Blob([JSON.stringify({product:'RippleMap',exported_at:new Date().toISOString(),investigations:records},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`ripplemap-export-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);track('records_exported',{count:records.length})}

function switchView(name){
  document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===`${name}View`));document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
  const copy={workspace:['LIVE CROSS-ASSET RESEARCH','Investigate an event against the market now.'],saved:['RESEARCH LIBRARY','Return to evidence, not memory.'],sources:['DATA PROVENANCE','Know what supports every conclusion.']}[name];$('#viewEyebrow').textContent=copy[0];$('#viewTitle').textContent=copy[1];if(name==='saved')renderSaved();track('view_opened',{view:name});
}

async function loadShared(){
  const id=new URLSearchParams(location.search).get('share');if(!id)return;
  if(!cloud){setTimeout(loadShared,600);return}
  const {data,error}=await cloud.from('ripplemap_investigations').select('*').eq('id',id).eq('is_public',true).maybeSingle();if(error||!data)return toast('Shared investigation is unavailable');openRecord(fromCloudRecord(data));toast('Opened a public read-only investigation')
}

document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
$('#assetSearch').addEventListener('input',event=>renderAssetResults(event.target.value));
$('#assetResults').addEventListener('click',event=>{const symbol=event.target.closest('[data-symbol]')?.dataset.symbol;if(symbol)addSymbol(symbol)});
$('#run').addEventListener('click',runInvestigation);$('#saveInvestigation').addEventListener('click',saveCurrent);$('#shareInvestigation').addEventListener('click',shareCurrent);$('#savedSearch').addEventListener('input',renderSaved);$('#exportAll').addEventListener('click',exportRecords);$('#signIn').addEventListener('click',signIn);$('#signOut').addEventListener('click',()=>cloud?.auth.signOut());
$('#savedList').addEventListener('click',event=>{const card=event.target.closest('[data-id]');const action=event.target.dataset.action;if(!card||!action)return;const record=records.find(item=>item.id===card.dataset.id);if(action==='open')openRecord(record);if(action==='share'){currentRecord=record;shareCurrent()}if(action==='delete')deleteRecord(record)});

updateSavedCount();renderSaved();bootMarket();initCloud().then(loadShared);
