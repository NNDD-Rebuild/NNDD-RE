const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const entry = path.resolve(__dirname, '../src/renderer/components/player/CommentRenderer.ts')
const outfile = path.resolve(__dirname, '../resources/library-assets/comment-bundle.js')

fs.mkdirSync(path.dirname(outfile), { recursive: true })

esbuild.buildSync({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'NNDDLibraryComments',
  platform: 'browser',
  target: 'es2018',
  minify: true,
  legalComments: 'none',
  alias: { '@shared': path.resolve(__dirname, '../src/shared') },
  logLevel: 'info'
})

console.log('[build:library-comment-bundle] wrote ' + outfile)
