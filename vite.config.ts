import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const logDir = path.join(rootDir, 'logs')
const logFile = path.join(logDir, 'osm-postman-client.log')

function osmPostmanLogPlugin(): Plugin {
  return {
    name: 'osm-postman-log-sink',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === '/__osm-postman/logs') {
          if (req.method === 'GET') {
            try {
              const body = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end(body)
            } catch {
              res.statusCode = 500
              res.end('Failed to read logs')
            }
            return
          }
          if (req.method === 'DELETE') {
            try {
              if (fs.existsSync(logFile)) fs.unlinkSync(logFile)
              res.statusCode = 204
              res.end()
            } catch {
              res.statusCode = 500
              res.end('Failed to clear logs')
            }
            return
          }
        }
        if (url === '/__osm-postman/log' && req.method === 'POST') {
          let data = ''
          req.on('data', (chunk: Buffer | string) => {
            data += chunk
          })
          req.on('end', () => {
            try {
              fs.mkdirSync(logDir, { recursive: true })
              fs.appendFileSync(logFile, data)
              res.statusCode = 204
              res.end()
            } catch {
              res.statusCode = 500
              res.end('Failed to write log')
            }
          })
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [osmPostmanLogPlugin()],
})
