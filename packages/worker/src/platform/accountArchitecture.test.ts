import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const platform = dirname(fileURLToPath(import.meta.url))
const authHandler = resolve(platform, '../handlers/authHandlers.ts')
const facade = resolve(platform, 'accounts.ts')

function dependencies(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return []
    const specifier = statement.moduleSpecifier
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) return []
    const dependency = resolve(dirname(file), specifier.text + '.ts')
    return dirname(dependency) === platform || dependency === authHandler ? [dependency] : []
  })
}

describe('Account module ownership', () => {
  it('keeps the compatibility facade outside domain dependencies and has no account import cycles', () => {
    const visited = new Set<string>()
    const cycles: string[][] = []
    const facadeImports: string[] = []
    function visit(file: string, ancestors: string[]) {
      if (ancestors.includes(file)) {
        cycles.push([...ancestors, file])
        return
      }
      if (visited.has(file)) return
      visited.add(file)
      for (const dependency of dependencies(file)) {
        if (dependency === facade) facadeImports.push(file)
        visit(dependency, [...ancestors, file])
      }
    }
    visit(facade, [])
    expect(visited.has(authHandler)).toBe(true)
    expect(cycles).toEqual([])
    expect(facadeImports).toEqual([])
  })
})
