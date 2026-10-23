const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const RECEIVER_DIR = path.join(__dirname, 'vendor', 'uxplay');
const RECEIVER_EXE = path.join(RECEIVER_DIR, 'uxplay-windows.exe');
const HELP_PORT = 8765;

let win;
let receiver = null;

function lanAddresses() {
  const out = [];
  const virtual = /vpn|radmin|amnezia|wintun|tap|tun|vethernet|virtual|vmware|vbox|hyper-v|wsl|docker/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
    }
  }
  return out;
}

function startReceiver() {
  if (receiver || !fs.existsSync(RECEIVER_EXE)) return;
  // vsync=no: show video frames immediately instead of waiting for audio sync (cuts mirroring delay)
  receiver = spawn(RECEIVER_EXE, [], {
    cwd: RECEIVER_DIR, stdio: 'ignore',
    env: { ...process.env, UXPLAYRC: path.join(__dirname, 'vendor', 'uxplayrc') },
  });
  receiver.on('exit', () => {
    receiver = null;
    win && !win.isDestroyed() && win.webContents.send('receiver-state', false);
  });
  win && win.webContents.send('receiver-state', true);
}

function stopReceiver() {
  // mDNSResponder is left running: it may be the system Bonjour service.
  for (const name of ['uxplay-windows.exe', 'uxplay-bluetooth-beacon.exe']) {
    execFile('taskkill', ['/F', '/T', '/IM', name], () => {});
  }
  receiver = null;
}

// Phone-side page: AirPlay cannot be triggered from a QR code, so this
// page just walks the user through the one manual step on the iPhone.
function startHelpServer() {
  const html = (host) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>iOS Mirror</title><body style="font:17px -apple-system,system-ui;padding:24px;max-width:480px;margin:auto">
<h2>Показать экран на ПК</h2>
<ol><li>Подключи iPhone к той же Wi-Fi сети, что и ПК.</li>
<li>Открой Пункт управления (свайп вниз от правого верхнего угла).</li>
<li>Нажми «Повтор экрана».</li>
<li>Выбери <b>${host}</b>.</li></ol>`;
  http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html(os.hostname()));
  }).listen(HELP_PORT, '0.0.0.0');
}

async function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: Math.min(1100, area.width - 40), height: Math.min(760, area.height - 40), minWidth: 760, minHeight: 480,
    title: 'iOS Mirror', backgroundColor: '#0c0e12',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile('index.html');
  startReceiver();}

ipcMain.handle('info', async () => {
  const ip = lanAddresses()[0];
  const url = ip ? `http://${ip}:${HELP_PORT}` : null;
  return {
    host: os.hostname(), ip, url,
    qr: url ? await QRCode.toDataURL(url, { margin: 1, width: 220 }) : null,
    receiverInstalled: fs.existsSync(RECEIVER_EXE),
    receiverRunning: !!receiver,
  };
});

ipcMain.handle('sources', async () => {
  const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  return list.map((s) => ({ id: s.id, name: s.name })).filter((s) => s.name && s.name !== 'iOS Mirror');
});

ipcMain.handle('receiver', (_e, on) => { on ? startReceiver() : stopReceiver(); return !!receiver; });

ipcMain.handle('save', async (_e, { kind, data }) => {
  const dir = path.join(app.getPath('pictures'), 'iOS Mirror');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${kind}-${stamp}.${kind === 'shot' ? 'png' : 'webm'}`);
  fs.writeFileSync(file, Buffer.from(data));
  return file;
});

app.whenReady().then(() => { startHelpServer(); createWindow(); });
app.on('before-quit', stopReceiver);
app.on('window-all-closed', () => app.quit());
