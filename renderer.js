const $ = (id) => document.getElementById(id);
const video = $('video');
let currentId = null;
let stream = null;
let recorder = null;
let chunks = [];
let recStarted = 0;
let recTimer = null;
let receiverOn = false;

/* ---------- theme (dark by default) ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  try { localStorage.setItem('theme', theme); } catch {}
}
let saved = null;
try { saved = localStorage.getItem('theme'); } catch {}
applyTheme(saved === 'light' ? 'light' : 'dark');
$('theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------- state ---------- */
// waiting: receiver up, no phone yet · live: phone streaming · stopped / missing: receiver off
function setState(state) {
  document.body.dataset.state = state;
  const text = {
    waiting: 'Ждём iPhone',
    live: 'Трансляция идёт',
    stopped: 'Приёмник остановлен',
    missing: 'Приёмник не найден',
  }[state];
  $('state').textContent = text;
  const e = {
    waiting: ['Ждём iPhone', 'Включи «Повтор экрана» на телефоне и выбери этот ПК, картинка появится здесь сама.'],
    stopped: ['Приёмник выключен', 'iPhone не увидит этот ПК. Включи переключатель слева внизу.'],
    missing: ['Приёмник не найден', 'Не удалось найти файлы приёмника в папке vendor/uxplay.'],
  }[state];
  if (e) { $('emptyTitle').textContent = e[0]; $('emptyText').textContent = e[1]; }
}

function setReceiver(on) {
  receiverOn = on;
  $('toggle').checked = on;
  $('recvHint').textContent = on ? 'Виден для iPhone в сети' : 'Выключен, iPhone не найдёт ПК';
  if (document.body.dataset.state !== 'missing') setState(!on ? 'stopped' : currentId ? 'live' : 'waiting');
}

/* ---------- toast ---------- */
function toast(text, isError) {
  const t = $('toast');
  $('toastText').textContent = text;
  $('toastIcon').setAttribute('href', isError ? '#i-alert' : '#i-check');
  t.classList.toggle('err', !!isError);
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ---------- capture ---------- */
// The captured window includes the receiver's title bar and 1px borders; crop them out.
function cropBox() {
  const top = Math.round(24 * window.devicePixelRatio) + 1;
  const b = 1;
  const w = video.videoWidth, h = video.videoHeight;
  return { sx: b, sy: top, sw: Math.max(1, w - 2 * b), sh: Math.max(1, h - top - b) };
}
video.addEventListener('loadedmetadata', () => {
  const c = cropBox();
  video.style.objectViewBox = `inset(${c.sy}px ${c.sx}px ${video.videoHeight - c.sy - c.sh}px ${c.sx}px)`;
});

async function attach(id, name) {
  stopCapture();
  if (!id) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 60 } },
    });
  } catch (e) {
    toast('Не удалось захватить окно: ' + e.message, true);
    return;
  }
  currentId = id;
  video.srcObject = stream;
  $('liveName').textContent = name || 'Трансляция идёт';
  $('shot').disabled = $('rec').disabled = false;
  stream.getVideoTracks()[0].onended = () => stopCapture();
  setState('live');
}

function stopCapture() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  currentId = null;
  video.srcObject = null;
  $('shot').disabled = $('rec').disabled = true;
  if (document.body.dataset.state === 'live') setState(receiverOn ? 'waiting' : 'stopped');
}

// The receiver opens its own video window when a phone connects; find it by title.
async function refreshSources() {
  const list = await window.mirror.sources();
  const sel = $('src');
  const prev = sel.value;
  sel.innerHTML = '';
  sel.add(new Option('Окно не выбрано', ''));
  for (const s of list) sel.add(new Option(s.name, s.id));
  const auto = list.find((s) => /uxplay|airplay/i.test(s.name));
  const wanted = list.some((s) => s.id === prev) ? prev : auto ? auto.id : '';
  sel.value = wanted;
  if (wanted && wanted !== currentId) attach(wanted, list.find((s) => s.id === wanted).name);
  if (currentId && !list.some((s) => s.id === currentId)) stopCapture();
}

$('src').onchange = (e) => {
  const o = e.target.selectedOptions[0];
  e.target.value ? attach(e.target.value, o.textContent) : stopCapture();
};

/* ---------- screenshot / record ---------- */
async function screenshot() {
  if (!stream || $('shot').disabled) return;
  const box = cropBox();
  const c = document.createElement('canvas');
  c.width = box.sw;
  c.height = box.sh;
  c.getContext('2d').drawImage(video, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
  const flash = $('flash');
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = await window.mirror.save('shot', await blob.arrayBuffer());
  toast('Скриншот сохранён: ' + file);
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function setRecUi(on) {
  document.body.dataset.rec = on ? '1' : '0';
  const b = $('rec');
  b.classList.toggle('recording', on);
  b.dataset.tip = on ? 'Остановить запись' : 'Начать запись';
  $('recIcon').setAttribute('href', on ? '#i-stop' : '#i-rec');
  $('recKbd').hidden = on;
  clearInterval(recTimer);
  if (on) {
    const tick = () => ($('recLabel').innerHTML = '<span class="timer">' + fmt(Date.now() - recStarted) + '</span>');
    tick();
    recTimer = setInterval(tick, 500);
  } else {
    $('recLabel').textContent = 'Запись';
  }
}

function toggleRecord() {
  if (!stream || $('rec').disabled) return;
  if (recorder && recorder.state === 'recording') return recorder.stop();
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8e6 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    setRecUi(false);
    if (!chunks.length) return;
    const file = await window.mirror.save('rec', await new Blob(chunks).arrayBuffer());
    toast('Запись сохранена: ' + file);
  };
  recorder.start(1000);
  recStarted = Date.now();
  setRecUi(true);
}

$('shot').onclick = screenshot;
$('rec').onclick = toggleRecord;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(SELECT|INPUT)$/.test(document.activeElement.tagName)) return;
  if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') screenshot();
  if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') toggleRecord();
});

/* ---------- misc controls ---------- */
$('toggle').onchange = async (e) => setReceiver(await window.mirror.receiver(e.target.checked));
window.mirror.onReceiverState(setReceiver);

$('host').onclick = async () => {
  try { await navigator.clipboard.writeText($('hostName').textContent); } catch { return; }
  $('host').classList.add('copied');
  $('hostIcon').setAttribute('href', '#i-check');
  setTimeout(() => { $('host').classList.remove('copied'); $('hostIcon').setAttribute('href', '#i-copy'); }, 1600);
};

(async () => {
  const info = await window.mirror.info();
  $('hostName').textContent = info.host;
  if (info.qr) { $('qr').src = info.qr; $('qrBox').hidden = false; $('qrCap').hidden = false; }
  if (!info.receiverInstalled) setState('missing');
  else setReceiver(info.receiverRunning);
  refreshSources();
  setInterval(() => !document.hidden && refreshSources(), 3000);
})();

// Don't spend CPU on frames nobody sees (unless a recording is running).
document.addEventListener('visibilitychange', () => {
  const track = stream && stream.getVideoTracks()[0];
  if (track) track.enabled = !document.hidden || (recorder && recorder.state === 'recording');
});
