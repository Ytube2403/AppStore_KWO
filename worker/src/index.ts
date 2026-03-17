import 'dotenv/config'
import http from 'http'
import { pickNextJob, recoverStalledJobs } from './lib/jobQueue'
import { handleTranslationJob } from './jobs/translation'
import { handleSerpFetchJob } from './jobs/serp-fetch'
import { logger } from './lib/logger'
import type { AnalysisJob } from './types'

const PORT = parseInt(process.env.PORT || '3001', 10)
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10)
const RECOVERY_INTERVAL_MS = 10 * 60 * 1000  // 10 minutes
const WORKER_ID = process.env.WORKER_ID || 'worker-1'

const startedAt = Date.now()
let isProcessing = false

// ────────────────────────────────────────────────────────────────────────────
// HTTP Health Server
// ────────────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const body = JSON.stringify({
      status: 'ok',
      worker_id: WORKER_ID,
      uptime_ms: Date.now() - startedAt,
      is_processing: isProcessing,
    })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  logger.info(`Health server listening on port ${PORT}`)
})

// ────────────────────────────────────────────────────────────────────────────
// Job Router — dispatch to the correct handler based on job_type
// ────────────────────────────────────────────────────────────────────────────
async function dispatchJob(job: AnalysisJob): Promise<void> {
  logger.info('Dispatching job', { jobId: job.id, type: job.job_type })

  switch (job.job_type) {
    case 'translation':
      await handleTranslationJob(job)
      break

    case 'serp_fetch':
      await handleSerpFetchJob(job)
      break

    // Sprint 3 handlers — registered here when implemented
    case 'intent_analysis':
      logger.warn('intent_analysis handler not yet implemented — skipping', { jobId: job.id })
      break

    case 'clustering':
      logger.warn('clustering handler not yet implemented — skipping', { jobId: job.id })
      break

    default:
      logger.error('Unknown job type', { jobId: job.id, type: job.job_type })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Poll Loop — check for new jobs every POLL_INTERVAL_MS
// ────────────────────────────────────────────────────────────────────────────
async function pollOnce(): Promise<void> {
  if (isProcessing) return  // skip if already running a job

  const job = await pickNextJob()
  if (!job) return

  isProcessing = true
  try {
    await dispatchJob(job)
  } catch (err: any) {
    logger.error('Unhandled error in job dispatch', {
      jobId: job.id,
      error: err?.message || String(err),
    })
  } finally {
    isProcessing = false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Startup
// ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.info('Worker starting', { workerId: WORKER_ID, pollIntervalMs: POLL_INTERVAL_MS })

  // Recover any stalled jobs from previous crashes
  await recoverStalledJobs()

  // Start the poll loop
  setInterval(pollOnce, POLL_INTERVAL_MS)

  // Periodic stall recovery (runs every 10 minutes)
  setInterval(recoverStalledJobs, RECOVERY_INTERVAL_MS)

  // Immediately try to pick up a job on startup
  await pollOnce()
}

main().catch((err) => {
  logger.error('Worker failed to start', { error: err?.message || String(err) })
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Worker shutting down (SIGTERM)')
  server.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('Worker shutting down (SIGINT)')
  server.close()
  process.exit(0)
})
