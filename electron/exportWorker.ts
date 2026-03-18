import { parentPort, workerData } from 'worker_threads'
import { wcdbService } from './services/wcdbService'
import { exportService, ExportOptions } from './services/exportService'

interface ExportWorkerConfig {
  sessionIds: string[]
  outputDir: string
  options: ExportOptions
  resourcesPath?: string
  userDataPath?: string
  logEnabled?: boolean
}

const config = workerData as ExportWorkerConfig
process.env.WEFLOW_WORKER = '1'
if (config.resourcesPath) {
  process.env.WCDB_RESOURCES_PATH = config.resourcesPath
}

wcdbService.setPaths(config.resourcesPath || '', config.userDataPath || '')
wcdbService.setLogEnabled(config.logEnabled === true)

async function run() {
  const result = await exportService.exportSessions(
    Array.isArray(config.sessionIds) ? config.sessionIds : [],
    String(config.outputDir || ''),
    config.options || { format: 'json' },
    (progress) => {
      parentPort?.postMessage({
        type: 'export:progress',
        data: progress
      })
    }
  )

  parentPort?.postMessage({
    type: 'export:result',
    data: result
  })
}

run().catch((error) => {
  parentPort?.postMessage({
    type: 'export:error',
    error: String(error)
  })
})
