const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { detectarDispositivo } = require('./deviceDetector')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL('http://localhost:5173')
}

ipcMain.handle('detectar-dispositivo', async () => {
  try {
    return await detectarDispositivo()
  } catch (err) {
    return { conectado: false, erro: String(err) }
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
