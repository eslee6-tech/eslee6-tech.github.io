/* ---------- Storage helpers ---------- */
const LS = {
  get(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  },
  set(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
};

function fmtDate(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr(){ return fmtDate(new Date()); }
function addDays(dateStr, n){
  const d = new Date(dateStr+'T00:00:00'); d.setDate(d.getDate()+n); return d;
}
function pad2(n){ return String(n).padStart(2,'0'); }
function minutesToLabel(min){ return `${Math.round(min)}분`; }

let settings = LS.get('sb_settings', { dailyGoal: 180, sound: 'off', minimizeNotify: false });
let logs = LS.get('sb_logs', []);
let todos = LS.get('sb_todos', []);
let plannerData = LS.get('sb_planner', null);
let diaryEntries = LS.get('sb_diary', []);

function saveLogs(){ LS.set('sb_logs', logs); }
function saveTodos(){ LS.set('sb_todos', todos); }
function saveSettings(){ LS.set('sb_settings', settings); }
function savePlanner(){ LS.set('sb_planner', plannerData); }
function saveDiaryEntries(){ LS.set('sb_diary', diaryEntries); }

function addLog(entry){
  logs.push(Object.assign({ id: Date.now()+Math.random(), date: todayStr(), timestamp: Date.now() }, entry));
  saveLogs();
}
function logsInRange(days){
  const cutoff = fmtDate(addDays(todayStr(), -(days-1)));
  return logs.filter(l => l.date >= cutoff);
}
function minutesOnDate(dateStr, type){
  return logs.filter(l => l.date === dateStr && l.type === type).reduce((s,l)=>s+l.minutes,0);
}
function subjectTotals(list){
  const map = {};
  list.filter(l=>l.type==='study' && l.subject).forEach(l=>{ map[l.subject] = (map[l.subject]||0) + l.minutes; });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

/* ---------- Toast ---------- */
function toast(msg){
  if(settings.minimizeNotify) return;
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ---------- Theme ---------- */
function setTheme(dark){
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  document.getElementById('setting-dark').checked = dark;
}
function initTheme(){
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved === 'dark' || (!saved && prefersDark));
}

/* ---------- View switching ---------- */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  document.getElementById('tab-nav').classList.remove('open');
  if(name==='dashboard') renderDashboard();
  if(name==='calendar') renderCalendar();
  if(name==='report') renderReport(currentReportRange);
  if(name==='todo') renderTodos();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ==================================================================
   TIMER
   ================================================================== */
const RING_CIRCUMFERENCE = 2 * Math.PI * 90;
let studyMin = 25, breakMin = 5;
let phase = 'idle';
let remaining = studyMin*60;
let totalForPhase = remaining;
let running = false;
let timerInterval = null;
let sessionSubject = '';
let pendingSatisfactionLogId = null;

function renderTimerDisplay(){
  const mm = pad2(Math.floor(remaining/60)), ss = pad2(remaining%60);
  const label = `${mm}:${ss}`;
  document.getElementById('time-display').textContent = label;
  document.getElementById('rest-time-display').textContent = label;
  const phaseText = phase==='study' ? '공부 시간' : phase==='break' ? '휴식 시간' : '대기 중';
  document.getElementById('phase-label').textContent = phaseText;
  const ratio = totalForPhase > 0 ? remaining/totalForPhase : 0;
  document.getElementById('ring-progress').style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ratio));
}

function setTimerButtons(){
  const start = document.getElementById('btn-start');
  const pause = document.getElementById('btn-pause');
  const end = document.getElementById('btn-end');
  if(phase === 'idle'){
    start.disabled = false; start.textContent = '시작';
    pause.disabled = true; pause.textContent = '일시정지';
    end.disabled = true;
  } else {
    start.disabled = true;
    pause.disabled = false; pause.textContent = running ? '일시정지' : '재시작';
    end.disabled = false;
  }
  document.querySelectorAll('.mode-btn').forEach(b=>b.disabled = phase !== 'idle');
  document.getElementById('apply-custom').disabled = phase !== 'idle';
}

function tick(){
  remaining--;
  if(remaining <= 0){
    if(phase === 'study') naturalCompleteStudy();
    else if(phase === 'break') naturalCompleteBreak();
  } else {
    renderTimerDisplay();
  }
}

function startTimer(){
  if(phase !== 'idle') return;
  sessionSubject = document.getElementById('subject-select').value.trim() || '기타';
  phase = 'study';
  remaining = studyMin*60; totalForPhase = remaining;
  running = true;
  renderTimerDisplay(); setTimerButtons();
  if(settings.sound !== 'off') playNoise(settings.sound);
  timerInterval = setInterval(tick, 1000);
}

function togglePauseResume(){
  if(phase === 'idle') return;
  if(running){
    clearInterval(timerInterval); running = false;
  } else {
    timerInterval = setInterval(tick, 1000); running = true;
  }
  setTimerButtons();
}

function manualEndCurrent(){
  if(phase === 'idle') return;
  clearInterval(timerInterval);
  const elapsedSeconds = totalForPhase - remaining;
  const minutes = Math.max(1, Math.round(elapsedSeconds/60));
  if(phase === 'study'){
    addLog({ type:'study', minutes, subject: sessionSubject, satisfaction: null });
    stopSound();
    toast(`${minutes}분 학습을 기록했어요.`);
  } else if(phase === 'break'){
    addLog({ type:'break', minutes, subject: null });
    stopSound();
  }
  phase = 'idle'; running = false;
  remaining = studyMin*60; totalForPhase = remaining;
  renderTimerDisplay(); setTimerButtons(); updateGoalProgress();
}

function naturalCompleteStudy(){
  clearInterval(timerInterval);
  addLog({ type:'study', minutes: studyMin, subject: sessionSubject, satisfaction: null });
  const justAdded = logs[logs.length-1];
  pendingSatisfactionLogId = justAdded.id;
  stopSound();
  updateGoalProgress();
  toast('공부 세션 완료! 잠깐 쉬어볼까요?');
  openSatisfactionModal();
  phase = 'break';
  remaining = breakMin*60; totalForPhase = remaining;
  running = true;
  renderTimerDisplay(); setTimerButtons();
  resetRestChecklist();
  switchView('rest');
  timerInterval = setInterval(tick, 1000);
}

function naturalCompleteBreak(){
  clearInterval(timerInterval);
  addLog({ type:'break', minutes: breakMin, subject: null });
  phase = 'idle'; running = false;
  remaining = studyMin*60; totalForPhase = remaining;
  renderTimerDisplay(); setTimerButtons();
  toast('휴식이 끝났습니다. 다시 공부를 시작해볼까요?');
  switchView('timer');
}

function finishRestManually(){
  if(phase !== 'break'){ switchView('timer'); return; }
  manualEndCurrent();
  switchView('timer');
}

function openSatisfactionModal(){
  document.getElementById('satisfaction-modal').hidden = false;
  document.querySelectorAll('#star-rating button').forEach(b=>b.classList.remove('active'));
}
function closeSatisfactionModal(){ document.getElementById('satisfaction-modal').hidden = true; }
function rateSatisfaction(v){
  const log = logs.find(l=>l.id === pendingSatisfactionLogId);
  if(log) log.satisfaction = v;
  saveLogs();
  closeSatisfactionModal();
}

function updateGoalProgress(){
  const todayMinutes = minutesOnDate(todayStr(), 'study');
  const goal = settings.dailyGoal;
  const pct = goal > 0 ? Math.min(100, Math.round(todayMinutes/goal*100)) : 0;
  document.getElementById('today-total').textContent = minutesToLabel(todayMinutes);
  document.getElementById('goal-total').textContent = minutesToLabel(goal);
  document.getElementById('goal-percent').textContent = pct+'%';
  document.getElementById('goal-progress-fill').style.width = pct+'%';
  document.getElementById('today-accumulated').textContent = minutesToLabel(todayMinutes);
  document.getElementById('daily-goal-input').value = goal;
  document.getElementById('setting-daily-goal').value = goal;
}

function applyMode(mode, s, b){
  studyMin = s; breakMin = b;
  document.getElementById('custom-inputs').hidden = mode !== 'custom';
  remaining = studyMin*60; totalForPhase = remaining;
  renderTimerDisplay();
}

function refreshSubjectList(){
  const names = new Set();
  if(plannerData && plannerData.subjects) plannerData.subjects.forEach(s=>names.add(s.name));
  subjectTotals(logs).forEach(([name])=>names.add(name));
  if(names.size === 0) ['영어','수학','국어','과학'].forEach(n=>names.add(n));
  const datalist = document.getElementById('subject-list');
  datalist.innerHTML = '';
  names.forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; datalist.appendChild(opt);
  });
}

