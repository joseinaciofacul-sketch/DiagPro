module.exports = {
  appId: 'com.diagpro.desktop',
  productName: 'DiagPro',
  directories: { output: 'release' },
  asar: true,
  npmRebuild: false,
  files: [
    'main.js', 'preload.js', 'rendererTarget.js', 'electronPolicy.js',
    'productionLogger.js', 'deviceDetector.js', 'package.json',
    'dist/**/*', 'adb/**/*.js', 'security/**/*.js', 'remediation/**/*.js', 'payments/**/*.js',
    '!**/*.test.*', '!**/fixtures/**', '!**/.env*', '!**/*.log', '!**/.git/**',
  ],
  win: { target: ['nsis'], requestedExecutionLevel: 'asInvoker' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  publish: null,
}
