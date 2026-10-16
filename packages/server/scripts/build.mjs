import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({
  absWorkingDir: root,
  entryPoints: [
    'src/server.mjs',
    'src/admin.mjs',
    'src/runtime.mjs',
    'src/document-extractor.mjs',
    'src/document-worker.mjs'
  ],
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as documentCreateRequire } from 'node:module'; const require = documentCreateRequire(import.meta.url);"
  }
})
const pdfPackage = import.meta.resolve('pdfjs-dist/package.json')
for (const directory of ['cmaps', 'standard_fonts']) {
  await cp(
    fileURLToPath(new URL('./' + directory, pdfPackage)),
    join(root, 'dist/document-assets', directory),
    { recursive: true }
  )
}
