const ENGLISH_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'please',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'there',
  'their',
  'have',
  'has',
  'had',
  'been',
  'will',
  'would',
  'could',
  'should',
  'after',
  'before',
  'does',
  'did',
  'are',
  'was',
  'were',
  'your',
  'my',
  'our',
  'can',
  'how',
  'why',
  'is',
  'a',
  'an',
  'of',
  'to',
  'in'
])
const CHINESE_STOPWORDS = new Set([
  '这个',
  '那个',
  '这些',
  '那些',
  '文件',
  '内容',
  '里面',
  '其中',
  '一下',
  '请问',
  '帮我',
  '告诉',
  '说明',
  '分析',
  '总结',
  '概括',
  '概述',
  '整体',
  '全文',
  '主要',
  '哪些',
  '什么',
  '怎么',
  '有没有',
  '是否',
  '以及',
  '还有',
  '部分',
  '章节',
  '段落',
  '文章',
  '文本',
  '资料'
])
const MAX_QUERY_TERMS = 64
const K1 = 1.2
const LENGTH_WEIGHT = 0.75

interface LexicalDocument {
  frequencies: Map<string, number>
  length: number
}

export interface TextMatchExplanation {
  matchedTerms: {
    term: string
    frequency: number
    documentFrequency: number
    idf: number
  }[]
  queryTermCount: number
  weightedCoverage: number
  exactPhrase: boolean
  coverageContribution: number
  frequencyContribution: number
  phraseContribution: number
}

export interface LexicalScore {
  relevanceScore: number
  explanation: TextMatchExplanation
}

function identifierTerms(word: string): string[] {
  const parts = word
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[\s_-]+/u)
  return [
    ...new Set([word.toLowerCase(), ...parts.map((part) => part.toLowerCase())].filter(Boolean))
  ]
}

function tokenize(content: string): LexicalDocument {
  const frequencies = new Map<string, number>()
  const add = (term: string) => frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  let length = 0
  for (const match of content.matchAll(/\p{Script=Han}+|[\p{L}\p{N}_-]+/gu)) {
    const word = match[0]
    if (/^\p{Script=Han}+$/u.test(word)) {
      const characters = Array.from(word)
      length += characters.length
      for (let i = 0; i < characters.length; i++) {
        add(characters[i])
        if (i + 1 < characters.length) add(characters[i] + characters[i + 1])
      }
      if (characters.length > 2 && characters.length <= 4) add(word)
    } else {
      length++
      for (const term of identifierTerms(word)) add(term)
    }
  }
  return { frequencies, length }
}

export function extractTextKeywords(query: string): string[] {
  const terms = new Set<string>()
  for (const match of query.matchAll(/\p{Script=Han}+|[\p{L}\p{N}_-]+/gu)) {
    const word = match[0]
    if (/^\p{Script=Han}+$/u.test(word)) {
      if (CHINESE_STOPWORDS.has(word)) continue
      const characters = Array.from(word)
      if (characters.length <= 4) terms.add(word)
      if (characters.length > 2) {
        for (let i = 0; i < characters.length - 1; i++) {
          const pair = characters[i] + characters[i + 1]
          if (!CHINESE_STOPWORDS.has(pair)) terms.add(pair)
        }
      }
    } else {
      for (const term of identifierTerms(word)) {
        if (!ENGLISH_STOPWORDS.has(term)) terms.add(term)
      }
    }
  }
  return [...terms].slice(0, MAX_QUERY_TERMS)
}

function hasExactPhrase(content: string, query: string): boolean {
  const phrase = query.trim().replace(/\s+/gu, ' ').toLowerCase()
  if (!phrase) return false
  const text = content.replace(/\s+/gu, ' ').toLowerCase()
  const wordCharacter = /[\p{L}\p{N}_-]/u
  const han = /\p{Script=Han}/u
  const needsLeftBoundary = wordCharacter.test(phrase[0]) && !han.test(phrase[0])
  const needsRightBoundary = wordCharacter.test(phrase.at(-1)!) && !han.test(phrase.at(-1)!)
  let start = text.indexOf(phrase)
  while (start !== -1) {
    const before = Array.from(text.slice(Math.max(0, start - 2), start)).at(-1) ?? ''
    const after = String.fromCodePoint(text.codePointAt(start + phrase.length) ?? 0)
    if (
      (!needsLeftBoundary || !wordCharacter.test(before)) &&
      (!needsRightBoundary || !wordCharacter.test(after))
    )
      return true
    start = text.indexOf(phrase, start + 1)
  }
  return false
}

/**
 * Duplicate text does not alter corpus statistics. BM25-style saturated
 * frequency and length normalization contribute 15%; IDF-weighted query
 * coverage contributes 75%; an exact, boundary-aware phrase contributes 10%.
 * This bounded lexical score is not a probability of semantic support.
 */
export function rankTextContents(
  contents: string[],
  query: string
): {
  keywords: string[]
  scores: LexicalScore[]
} {
  const keywords = extractTextKeywords(query)
  const unique = new Map<string, LexicalDocument>()
  for (const content of contents) {
    if (!unique.has(content)) unique.set(content, tokenize(content))
  }
  const documents = [...unique.values()]
  const averageLength =
    documents.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, documents.length)
  const statistics = keywords.map((term) => {
    const documentFrequency = documents.filter((doc) => doc.frequencies.has(term)).length
    const idf = Math.log(
      1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)
    )
    return { term, documentFrequency, idf }
  })
  const totalWeight = statistics.reduce((sum, stat) => sum + stat.idf, 0)
  const scoresByContent = new Map<string, LexicalScore>()
  for (const [content, doc] of unique) {
    const matchedTerms: TextMatchExplanation['matchedTerms'] = []
    let coverageWeight = 0
    let frequencyWeight = 0
    for (const stat of statistics) {
      const frequency = doc.frequencies.get(stat.term) ?? 0
      if (frequency === 0) continue
      matchedTerms.push({ ...stat, frequency })
      coverageWeight += stat.idf
      const lengthPenalty =
        1 - LENGTH_WEIGHT + (LENGTH_WEIGHT * doc.length) / Math.max(1, averageLength)
      frequencyWeight += (stat.idf * frequency) / (frequency + K1 * lengthPenalty)
    }
    const weightedCoverage = totalWeight ? coverageWeight / totalWeight : 0
    const exactPhrase = matchedTerms.length > 0 && hasExactPhrase(content, query)
    const explanation: TextMatchExplanation = {
      matchedTerms,
      queryTermCount: keywords.length,
      weightedCoverage,
      exactPhrase,
      coverageContribution: 0.75 * weightedCoverage,
      frequencyContribution: totalWeight ? (0.15 * frequencyWeight) / totalWeight : 0,
      phraseContribution: exactPhrase ? 0.1 : 0
    }
    scoresByContent.set(content, {
      relevanceScore: Math.min(
        1,
        explanation.coverageContribution +
          explanation.frequencyContribution +
          explanation.phraseContribution
      ),
      explanation
    })
  }
  return {
    keywords,
    scores: contents.map((content) => scoresByContent.get(content)!)
  }
}
