const { execSync, spawn } = require('child_process')

if (process.platform === 'win32') {
  execSync('chcp 65001', { stdio: 'ignore' })
}

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
