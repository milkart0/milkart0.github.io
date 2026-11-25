import { firebaseConfig, lineProviderId } from './firebase-config.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'daybyday-calendar-events-v1';
const FIREBASE_VERSION = '13.4.0';
const today = startOfDay(new Date());
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today);
let view = 'month';
let events = loadEvents();
let currentUser = null;
let firebase = null;
let guestMode = false;
let stopCloudListener = null;
let cloudQueue = Promise.resolve();

const monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
const weekNames = ['週日','週一','週二','週三','週四','週五','週六'];
const categoryNames = { work: '工作', life: '生活', important: '重要', other: '其他' };
const categoryColors = { work: 'work', life: 'life', important: 'important', other: 'other' };

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function fromKey(key) { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
function sameDay(a,b) { return dateKey(a) === dateKey(b); }
function loadEvents() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveLocalEvents() { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }
function sortedEvents(list) { return [...list].sort((a,b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title)); }
function eventsOn(date) { return sortedEvents(events.filter(event => event.date === dateKey(date))); }
function safeText(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function firebaseIsConfigured() { return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && !firebaseConfig.apiKey.startsWith('YOUR_') && !firebaseConfig.projectId.startsWith('YOUR_')); }
function setStatus(message) { $('#sync-label').textContent = message; }
function setBusy(button, busy, label) { button.disabled = busy; button.dataset.originalText ||= button.textContent; button.textContent = busy ? label : button.dataset.originalText; }
function showError(error) {
  const messages = {
    'auth/unauthorized-domain': '請在 Firebase Authentication 的 Authorized domains 加入目前網站網域。',
    'auth/popup-closed-by-user': '登入視窗已關閉。',
    'auth/popup-blocked': '瀏覽器封鎖了登入視窗，請允許此網站開啟登入視窗後再試一次。',
    'auth/operation-not-allowed': '這種登入方式尚未在 Firebase 啟用。LINE 登入需設定 OIDC 提供者。',
    'permission-denied': 'Firestore 權限不足，請部署 firestore.rules。',
  };
  alert(messages[error.code] || `操作失敗：${error.message || error.code || error}`);
}

async function initializeFirebase() {
  if (!firebaseIsConfigured()) { setStatus('訪客模式 · 資料存在此裝置'); return; }
  setStatus('正在連線 Firebase…');
  try {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appSdk, authSdk, dbSdk] = await Promise.all([
      import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
    ]);
    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    const db = dbSdk.getFirestore(app);
    firebase = { ...authSdk, ...dbSdk, auth, db, lineProviderId };
    authSdk.onAuthStateChanged(auth, async user => {
      currentUser = user;
      $('#login-screen').hidden = Boolean(user || guestMode);
      $('#app-shell').hidden = !user && !guestMode;
      $('#profile-name').textContent = user?.displayName || '訪客模式';
      $('#signin-button').textContent = user ? '登出' : '登入';
      if (stopCloudListener) { stopCloudListener(); stopCloudListener = null; }
      if (!user) { events = loadEvents(); setStatus('訪客模式 · 資料存在此裝置'); render(); return; }
      setStatus('正在載入雲端行程…');
      try {
        const ref = dbSdk.collection(db, 'users', user.uid, 'events');
        const cloud = await dbSdk.getDocs(ref);
        if (cloud.empty && events.length) {
          const batch = dbSdk.writeBatch(db);
          for (const item of events) batch.set(dbSdk.doc(ref, item.id), item);
          await batch.commit();
        }
        stopCloudListener = dbSdk.onSnapshot(ref, snapshot => {
          events = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
          saveLocalEvents(); render(); setStatus('已同步至雲端');
        }, error => { setStatus('雲端同步失敗'); showError(error); });
      } catch (error) { setStatus('雲端連線失敗'); showError(error); }
    });
  } catch (error) {
    console.error(error); setStatus('Firebase SDK 載入失敗');
  }
}

function persistEvent(item) {
  events = [...events.filter(event => event.id !== item.id), item]; saveLocalEvents(); render();
  if (currentUser && firebase) {
    const ref = firebase.doc(firebase.db, 'users', currentUser.uid, 'events', item.id);
    cloudQueue = cloudQueue.then(() => firebase.setDoc(ref, item)).then(() => setStatus('已同步至雲端')).catch(error => { setStatus('雲端儲存失敗'); showError(error); });
  }
}
function removeEvent(id) {
  events = events.filter(event => event.id !== id); saveLocalEvents(); render();
  if (currentUser && firebase) {
    const ref = firebase.doc(firebase.db, 'users', currentUser.uid, 'events', id);
    cloudQueue = cloudQueue.then(() => firebase.deleteDoc(ref)).then(() => setStatus('已同步至雲端')).catch(error => { setStatus('雲端刪除失敗'); showError(error); });
  }
}

