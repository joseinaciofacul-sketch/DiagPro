const KNOWN_INSTALLERS = Object.freeze({
  'com.android.vending': { type: 'google_play', label: 'Google Play' },
  'com.google.android.packageinstaller': { type: 'package_installer', label: 'Instalador de pacotes do Android' },
  'com.android.packageinstaller': { type: 'package_installer', label: 'Instalador de pacotes do Android' },
  'com.samsung.android.packageinstaller': { type: 'package_installer', label: 'Instalador de pacotes do fabricante' },
  'com.sec.android.app.samsungapps': { type: 'manufacturer_store', label: 'Loja do fabricante' },
  'com.huawei.appmarket': { type: 'manufacturer_store', label: 'Loja do fabricante' },
  'com.xiaomi.market': { type: 'manufacturer_store', label: 'Loja do fabricante' },
  'com.oppo.market': { type: 'manufacturer_store', label: 'Loja do fabricante' },
  'com.bbk.appstore': { type: 'manufacturer_store', label: 'Loja do fabricante' },
})

function valorDisponivel(valor) {
  return valor !== null && valor !== undefined && valor !== ''
}

function normalizarIdentidade(app) {
  const details = app?.securityDetails || {}
  return {
    status: details.available ? 'available' : 'not_verified',
    packageName: app?.packageName || null,
    apkPath: details.apkPath || app?.apkPath || null,
    versionName: details.versionName || null,
    versionCode: details.versionCode || null,
    firstInstallTime: details.firstInstallTime || null,
    lastUpdateTime: details.lastUpdateTime || null,
    flags: Array.isArray(details.flags) ? details.flags : [],
    installed: valorDisponivel(details.installed) ? details.installed : null,
    enabled: valorDisponivel(details.enabled) ? details.enabled : null,
    uid: valorDisponivel(details.uid) ? details.uid : null,
  }
}

function normalizarOrigem(details = {}) {
  const installerPackageName = details.installerPackageName || null
  const initiatingPackageName = details.initiatingPackageName || null
  const originatingPackageName = details.originatingPackageName || null

  if (initiatingPackageName === 'com.android.shell' || installerPackageName === 'com.android.shell') {
    return {
      status: 'available',
      type: 'adb',
      label: 'Instalação via ADB',
      installerPackageName,
      initiatingPackageName,
      originatingPackageName,
    }
  }
  if (installerPackageName && KNOWN_INSTALLERS[installerPackageName]) {
    return {
      status: 'available',
      ...KNOWN_INSTALLERS[installerPackageName],
      installerPackageName,
      initiatingPackageName,
      originatingPackageName,
    }
  }
  if (installerPackageName) {
    return {
      status: 'available',
      type: 'other_installer',
      label: 'Outro instalador identificado',
      installerPackageName,
      initiatingPackageName,
      originatingPackageName,
    }
  }
  return {
    status: details.available ? 'unknown' : 'not_verified',
    type: 'unknown',
    label: details.available ? 'Origem desconhecida' : 'Origem não verificada',
    installerPackageName: null,
    initiatingPackageName,
    originatingPackageName,
  }
}

function normalizarIntegridade(details = {}) {
  const integrity = details.integrity || {}
  const hash = integrity.hash || {}
  const signature = integrity.signature || {}
  return {
    hash: {
      algorithm: 'SHA-256',
      hash: hash.status === 'available' ? hash.hash : null,
      status: hash.status || 'not_verified',
      reason: hash.reason || null,
    },
    signature: {
      status: signature.status || 'not_verified',
      certificateDigest: signature.certificateDigest || null,
      digestAlgorithm: signature.digestAlgorithm || null,
      schemeVersion: signature.schemeVersion || null,
      reason: signature.reason || null,
    },
  }
}

module.exports = {
  KNOWN_INSTALLERS,
  normalizarIdentidade,
  normalizarOrigem,
  normalizarIntegridade,
}
