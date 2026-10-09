const { execSync, spawn } = require('child_process')

if (process.platform === 'win32') {
  execSync('chcp 65001', { stdio: 'ignore' })
}

execSync('node scripts/buildLibraryCommentBundle.js', { stdio: 'inherit' })

// `npm run dev -- --headless --port 8080` のように渡した引数は Electron アプリ本体へ転送する
// (electron-vite は `--` 以降を ELECTRON_CLI_ARGS 経由でアプリの process.argv に渡す)
const appArgs = process.argv.slice(2)
const child = spawn('npx', ['electron-vite', 'dev', ...(appArgs.length ? ['--', ...appArgs] : [])], {
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