/* ==================================================================
   PLANNER
   ================================================================== */
function subjectRowTemplate(name, proficiency){
  const row = document.createElement('div');
  row.className = 'subject-row';
  row.innerHTML = `
    <input type="text" class="subj-name" placeholder="과목명" value="${name}">
    <div class="prof-wrap">
      <input type="range" class="subj-prof" min="1" max="5" value="${proficiency}">
      <span class="prof-label">${proficiencyLabel(proficiency)}</span>
    </div>
    <button type="button" class="remove-row" title="삭제">✕</button>
  `;
  row.querySelector('.subj-prof').addEventListener('input', (e)=>{
    row.querySelector('.prof-label').textContent = proficiencyLabel(e.target.value);
  });
  row.querySelector('.remove-row').addEventListener('click', ()=> row.remove());
  return row;
}
function proficiencyLabel(v){
  return ['매우 부족','부족','보통','우수','매우 우수'][Number(v)-1] || '보통';
}
function addSubjectRow(name='', prof=3){
  document.getElementById('subject-rows').appendChild(subjectRowTemplate(name, prof));
}
function initPlannerForm(){
  const rows = document.getElementById('subject-rows');
  if(plannerData && plannerData.subjects && plannerData.subjects.length){
    plannerData.subjects.forEach(s => addSubjectRow(s.name, s.proficiency));
    document.getElementById('exam-date').value = plannerData.examDate || '';
    document.getElementById('daily-hours').value = plannerData.dailyHours || 4;
    renderPlanResult(plannerData);
  } else {
    ['영어','수학','자료구조'].forEach(n => addSubjectRow(n, 3));
  }
}
function readSubjectRows(){
  return Array.from(document.querySelectorAll('.subject-row')).map(row=>({
    name: row.querySelector('.subj-name').value.trim(),
    proficiency: Number(row.querySelector('.subj-prof').value)
  })).filter(s=>s.name);
}