function render() { renderCalendar(); renderMiniCalendar(); renderUpcoming(); renderCounts(); }
function renderCalendar() {
  const grid = $('#calendar-grid'); grid.replaceChildren();
  if (view === 'month') {
    $('#current-month').textContent = `${cursor.getFullYear()} 年 ${monthNames[cursor.getMonth()]}`;
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), start = new Date(first); start.setDate(first.getDate() - first.getDay());
    const rows = Math.ceil((new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate() + first.getDay()) / 7);
    for (let i=0;i<rows*7;i++) { const date=new Date(start); date.setDate(start.getDate()+i); grid.append(makeDayCell(date, date.getMonth() !== cursor.getMonth())); }
  } else {
    const start = new Date(selectedDate); start.setDate(selectedDate.getDate()-selectedDate.getDay()); const end = new Date(start); end.setDate(start.getDate()+6);
    $('#current-month').textContent = `${start.getMonth()+1}/${start.getDate()} – ${end.getMonth()+1}/${end.getDate()}`;
    for(let i=0;i<7;i++){const date=new Date(start);date.setDate(start.getDate()+i);grid.append(makeDayCell(date,false));}
  }
}
function makeDayCell(date,outside) {
  const cell=document.createElement('div'); cell.className='day-cell';
  if(outside) cell.classList.add('outside'); if(sameDay(date,today)) cell.classList.add('today'); if(sameDay(date,selectedDate)) cell.classList.add('selected');
  cell.setAttribute('role','button');cell.setAttribute('tabindex','0');cell.setAttribute('aria-label',`${dateKey(date)}，${eventsOn(date).length} 個行程`);
  const number=document.createElement('div');number.className='day-number';number.textContent=date.getDate();cell.append(number);
  for(const event of eventsOn(date).slice(0,3)) {const chip=document.createElement('div');chip.className=`event-chip ${categoryColors[event.category]||'life'}`;chip.textContent=`${event.time ? event.time+' ' : ''}${event.title}`;chip.title=event.title;chip.addEventListener('click',e=>{e.stopPropagation();openEvent(event.id);});cell.append(chip);}
  const remaining=eventsOn(date).length-3;if(remaining>0){const more=document.createElement('div');more.className='more-events';more.textContent=`＋${remaining} 個行程`;cell.append(more);}
  cell.addEventListener('click',()=>{selectedDate=startOfDay(date);if(view==='month'&&date.getMonth()!==cursor.getMonth())cursor=new Date(date.getFullYear(),date.getMonth(),1);render();openEventForm();});
  cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();cell.click();}}); return cell;
}
function renderMiniCalendar() {
  $('#mini-label').textContent=`${cursor.getFullYear()} 年 ${monthNames[cursor.getMonth()]}`; const box=$('#mini-calendar');box.replaceChildren();
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),start=new Date(first);start.setDate(1-first.getDay());
  for(let i=0;i<35;i++){const date=new Date(start);date.setDate(start.getDate()+i);const button=document.createElement('button');button.className='mini-day';button.textContent=date.getDate();if(date.getMonth()!==cursor.getMonth())button.classList.add('muted');if(sameDay(date,today))button.classList.add('today');if(sameDay(date,selectedDate))button.classList.add('selected');button.setAttribute('aria-label',dateKey(date));button.addEventListener('click',()=>{selectedDate=startOfDay(date);cursor=new Date(date.getFullYear(),date.getMonth(),1);render();});box.append(button);}
}
function renderUpcoming() {
  const box=$('#upcoming-list');box.replaceChildren();const end=new Date(today);end.setDate(today.getDate()+14);
  const upcoming=events.filter(e=>{const d=fromKey(e.date);return d>=today&&d<=end;}).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)).slice(0,3);
  if(!upcoming.length){const empty=document.createElement('div');empty.className='empty-upcoming';empty.textContent='接下來兩週還沒有行程，留點空白給自己。';box.append(empty);return;}
  for(const event of upcoming){const date=fromKey(event.date),card=document.createElement('div');card.className='upcoming-card';card.tabIndex=0;card.setAttribute('role','button');card.innerHTML=`<div class="date-badge"><span>${weekNames[date.getDay()]}</span><strong>${date.getDate()}</strong></div><div class="upcoming-copy"><strong>${safeText(event.title)}</strong><span>${event.time||'全天'} · ${safeText(event.categoryLabel||categoryNames[event.category]||'生活')}</span></div>`;card.addEventListener('click',()=>openEvent(event.id));card.addEventListener('keydown',e=>{if(e.key==='Enter')openEvent(event.id);});box.append(card);}
}
function renderCounts(){const counts={work:0,life:0,important:0,other:0};for(const e of events){if(counts[e.category]!==undefined)counts[e.category]++;}$('#work-count').textContent=counts.work;$('#life-count').textContent=counts.life;$('#important-count').textContent=counts.important;$('#other-count').textContent=counts.other;}
function updateOtherCategoryField(){const isOther=$('#event-category').value==='other';$('#other-category-field').hidden=!isOther;$('#other-category').required=isOther;if(!isOther)$('#other-category').value='';}
function openEventForm(event=null) {
  $('#event-form').reset();$('#event-id').value=event?.id||'';$('#dialog-title').textContent=event?'編輯行程':'新增行程';$('#event-title').value=event?.title||'';$('#event-date').value=event?.date||dateKey(selectedDate);$('#event-time').value=event?.time||'09:00';$('#event-category').value=event?.category||'work';$('#other-category').value=event?.categoryLabel||'';updateOtherCategoryField();$('#event-note').value=event?.note||'';$('#delete-event').hidden=!event;$('#event-dialog').showModal();$('#event-title').focus();
}
function openEvent(id){const event=events.find(item=>item.id===id);if(event){selectedDate=fromKey(event.date);cursor=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();openEventForm(event);}}
function requestEventCancel() {
  const isEditing=Boolean($('#event-id').value);
  $('#cancel-confirm-title').textContent=isEditing?'確定要取消編輯嗎？':'確定要取消新增行程嗎？';
  $('#cancel-confirm-message').textContent='尚未儲存的內容會被捨棄。';
  $('#cancel-confirm-dialog').showModal();
  $('#keep-editing').focus();
}
function closeEventWithoutSaving() {
  if($('#cancel-confirm-dialog').open) $('#cancel-confirm-dialog').close();
  $('#event-dialog').close();
}
$('#new-event').addEventListener('click',()=>openEventForm());
$('#close-dialog').addEventListener('click',requestEventCancel);
$('#cancel-dialog').addEventListener('click',requestEventCancel);
$('#event-dialog').addEventListener('cancel',event=>{event.preventDefault();requestEventCancel();});
$('#keep-editing').addEventListener('click',()=>{$('#cancel-confirm-dialog').close();$('#event-title').focus();});
$('#confirm-cancel').addEventListener('click',closeEventWithoutSaving);
$('#cancel-confirm-dialog').addEventListener('cancel',event=>{event.preventDefault();$('#cancel-confirm-dialog').close();$('#event-title').focus();});
$('#event-category').addEventListener('change',updateOtherCategoryField);
$('#event-form').addEventListener('submit',event=>{event.preventDefault();const id=$('#event-id').value||crypto.randomUUID();const category=$('#event-category').value;const categoryLabel=category==='other'?$('#other-category').value.trim():'';const item={id,title:$('#event-title').value.trim(),date:$('#event-date').value,time:$('#event-time').value,category,categoryLabel,note:$('#event-note').value.trim()};if(!item.title||!item.date||(category==='other'&&!categoryLabel))return;persistEvent(item);selectedDate=fromKey(item.date);cursor=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);$('#event-dialog').close();render();});
$('#delete-event').addEventListener('click',()=>{const id=$('#event-id').value;if(id&&confirm('確定刪除這個行程嗎？')){removeEvent(id);$('#event-dialog').close();}});
$('#prev-month').addEventListener('click',()=>{if(view==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);else selectedDate.setDate(selectedDate.getDate()-7);render();});
$('#next-month').addEventListener('click',()=>{if(view==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);else selectedDate.setDate(selectedDate.getDate()+7);render();});
$('#mini-prev').addEventListener('click',()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render();});$('#mini-next').addEventListener('click',()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render();});
$('#today-button').addEventListener('click',()=>{selectedDate=new Date(today);cursor=new Date(today.getFullYear(),today.getMonth(),1);render();});$('#see-month').addEventListener('click',()=>{view='month';document.querySelectorAll('.view-switch button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));cursor=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();});
document.querySelectorAll('.view-switch button').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;document.querySelectorAll('.view-switch button').forEach(b=>b.classList.toggle('active',b===button));render();}));
async function startSignIn(providerName, button) {
  if(!firebase){alert('先以訪客模式使用即可。要啟用登入，請在 firebase-config.js 填入 Firebase Web App 設定。');return;}
  setBusy(button,true,currentUser?'登出中…':'登入中…');
  try {
    if(currentUser) await firebase.signOut(firebase.auth);
    else {
      const provider = providerName === 'line'
        ? new firebase.OAuthProvider(firebase.lineProviderId)
        : new firebase.GoogleAuthProvider();
      await firebase.signInWithPopup(firebase.auth,provider);
    }
  } catch(error) { showError(error); }
  finally { button.disabled=false; button.textContent=button.dataset.originalText; }
}
$('#signin-button').addEventListener('click',event=>startSignIn('google',event.currentTarget));
$('#google-login').addEventListener('click',event=>startSignIn('google',event.currentTarget));
$('#line-login').addEventListener('click',event=>startSignIn('line',event.currentTarget));
$('#user-button').addEventListener('click',()=>$('#signin-button').click());
$('#guest-start').addEventListener('click',()=>{guestMode=true;$('#login-screen').hidden=true;$('#app-shell').hidden=false;});
$('#home-button').addEventListener('click',async()=>{
  guestMode=false;
  try {
    if(firebase) await firebase.signOut(firebase.auth);
    $('#app-shell').hidden=true;
    $('#login-screen').hidden=false;
  } catch(error) { showError(error); }
});
$('#aiFab').addEventListener('click',()=>alert('AI 行程助理尚未連線。完成安全的後端 AI API 設定後，就可以在這裡加入行程建議。'));

render(); initializeFirebase();
