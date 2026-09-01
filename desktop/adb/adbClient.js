const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const {
  ADB_ERROR_CODES,
  createAdbError,
  normalizeAdbFailure,
} = require('./adbErrors')

const DEFAULT_TIMEOUT = 6000
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024

function isValidSerial(serial) {
  return typeof serial === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(serial)
}

function locateAdb(env = process.env, existsSync = fs.existsSync) {
  const candidates = [
    env.ADB_PATH,
    env.ANDROID_HOME && path.join(env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ].filter(Boolean)

  return candidates.find((candidate) => candidate === 'adb' || existsSync(candidate)) || 'adb'
}

function validateArguments(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw createAdbError(ADB_ERROR_CODES.INVALID_ARGUMENTS)
  }
}

function createAdbClient({
  execFileImpl = execFile,
  resolveExecutable = () => locateAdb(),
  defaultTimeout = DEFAULT_TIMEOUT,
  defaultMaxBuffer = DEFAULT_MAX_BUFFER,
} = {}) {
  function run(args, {
    timeout = defaultTimeout,
    maxBuffer = defaultMaxBuffer,
    signal = null,
    deviceCommand = false,
  } = {}) {
    validateArguments(args)
    if (signal?.aborted) return Promise.reject(normalizeAdbFailure(null, '', { signal, deviceCommand }))

    return new Promise((resolve, reject) => {
      const callback = (error, stdout, stderr) => {
        if (error) {
          reject(normalizeAdbFailure(error, stderr, { signal, deviceCommand }))
          return
        }
        if (signal?.aborted) {
          reject(normalizeAdbFailure(null, '', { signal, deviceCommand }))
          return
        }
        resolve(String(stdout || '').trim())
      }

      try {
        execFileImpl(
          resolveExecutable(),
          args,
          {
            timeout,
            maxBuffer,
            windowsHide: true,
            killSignal: 'SIGKILL',
            ...(signal ? { signal } : {}),
          },
          callback,
        )
      } catch (error) {
        reject(normalizeAdbFailure(error, '', { signal, deviceCommand }))
      }
    })
  }

  function runDevice(serial, args, options = {}) {
    if (!isValidSerial(serial)) {
      return Promise.reject(createAdbError(ADB_ERROR_CODES.INVALID_DEVICE))
    }
    return run(['-s', serial, ...args], { ...options, deviceCommand: true })
  }

  return {
    executable: () => resolveExecutable(),
    run,
    runDevice,
  }
}

module.exports = {
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_BUFFER,
  createAdbClient,
  isValidSerial,
  locateAdb,
}