const WEEKDAY_NAMES = ['월','화','수','목','금','토','일'];

function generatePlan(){
  const examDate = document.getElementById('exam-date').value;
  const dailyHours = Number(document.getElementById('daily-hours').value) || 4;
  const subjects = readSubjectRows();
  const resultEl = document.getElementById('planner-result');

  if(!examDate || subjects.length === 0){
    resultEl.innerHTML = `<p class="placeholder-text">시험 날짜와 최소 1개 이상의 과목을 입력해주세요.</p>`;
    return;
  }
  const daysRemaining = Math.max(1, Math.ceil((new Date(examDate+'T00:00:00') - new Date(todayStr()+'T00:00:00')) / 86400000));

  const weighted = subjects.map(s => ({ ...s, weight: 6 - s.proficiency }));
  const totalWeight = weighted.reduce((s,w)=>s+w.weight, 0);
  const avgWeight = totalWeight / weighted.length;
  const sorted = [...weighted].sort((a,b)=>b.weight-a.weight);

  const weekPlan = WEEKDAY_NAMES.map((day, i) => {
    const subj = sorted[i % sorted.length];
    const hours = Math.max(1, Math.round(dailyHours * (subj.weight/avgWeight) * 2) / 2);
    return { day, subject: subj.name, hours };
  });

  const totalNeededHours = weighted.reduce((s,w)=>s + w.weight*5, 0);
  const totalAvailableHours = daysRemaining * dailyHours;
  const predicted = Math.max(5, Math.min(100, Math.round(totalAvailableHours/totalNeededHours*100)));
  const priority = sorted[0].name;

  plannerData = { examDate, dailyHours, subjects: weighted.map(({name,proficiency})=>({name,proficiency})), weekPlan, predicted, priority, daysRemaining };
  savePlanner();
  refreshSubjectList();
  renderPlanResult(plannerData);
  toast('학습 계획이 생성되었습니다.');
}

function renderPlanResult(data){
  const resultEl = document.getElementById('planner-result');
  const rows = data.weekPlan.map(r => `<tr><td>${r.day}요일</td><td>${r.subject}</td><td>${r.hours}시간</td></tr>`).join('');
  resultEl.innerHTML = `
    <div class="plan-summary">
      <div class="plan-kpi"><span>시험까지</span><strong>${data.daysRemaining}일</strong></div>
      <div class="plan-kpi"><span>우선 추천 과목</span><strong>${data.priority}</strong></div>
      <div class="plan-kpi"><span>목표 달성률 예측</span><strong>${data.predicted}%</strong></div>
    </div>
    <table class="plan-table">
      <thead><tr><th>요일</th><th>추천 학습 과목</th><th>학습 시간</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="plan-note">숙련도가 낮은 과목일수록 더 많은 시간이 배정됩니다. 이 패턴은 시험일까지 매주 반복됩니다.</p>
  `;
}

