const { spawn } = require('child_process')
const path = require('path')
const os = require('os')

const cwd = process.cwd()
const home = os.homedir()
const cacheElectron = path.join(home, '.cache', 'electron')
const cacheBuilder = path.join(home, '.cache', 'electron-builder')

const args = [
  'run',
  '--rm',
  '-v', `${cwd}:/project`,
  '-v', 'nndd_node_modules:/project/node_modules',
  '-v', `${cacheElectron}:/root/.cache/electron`,
  '-v', `${cacheBuilder}:/root/.cache/electron-builder`,
  'electronuserland/builder:20',
  '/bin/bash', '-c', 'npm install && npm run build && npm run dist:linux'
]

console.log('docker ' + args.join(' '))

const child = spawn('docker', args, { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('docker起動失敗。Docker Desktopが起動しているか確認:', err.message)
  process.exit(1)
})
