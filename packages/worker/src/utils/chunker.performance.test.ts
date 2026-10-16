import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { expect, it } from 'vitest'
import { estimateTokens, splitByTokens } from './chunker'

const benchmark =
  process.env.TEXT_BENCHMARK_REPORT && process.env.CHUNKER_BASELINE_PATH ? it : it.skip

benchmark(
  'compares the frozen local chunker snapshot with the current lossless partition',
  async () => {
    // Optional local benchmark only; the archived module is never imported by production.
    const source = readFileSync(process.env.CHUNKER_BASELINE_PATH!, 'utf8')
    const javascript = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ES2020,
        target: ScriptTarget.ES2020
      }
    }).outputText
    const baseline = (await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    )) as {
      splitByTokens: typeof splitByTokens
    }
    const fixture = '  资料处理记录：lease renewal, original whitespace. 😀\r\n'.repeat(24000)
    const budget = 1200
    function run(split: typeof splitByTokens) {
      const start = performance.now()
      const chunks = split(fixture, budget)
      return {
        elapsedMs: performance.now() - start,
        chunkCount: chunks.length,
        lossless: chunks.join('') === fixture,
        oversizedChunks: chunks.filter((chunk) => estimateTokens(chunk) > budget).length,
        maxEstimatedTokens: Math.max(...chunks.map(estimateTokens))
      }
    }
    for (let i = 0; i < 2; i++) {
      run(baseline.splitByTokens)
      run(splitByTokens)
    }
    const oldSamples = []
    const newSamples = []
    for (let i = 0; i < 7; i++) {
      oldSamples.push(run(baseline.splitByTokens))
      newSamples.push(run(splitByTokens))
    }
    const summarize = (samples: ReturnType<typeof run>[]) => ({
      medianMs: samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b)[3],
      chunkCount: samples[0].chunkCount,
      lossless: samples[0].lossless,
      oversizedChunks: samples[0].oversizedChunks,
      maxEstimatedTokens: samples[0].maxEstimatedTokens
    })
    expect(newSamples.every((sample) => sample.lossless && sample.oversizedChunks === 0)).toBe(true)
    const report = {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      baselinePath: process.env.CHUNKER_BASELINE_PATH,
      samples: 7,
      warmups: 2,
      fixtureUTF16Units: fixture.length,
      maxTokens: budget,
      realModelCalls: 0,
      scope:
        'Synthetic local partition only; token counts are heuristic, not provider usage or model quality.',
      baseline: summarize(oldSamples),
      current: summarize(newSamples)
    }
    writeFileSync(process.env.TEXT_BENCHMARK_REPORT!, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  },
  60000
)