/* ==================================================================
   TODO
   ================================================================== */
const PRIORITY_ORDER = { high:0, mid:1, low:2 };
const PRIORITY_LABEL = { high:'높음', mid:'보통', low:'낮음' };

function carryOverTodos(){
  const t = todayStr();
  let changed = false;
  todos.forEach(td=>{
    if(!td.done && td.date !== t){
      td.date = t; td.carried = true; changed = true;
    }
  });
  if(changed) saveTodos();
}
function addTodo(text, priority){
  todos.push({ id: Date.now()+Math.random(), text, priority, done:false, date: todayStr(), carried:false });
  saveTodos();
  renderTodos();
}
function toggleTodo(id){
  const td = todos.find(t=>t.id===id);
  if(td){ td.done = !td.done; saveTodos(); renderTodos(); }
}
function deleteTodo(id){
  todos = todos.filter(t=>t.id!==id);
  saveTodos(); renderTodos();
}
function renderTodos(){
  const today = todayStr();
  const list = todos.filter(t=>t.date===today)
    .sort((a,b)=> (a.done-b.done) || (PRIORITY_ORDER[a.priority]-PRIORITY_ORDER[b.priority]));
  const ul = document.getElementById('todo-list');
  ul.innerHTML = '';
  if(list.length === 0){
    ul.innerHTML = `<li class="empty-state" style="border:none;background:none;">오늘의 목표를 추가해보세요!</li>`;
  }
  list.forEach(td=>{
    const li = document.createElement('li');
    if(td.done) li.classList.add('done');
    li.innerHTML = `
      <input type="checkbox" ${td.done?'checked':''}>
      <span class="todo-text">${escapeHtml(td.text)}</span>
      ${td.carried ? '<span class="carried-tag">이월</span>' : ''}
      <span class="priority-badge priority-${td.priority}">${PRIORITY_LABEL[td.priority]}</span>
      <button class="todo-delete" title="삭제">✕</button>
    `;
    li.querySelector('input').addEventListener('change', ()=>toggleTodo(td.id));
    li.querySelector('.todo-delete').addEventListener('click', ()=>deleteTodo(td.id));
    ul.appendChild(li);
  });
  const total = list.length, done = list.filter(t=>t.done).length;
  const pct = total ? Math.round(done/total*100) : 0;
  document.getElementById('todo-progress-fill').style.width = pct+'%';
  document.getElementById('todo-progress-text').textContent = `${done} / ${total} 완료 (${pct}%)`;
}
function escapeHtml(str){
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}

/* ==================================================================
   DASHBOARD
   ================================================================== */
function renderDashboard(){
  const todayMinutes = minutesOnDate(todayStr(), 'study');
  const weekLogs = logsInRange(7);
  const weekStudy = weekLogs.filter(l=>l.type==='study').reduce((s,l)=>s+l.minutes,0);
  const weekBreak = weekLogs.filter(l=>l.type==='break').reduce((s,l)=>s+l.minutes,0);
  const rated = logs.filter(l=>l.satisfaction);
  const avgSatisfaction = rated.length ? (rated.reduce((s,l)=>s+l.satisfaction,0)/rated.length).toFixed(1) : null;

  document.getElementById('kpi-today').textContent = minutesToLabel(todayMinutes);
  document.getElementById('kpi-week').textContent = minutesToLabel(weekStudy);
  document.getElementById('kpi-week-break').textContent = minutesToLabel(weekBreak);
  document.getElementById('kpi-satisfaction').textContent = avgSatisfaction ? `${avgSatisfaction} / 5` : '-';

  const chart = document.getElementById('weekly-chart');
  chart.innerHTML = '';
  const days = [];
  for(let i=6;i>=0;i--) days.push(fmtDate(addDays(todayStr(), -i)));
  const values = days.map(d=>minutesOnDate(d,'study'));
  const max = Math.max(1, ...values);
  days.forEach((d,i)=>{
    const dayObj = new Date(d+'T00:00:00');
    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `<div class="bar-fill" style="height:${Math.max(4, values[i]/max*100)}%" title="${values[i]}분"></div><span class="bar-label">${'일월화수목금토'[dayObj.getDay()]}</span>`;
    chart.appendChild(col);
  });

  const subjBars = document.getElementById('subject-bars');
  const totals = subjectTotals(logs).slice(0,6);
  subjBars.innerHTML = '';
  if(totals.length === 0){
    subjBars.innerHTML = `<p class="tagline">아직 과목별 기록이 없어요.</p>`;
  } else {
    const maxSubj = totals[0][1];
    totals.forEach(([name, mins])=>{
      const row = document.createElement('div');
      row.className = 'subject-bar-row';
      row.innerHTML = `<div class="row-top"><span>${escapeHtml(name)}</span><span>${minutesToLabel(mins)}</span></div>
        <div class="subject-bar-track"><div class="subject-bar-fill" style="width:${mins/maxSubj*100}%"></div></div>`;
      subjBars.appendChild(row);
    });
  }

  renderAiInsights();
}

