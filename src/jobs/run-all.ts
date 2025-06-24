#!/usr/bin/env ts-node
import { runLabubuJob as runXhsLabubuJob } from './xhs-labubu'
import { runSgpmJob } from './sgpm-labubu'
import { logger } from '../utils/logger'

async function main() {
  const debugMode = process.argv.includes('--debug') || process.env.DEBUG_MODE === 'true'
  console.log('=== 运行小红书 Labubu 监控 ===')
  await runXhsLabubuJob(logger, debugMode)
  console.log('=== 运行新加坡 PopMart Labubu 监控 ===')
  await runSgpmJob()
}

if (require.main === module) {
  main()
} 