import { parentPort, workerData } from 'node:worker_threads'
if (process.env.DOC_PARSER_SHOULD_NOT_INHERIT || process.execArgv.length) {
  throw new Error('Parser inherited parent process configuration')
}
if (Buffer.from(workerData.bytes).toString() === 'hang') setInterval(() => {}, 1000)
else parentPort.postMessage({ text: 'Synthetic result' })