function renderAiInsights(){
  const list = document.getElementById('ai-insight-list');
  list.innerHTML = '';
  const studyLogs = logs.filter(l=>l.type==='study');
  if(studyLogs.length === 0){
    list.innerHTML = `<li>아직 기록된 학습 데이터가 없어요. 타이머로 학습을 시작해보세요!</li>`;
    return;
  }
  const buckets = { '새벽(0-6시)':0, '오전(6-12시)':0, '오후(12-18시)':0, '저녁(18-24시)':0 };
  studyLogs.forEach(l=>{
    const h = new Date(l.timestamp).getHours();
    if(h<6) buckets['새벽(0-6시)'] += l.minutes;
    else if(h<12) buckets['오전(6-12시)'] += l.minutes;
    else if(h<18) buckets['오후(12-18시)'] += l.minutes;
    else buckets['저녁(18-24시)'] += l.minutes;
  });
  const bestTime = Object.entries(buckets).sort((a,b)=>b[1]-a[1])[0][0];

  const totals = subjectTotals(logs);
  let weakest = '데이터 부족';
  if(plannerData && plannerData.subjects && plannerData.subjects.length){
    const map = Object.fromEntries(totals);
    const withTotals = plannerData.subjects.map(s=>({name:s.name, mins: map[s.name]||0}));
    weakest = withTotals.sort((a,b)=>a.mins-b.mins)[0].name;
  } else if(totals.length){
    weakest = totals[totals.length-1][0];
  }

  const dayCount = new Set(studyLogs.map(l=>l.date)).size;
  const totalMinutes = studyLogs.reduce((s,l)=>s+l.minutes,0);
  const avgPerDay = Math.round(totalMinutes/dayCount);
  const recommended = Math.round(Math.max(settings.dailyGoal, avgPerDay*1.1)/5)*5;

  const items = [
    `<b>${bestTime}</b>에 가장 집중이 잘 되는 편이에요.`,
    `<b>${weakest}</b> 과목의 학습 시간이 상대적으로 부족해요.`,
    `하루 평균 <b>${minutesToLabel(avgPerDay)}</b> 학습하고 있어요.`,
    `추천 공부시간은 하루 <b>${minutesToLabel(recommended)}</b>입니다.`
  ];
  items.forEach(html=>{
    const li = document.createElement('li'); li.innerHTML = html; list.appendChild(li);
  });
}

/* ==================================================================
   REST MODE
   ================================================================== */
const GUIDES = {
  stretch: ['목을 좌우로 천천히 젖히기 (각 10초)', '어깨를 크게 10회 돌리기', '양팔을 위로 뻗어 옆구리 스트레칭', '허리를 좌우로 부드럽게 비틀기'],
  eye: ['20초간 6m 이상 떨어진 곳 바라보기', '눈을 감고 5초간 휴식 (3회 반복)', '눈동자를 상하좌우로 천천히 굴리기', '눈 주변을 가볍게 지압하기'],
  breath: ['4초간 천천히 들이쉬기', '4초간 숨 참기', '4초간 천천히 내쉬기', '5회 반복하기']
};
function renderGuide(type){
  const content = document.getElementById('guide-content');
  content.innerHTML = `<ul>${GUIDES[type].map(g=>`<li>${g}</li>`).join('')}</ul>`;
  document.querySelectorAll('.guide-btn').forEach(b=>b.classList.toggle('active', b.dataset.guide===type));
}
function resetRestChecklist(){
  document.querySelectorAll('#rest-checklist input').forEach(cb=>cb.checked=false);
}

