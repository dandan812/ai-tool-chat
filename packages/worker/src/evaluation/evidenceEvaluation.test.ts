import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVIDENCE_FIXTURES } from './evidenceFixtures'
import { runEvidenceCase, runEvidenceEvaluation } from './runEvidenceEvaluation'

describe('fixed offline evidence evaluation (not model answer quality)', () => {
  it.each(EVIDENCE_FIXTURES)('$id: $question', (fixture) => {
    const result = runEvidenceCase(fixture)
    expect(result.errors).toEqual([])
  })
  it('reports scope and optionally saves a local JSON artifact', () => {
    const report = runEvidenceEvaluation()
    expect(report.total).toBe(30)
    expect(report.passed).toBe(30)
    expect(report.modelInvocations).toBe(0)
    expect(report.actualModelCost).toBeNull()
    if (process.env.EVIDENCE_EVAL_REPORT) {
      const target = resolve(process.env.EVIDENCE_EVAL_REPORT)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    }
  })
})
