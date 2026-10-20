// Crea el tag vX.Y.Z a partir de la versión del package.json (para el workflow de GitHub)
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const v = JSON.parse(readFileSync('package.json', 'utf8')).version
execSync(`git tag v${v}`, { stdio: 'inherit' })
execSync(`git push origin v${v}`, { stdio: 'inherit' })
console.log(`Tag v${v} publicado: GitHub Actions compila el instalador y crea el release.`)