/* ---- Web Audio noise generator ---- */
let audioCtx = null, noiseSource = null, noiseGain = null;
function playNoise(type){
  stopSound();
  if(type === 'off') return;
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  const bufferSize = 2 * audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);
  let lastOut = 0;
  for(let i=0;i<bufferSize;i++){
    const white = Math.random()*2-1;
    if(type === 'white'){
      output[i] = white * 0.25;
    } else if(type === 'nature'){
      lastOut = (lastOut + 0.02*white) / 1.02;
      output[i] = lastOut * 3.2;
    } else {
      lastOut = Math.max(-1, Math.min(1, lastOut + 0.02*white));
      output[i] = lastOut * 0.5;
    }
  }
  noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buffer; noiseSource.loop = true;
  noiseGain = audioCtx.createGain(); noiseGain.gain.value = 0.35;
  noiseSource.connect(noiseGain).connect(audioCtx.destination);
  noiseSource.start(0);
  document.querySelectorAll('.sound-btn').forEach(b=>b.classList.toggle('active', b.dataset.sound===type));
}
function stopSound(){
  if(noiseSource){ try{ noiseSource.stop(); }catch(e){} noiseSource = null; }
  document.querySelectorAll('.sound-btn').forEach(b=>b.classList.remove('active'));
}

/* ==================================================================
   CALENDAR
   ================================================================== */
