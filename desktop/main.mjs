import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, dialog, session, shell, utilityProcess } from 'electron'
import {
  backendListenMarker,
  desktopBackendEnvironment,
  exactLoopbackOrigin,
  findAvailableLoopbackPort,
  isAllowedExternalUrl,
  isTrustedAppUrl,
  loopbackOrigin,
  permissionAllowed,
} from './runtime.mjs'

const APP_ID = 'com.agentcommons.desktop'
const DEV_RENDERER_URL = process.env.AGENT_COMMONS_DEV_URL
const DEVELOPMENT = Boolean(DEV_RENDERER_URL)
const START_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 7_000

let mainWindow = null
let backend = null
let backendReady = false
let quitting = false
let quitAfterBackend = false
let rendererUrl = null
let trustedOrigin = null

app.enableSandbox()
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Agent Commons Development'))

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
  app.whenReady().then(startDesktop).catch(failStartup)
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function startDesktop() {
  app.setAppUserModelId(APP_ID)
  installApplicationMenu()

  const preferredPort = DEVELOPMENT ? Number(process.env.AGENT_COMMONS_BACKEND_PORT) : 0
  const port = Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : await findAvailableLoopbackPort()
  const backendOrigin = loopbackOrigin(port)
  trustedOrigin = DEVELOPMENT ? exactLoopbackOrigin(DEV_RENDERER_URL) : backendOrigin
  rendererUrl = DEVELOPMENT ? trustedOrigin : backendOrigin

  configureSessionPermissions(trustedOrigin)
  await launchBackend({ port, backendOrigin, rendererOrigin: trustedOrigin })
  await waitForReady(`${backendOrigin}/api/v1/readyz`, trustedOrigin, START_TIMEOUT_MS)
  if (DEVELOPMENT) await waitForReady(rendererUrl, trustedOrigin, START_TIMEOUT_MS, false)

  backendReady = true
  await createMainWindow(rendererUrl, trustedOrigin)
  console.log(`[desktop] ready ${rendererUrl}`)
}

function installApplicationMenu() {
  const template = []
  if (process.platform === 'darwin') template.push({ role: 'appMenu' })
  template.push({ role: 'editMenu' }, { role: 'windowMenu' })
  if (DEVELOPMENT) template.push({ role: 'viewMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function configureSessionPermissions(origin) {
  const allowed = (permission, requestingUrl) => permissionAllowed(permission, requestingUrl, origin)
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    allowed(permission, details?.requestingUrl ?? requestingOrigin),
  )
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed(permission, details?.requestingUrl ?? '')),
  )
  session.defaultSession.setDevicePermissionHandler?.(() => false)
}

async function launchBackend({ port, backendOrigin, rendererOrigin }) {
  const entry = join(app.getAppPath(), 'scripts', 'start.mjs')
  if (!existsSync(entry)) throw new Error(`The desktop backend entry is missing: ${entry}`)

  const child = utilityProcess.fork(entry, ['desktop'], {
    cwd: app.getPath('userData'),
    env: desktopBackendEnvironment({
      baseEnv: process.env,
      port,
      rendererOrigin,
      userDataPath: app.getPath('userData'),
      authSecret: randomBytes(32).toString('base64url'),
    }),
    serviceName: 'Agent Commons Backend',
    stdio: 'pipe',
  })
  backend = child

  const marker = backendListenMarker(backendOrigin)
  const stderrTail = []
  await new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(new Error('The local backend did not start in time.')), START_TIMEOUT_MS)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      error ? reject(error) : resolve()
    }
    pipeLines(child.stdout, (line) => {
      console.log(`[backend] ${line}`)
      if (line.includes(marker)) finish()
    })
    pipeLines(child.stderr, (line) => {
      console.error(`[backend] ${line}`)
      stderrTail.push(line)
      if (stderrTail.length > 12) stderrTail.shift()
    })
    child.once('exit', (code) => {
      backend = null
      if (!settled) {
        const detail = stderrTail.length ? `\n\n${stderrTail.join('\n')}` : ''
        finish(new Error(`The local backend exited during startup (code ${code ?? 'unknown'}).${detail}`))
        return
      }
      if (quitting) return
      backendReady = false
      dialog.showErrorBox(
        'Agent Commons stopped',
        'The local service stopped unexpectedly. Your data remains on this device; reopen Agent Commons to recover.',
      )
      app.quit()
    })
  })
}

function pipeLines(stream, onLine) {
  if (!stream) return
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line) onLine(line)
  })
  stream.on('end', () => {
    if (pending) onLine(pending)
  })
}

async function waitForReady(url, origin, timeoutMs, requireReadyPayload = true) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { Origin: origin }, redirect: 'error' })
      if (response.ok) {
        if (!requireReadyPayload) return
        const body = await response.json()
        if (body?.status === 'ready') return
        lastError = new Error(`Local backend reported ${body?.status ?? 'an unknown state'}.`)
      } else {
        lastError = new Error(`Readiness probe returned HTTP ${response.status}.`)
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Agent Commons could not become ready. ${lastError instanceof Error ? lastError.message : ''}`.trim())
}

async function createMainWindow(url, origin) {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 320,
    minHeight: 360,
    show: false,
    backgroundColor: '#fbf9f9',
    title: 'Agent Commons',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: DEVELOPMENT,
    },
  })
  mainWindow = win

  const leaveApp = (candidate) => {
    if (isAllowedExternalUrl(candidate)) void shell.openExternal(candidate)
  }
  const guardNavigation = (event, candidate) => {
    if (isTrustedAppUrl(candidate, origin)) return
    event.preventDefault()
    leaveApp(candidate)
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)
  win.webContents.setWindowOpenHandler(({ url: candidate }) => {
    if (isTrustedAppUrl(candidate, origin)) void win.loadURL(candidate)
    else leaveApp(candidate)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting) return
    console.error(`[desktop] renderer exited: ${details.reason}`)
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  await win.loadURL(url)
}

function failStartup(error) {
  console.error(error)
  dialog.showErrorBox(
    'Couldn’t open Agent Commons',
    error instanceof Error ? error.message : 'The desktop application could not start.',
  )
  app.quit()
}

async function stopBackend() {
  const child = backend
  if (!child) return
  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once('exit', finish)
    child.kill()
    setTimeout(finish, STOP_TIMEOUT_MS)
  })
  backend = null
  backendReady = false
}

app.on('activate', () => {
  if (!ownsInstance) return
  if (mainWindow) focusMainWindow()
  else if (rendererUrl && trustedOrigin && backendReady) void createMainWindow(rendererUrl, trustedOrigin).catch(failStartup)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterBackend || !backend) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void stopBackend().finally(() => {
    quitAfterBackend = true
    app.quit()
  })
})
