const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.env.PORT || 5177)
const root = __dirname

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`)

      if (url.pathname === '/proxy') {
        await proxyRequest(req, res, url)
        return
      }

      serveStatic(url.pathname, res)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ errorMessage: error.message }))
    }
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Qingteng tool: http://127.0.0.1:${port}/`)
  })

function serveStatic(urlPath, res) {
  const safePath = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath)
  const filePath = path.join(root, path.normalize(safePath).replace(/^(\.\.[/\\])+/, ''))

  if (!filePath.startsWith(root)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  })
}

async function proxyRequest(clientReq, clientRes, url) {
  const baseUrl = url.searchParams.get('baseUrl')
  const apiPath = url.searchParams.get('path')

  if (!baseUrl || !apiPath) {
    clientRes.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    clientRes.end(JSON.stringify({ errorMessage: 'baseUrl 和 path 不能为空' }))
    return
  }

  const target = new URL(apiPath, baseUrl.replace(/\/$/, '') + '/')
  const chunks = []

  for await (const chunk of clientReq) chunks.push(chunk)

  const headers = { ...clientReq.headers }
  delete headers.host
  delete headers.connection
  delete headers['content-length']

  const proxyReq = (target.protocol === 'https:' ? require('node:https') : require('node:http')).request(
    target,
    {
      method: clientReq.method,
      headers
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers, 'access-control-allow-origin': '*' }
      clientRes.writeHead(proxyRes.statusCode || 502, responseHeaders)
      proxyRes.pipe(clientRes)
    }
  )

  proxyReq.on('error', (error) => {
    clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    clientRes.end(JSON.stringify({ errorMessage: `代理连接 Console 失败：${error.message}` }))
  })

  if (chunks.length) proxyReq.write(Buffer.concat(chunks))
  proxyReq.end()
}