let calYear, calMonth;
function renderCalendar(){
  if(calYear === undefined){ const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); }
  document.getElementById('cal-title').textContent = `${calYear}년 ${calMonth+1}월`;
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  for(let i=0;i<firstDay;i++){
    const d = document.createElement('div'); d.className = 'cal-day empty'; grid.appendChild(d);
  }
  const goal = settings.dailyGoal;
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${calYear}-${pad2(calMonth+1)}-${pad2(day)}`;
    const mins = minutesOnDate(dateStr, 'study');
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (dateStr === todayStr() ? ' today' : '');
    cell.innerHTML = `<span class="d-num">${day}</span>${mins>0?`<span class="d-dot" style="opacity:${Math.min(1, mins/goal)}"></span>`:''}`;
    cell.addEventListener('click', ()=>showDayDetail(dateStr));
    grid.appendChild(cell);
  }
  let streak = 0;
  let cursor = todayStr();
  while(minutesOnDate(cursor,'study') > 0){ streak++; cursor = fmtDate(addDays(cursor,-1)); }
  document.getElementById('streak-badge').textContent = `🔥 ${streak}일 연속`;
}
function showDayDetail(dateStr){
  const box = document.getElementById('day-detail');
  const entries = logs.filter(l=>l.date===dateStr);
  if(entries.length === 0){
    box.innerHTML = `<h3>${dateStr}</h3><p class="tagline">기록이 없습니다.</p>`;
  } else {
    const rows = entries.map(l=>`<li>${l.type==='study'?'📖 공부':'☕ 휴식'} · ${l.subject?l.subject+' · ':''}${minutesToLabel(l.minutes)}${l.satisfaction?` · 만족도 ${l.satisfaction}점`:''}</li>`).join('');
    box.innerHTML = `<h3>${dateStr}</h3><ul>${rows}</ul>`;
  }
  box.hidden = false;
}

/* ==================================================================
   DIARY
   ================================================================== */
function generateFeedback(content, difficulty, tomorrow, todayMinutes){
  const lines = [];
  lines.push(todayMinutes>0 ? `오늘 ${minutesToLabel(todayMinutes)} 학습하셨네요, 수고하셨어요!` : '오늘은 학습 기록이 없네요. 짧게라도 시작해보는 건 어떨까요?');
  if(difficulty && difficulty.trim()){
    lines.push(`"${difficulty.trim().slice(0,40)}" 부분이 어려우셨군요. 관련 개념을 내일 다시 한 번 짚고 넘어가면 좋겠어요.`);
  }
  if(todayMinutes < settings.dailyGoal){
    lines.push(`목표 대비 ${minutesToLabel(settings.dailyGoal-todayMinutes)} 부족했어요. 내일은 조금 더 채워볼까요?`);
  } else {
    lines.push('오늘 목표를 달성하셨어요! 이 페이스를 유지해보세요.');
  }
  lines.push(tomorrow && tomorrow.trim() ? `내일 목표(${tomorrow.trim().slice(0,30)})를 향해 화이팅입니다!` : '내일 목표를 구체적으로 적어보면 동기부여에 도움이 돼요.');
  return lines.join(' ');
}
function saveDiary(){
  const content = document.getElementById('diary-content').value.trim();
  const difficulty = document.getElementById('diary-difficulty').value.trim();
  const tomorrow = document.getElementById('diary-tomorrow').value.trim();
  if(!content){ toast('오늘 공부한 내용을 입력해주세요.'); return; }
  const todayMinutes = minutesOnDate(todayStr(), 'study');
  const feedback = generateFeedback(content, difficulty, tomorrow, todayMinutes);
  diaryEntries.unshift({ id: Date.now(), date: todayStr(), content, difficulty, tomorrow, feedback });
  saveDiaryEntries();
  document.getElementById('diary-content').value = '';
  document.getElementById('diary-difficulty').value = '';
  document.getElementById('diary-tomorrow').value = '';
  document.getElementById('diary-feedback').hidden = false;
  document.getElementById('diary-feedback-text').textContent = feedback;
  renderDiaryList();
  toast('일기가 저장되었습니다.');
}
function renderDiaryList(){
  const wrap = document.getElementById('diary-list');
  wrap.innerHTML = '';
  if(diaryEntries.length === 0){
    wrap.innerHTML = `<p class="empty-state">아직 작성된 일기가 없어요.</p>`;
    return;
  }
  diaryEntries.forEach(e=>{
    const div = document.createElement('div');
    div.className = 'card diary-entry';
    div.innerHTML = `
      <div class="d-date">${e.date}</div>
      <div class="d-row"><b>오늘 공부한 내용</b>${escapeHtml(e.content)}</div>
      ${e.difficulty?`<div class="d-row"><b>어려웠던 부분</b>${escapeHtml(e.difficulty)}</div>`:''}
      ${e.tomorrow?`<div class="d-row"><b>내일 목표</b>${escapeHtml(e.tomorrow)}</div>`:''}
      <div class="d-row"><b>AI 피드백</b>${escapeHtml(e.feedback)}</div>
    `;
    wrap.appendChild(div);
  });
}

/* ==================================================================
   REPORT
   ================================================================== */
let currentReportRange = 'week';
function renderReport(range){
  currentReportRange = range;
  const days = range === 'week' ? 7 : 30;
  const rangeLogs = logsInRange(days);
  const studyLogs = rangeLogs.filter(l=>l.type==='study');
  const totalStudy = studyLogs.reduce((s,l)=>s+l.minutes,0);
  const totalBreak = rangeLogs.filter(l=>l.type==='break').reduce((s,l)=>s+l.minutes,0);
  const dateSet = {};
  studyLogs.forEach(l=>{ dateSet[l.date] = (dateSet[l.date]||0) + l.minutes; });
  const goalMetDays = Object.values(dateSet).filter(m=>m>=settings.dailyGoal).length;
  const achievement = Math.round(goalMetDays/days*100);
  const totals = subjectTotals(rangeLogs);
  const topSubject = totals[0] ? totals[0][0] : '-';
  let weakSubject = '-';
  if(plannerData && plannerData.subjects && plannerData.subjects.length){
    const map = Object.fromEntries(totals);
    weakSubject = plannerData.subjects.map(s=>({name:s.name, mins:map[s.name]||0})).sort((a,b)=>a.mins-b.mins)[0].name;
  } else if(totals.length){
    weakSubject = totals[totals.length-1][0];
  }
  const card = document.getElementById('report-card');
  if(rangeLogs.length === 0){
    card.innerHTML = `<p class="placeholder-text">${range==='week'?'최근 7일':'최근 30일'}간 학습 기록이 없어요. 타이머로 학습을 시작해보세요!</p>`;
    return;
  }
  card.innerHTML = `
    <div class="report-summary">
      <div class="plan-kpi"><span>총 공부시간</span><strong>${minutesToLabel(totalStudy)}</strong></div>
      <div class="plan-kpi"><span>총 휴식시간</span><strong>${minutesToLabel(totalBreak)}</strong></div>
      <div class="plan-kpi"><span>목표 달성률</span><strong>${achievement}%</strong></div>
      <div class="plan-kpi"><span>가장 많이 공부한 과목</span><strong>${topSubject}</strong></div>
    </div>
    <div class="report-note">
      부족한 과목은 <b>${weakSubject}</b>이에요. ${range==='week'?'다음 주':'다음 달'}에는 <b>${weakSubject}</b>에 조금 더 시간을 투자해보는 걸 추천해요.
      목표 달성률은 <b>${achievement}%</b>로, ${achievement>=70?'아주 좋은 페이스를 유지하고 있어요!':'조금 더 꾸준한 학습이 필요해요.'}
    </div>
  `;
}

/* ==================================================================
   SETTINGS
   ================================================================== */
function initSettings(){
  document.getElementById('setting-sound').value = settings.sound;
  document.getElementById('setting-min-notify').checked = settings.minimizeNotify;
  document.getElementById('setting-daily-goal').value = settings.dailyGoal;
}

/* ==================================================================
   INIT
   ================================================================== */
function init(){
  initTheme();
  carryOverTodos();
  refreshSubjectList();
  updateGoalProgress();
  renderTimerDisplay(); setTimerButtons();
  initPlannerForm();
  renderTodos();
  renderGuide('stretch');
  renderDiaryList();
  initSettings();

  /* nav */
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>switchView(btn.dataset.view));
  });
  document.getElementById('menu-toggle').addEventListener('click', ()=>{
    document.getElementById('tab-nav').classList.toggle('open');
  });
  document.getElementById('theme-toggle').addEventListener('click', ()=>{
    setTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
  });

  /* timer */
  document.querySelectorAll('.mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(phase !== 'idle') return;
      document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(btn.dataset.mode === 'custom'){
        document.getElementById('custom-inputs').hidden = false;
      } else {
        applyMode(btn.dataset.mode, Number(btn.dataset.study), Number(btn.dataset.break));
      }
    });
  });
  document.getElementById('apply-custom').addEventListener('click', ()=>{
    const s = Math.max(1, Number(document.getElementById('custom-study').value)||45);
    const b = Math.max(1, Number(document.getElementById('custom-break').value)||15);
    applyMode('custom', s, b);
  });
  document.getElementById('btn-start').addEventListener('click', startTimer);
  document.getElementById('btn-pause').addEventListener('click', togglePauseResume);
  document.getElementById('btn-end').addEventListener('click', manualEndCurrent);
  document.getElementById('daily-goal-input').addEventListener('change', (e)=>{
    settings.dailyGoal = Math.max(10, Number(e.target.value)||180);
    saveSettings(); updateGoalProgress();
  });

  /* satisfaction modal */
  document.querySelectorAll('#star-rating button').forEach(btn=>{
    btn.addEventListener('click', ()=>rateSatisfaction(Number(btn.dataset.v)));
  });
  document.getElementById('satisfaction-skip').addEventListener('click', closeSatisfactionModal);

  /* planner */
  document.getElementById('add-subject-row').addEventListener('click', ()=>addSubjectRow('',3));
  document.getElementById('generate-plan').addEventListener('click', generatePlan);

  /* todo */
  document.getElementById('todo-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const input = document.getElementById('todo-input');
    const priority = document.getElementById('todo-priority').value;
    if(input.value.trim()){ addTodo(input.value.trim(), priority); input.value=''; }
  });

  /* rest */
  document.querySelectorAll('.guide-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>renderGuide(btn.dataset.guide));
  });
  document.querySelectorAll('.sound-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.sound === 'off') stopSound(); else playNoise(btn.dataset.sound);
    });
  });
  document.getElementById('finish-rest').addEventListener('click', finishRestManually);

  /* calendar */
  document.getElementById('cal-prev').addEventListener('click', ()=>{
    calMonth--; if(calMonth<0){calMonth=11; calYear--;} document.getElementById('day-detail').hidden=true; renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', ()=>{
    calMonth++; if(calMonth>11){calMonth=0; calYear++;} document.getElementById('day-detail').hidden=true; renderCalendar();
  });

  /* diary */
  document.getElementById('save-diary').addEventListener('click', saveDiary);

  /* report */
  document.querySelectorAll('.toggle-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderReport(btn.dataset.range);
    });
  });

  /* settings */
  document.getElementById('setting-dark').addEventListener('change', (e)=>setTheme(e.target.checked));
  document.getElementById('setting-sound').addEventListener('change', (e)=>{ settings.sound = e.target.value; saveSettings(); });
  document.getElementById('setting-min-notify').addEventListener('change', (e)=>{ settings.minimizeNotify = e.target.checked; saveSettings(); });
  document.getElementById('setting-daily-goal').addEventListener('change', (e)=>{
    settings.dailyGoal = Math.max(10, Number(e.target.value)||180);
    saveSettings(); updateGoalProgress();
  });
  document.getElementById('fullscreen-btn').addEventListener('click', ()=>{
    if(!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });
  document.addEventListener('fullscreenchange', ()=>{
    document.getElementById('fullscreen-btn').textContent = document.fullscreenElement ? '전체화면 종료' : '전체화면 시작';
  });
}

document.addEventListener('DOMContentLoaded', init);
