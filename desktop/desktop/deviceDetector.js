const { exec } = require('child_process')

function runAdb(cmd) {
  return new Promise((resolve, reject) => {
    exec(`adb ${cmd}`, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

async function detectarDispositivo() {
  const devicesOutput = await runAdb('devices')
  const linhas = devicesOutput.split('\n').slice(1).filter(Boolean)
  const linhaDispositivo = linhas.find((l) => l.includes('\tdevice'))

  if (!linhaDispositivo) {
    return { conectado: false }
  }

  const serial = linhaDispositivo.split('\t')[0]

  const [fabricante, modelo, versaoAndroid, sdk] = await Promise.all([
    runAdb(`-s ${serial} shell getprop ro.product.manufacturer`),
    runAdb(`-s ${serial} shell getprop ro.product.model`),
    runAdb(`-s ${serial} shell getprop ro.build.version.release`),
    runAdb(`-s ${serial} shell getprop ro.build.version.sdk`),
  ])

  const bateriaRaw = await runAdb(`-s ${serial} shell dumpsys battery`)
  const nivelMatch = bateriaRaw.match(/level:\s*(\d+)/)
  const bateria = nivelMatch ? parseInt(nivelMatch[1], 10) : null

  return {
    conectado: true,
    serial,
    fabricante,
    modelo,
    versaoAndroid,
    sdk,
    bateria,
  }
}

module.exports = { detectarDispositivo }
