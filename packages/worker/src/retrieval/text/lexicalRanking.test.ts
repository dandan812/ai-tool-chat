import { describe, expect, it } from 'vitest'
import { extractTextKeywords, rankTextContents } from './lexicalRanking'

describe('explainable lexical ranking', () => {
  it('matches whole identifiers and their camel/snake parts, not arbitrary substrings', () => {
    const { scores } = rankTextContents(
      ['event replay handler', 'prevent replayed handler', 'eventReplay handler'],
      'event'
    )
    expect(scores[0].relevanceScore).toBeGreaterThan(0)
    expect(scores[1].relevanceScore).toBe(0)
    expect(scores[2].explanation.matchedTerms.map((term) => term.term)).toContain('event')
    expect(extractTextKeywords('handle_uploadLease')).toEqual([
      'handle_uploadlease',
      'handle',
      'upload',
      'lease'
    ])
  })

  it('does not let repeated text or keyword stuffing alter corpus statistics or dominate coverage', () => {
    const complete = 'durable event replay'
    const partial = 'event '.repeat(150)
    const first = rankTextContents(
      [complete, partial, 'database migration'],
      'durable event replay'
    )
    const duplicate = rankTextContents(
      [complete, partial, 'database migration', partial],
      'durable event replay'
    )
    expect(first.scores[0].relevanceScore).toBeGreaterThan(first.scores[1].relevanceScore)
    expect(duplicate.scores.slice(0, 3)).toEqual(first.scores)
  })

  it('provides additive bounded explanations, preserves order and handles empty or stopword queries', () => {
    for (const query of ['文件 内容', '', 'lease renewal', '中文检索', '未知模块']) {
      const result = rankTextContents(
        ['lease renewal', '中文检索用于资料问答', 'irrelevant'],
        query
      )
      expect(result.scores).toHaveLength(3)
      for (const score of result.scores) {
        const e = score.explanation
        expect(score.relevanceScore).toBeCloseTo(
          e.coverageContribution + e.frequencyContribution + e.phraseContribution
        )
        expect(score.relevanceScore).toBeGreaterThanOrEqual(0)
        expect(score.relevanceScore).toBeLessThanOrEqual(1)
        expect(e.matchedTerms.every((term) => result.keywords.includes(term.term))).toBe(true)
      }
    }
    expect(rankTextContents(['文件 内容'], '文件 内容').scores[0].relevanceScore).toBe(0)
  })
})
