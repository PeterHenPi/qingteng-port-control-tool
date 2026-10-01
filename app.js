const state = {
  mode: 'segmentation',
  auth: {
    comId: '',
    jwt: '',
    signKey: ''
  }
}

const $ = (id) => document.getElementById(id)

const fields = {
  baseUrl: $('baseUrl'),
  useProxy: $('useProxy'),
  username: $('username'),
  password: $('password'),
  agentIds: $('agentIds'),
  ports: $('ports'),
  ips: $('ips'),
  direction: $('direction'),
  proto: $('proto'),
  durationValue: $('durationValue'),
  durationUnit: $('durationUnit'),
  strategyName: $('strategyName'),
  blacklistDirection: $('blacklistDirection'),
  brutecrackId: $('brutecrackId'),
  remark: $('remark')
}

const unitSeconds = {
  minute: 60,
  hour: 3600,
  day: 86400
}

document.querySelectorAll('input, textarea, select').forEach((item) => {
  item.addEventListener('input', render)
  item.addEventListener('change', render)
})

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.mode = tab.dataset.mode
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab))
    renderMode()
    render()
  })
})

$('loginBtn').addEventListener('click', login)
$('sendPrimary').addEventListener('click', () => sendRequest(buildRequest()))
$('sendEdit').addEventListener('click', () => sendRequest(buildSegmentationRequest('edit')))
$('sendRelease').addEventListener('click', () => {
  sendRequest({
    method: 'DELETE',
    path: '/external/api/ms-srv/api/segmentation/del',
    body: { agentIds: parseForm().agentIds }
  })
})
$('copyBody').addEventListener('click', copyBody)
$('resolveHosts').addEventListener('click', resolveHosts)
$('clearResult').addEventListener('click', () => {
  $('resultBox').textContent = '尚未执行请求。'
})

renderMode()
render()

async function login() {
  if (!fields.baseUrl.value || !fields.username.value || !fields.password.value) {
    setResult('请先填写 Console 地址、用户名和密码。')
    return
  }

  $('loginBtn').disabled = true
  $('loginBtn').textContent = '认证中...'

  try {
    const response = await rawFetch('/v1/api/auth', 'POST', {
      username: fields.username.value.trim(),
      password: fields.password.value
    })

    if (!response?.success || !response?.data) {
      throw new Error(response?.errorDesc || response?.errorMessage || '认证失败')
    }

    state.auth.comId = response.data.comId
    state.auth.jwt = response.data.jwt
    state.auth.signKey = response.data.signKey
    $('authStatus').textContent = '已认证'
    $('authStatus').classList.add('authed')
    $('comIdView').textContent = state.auth.comId
    $('jwtView').textContent = `Bearer ${mask(state.auth.jwt)}`
    $('signKeyView').textContent = mask(state.auth.signKey)
    setResult(response)
  } catch (error) {
    setResult(formatError(error))
  } finally {
    $('loginBtn').disabled = false
    $('loginBtn').textContent = '登录并获取签名参数'
  }
}

async function sendRequest(request) {
  const error = validateRequest(request)
  if (error) {
    setResult(error)
    return
  }

  if (!state.auth.comId || !state.auth.jwt || !state.auth.signKey) {
    setResult('请先登录并获取 comId、jwt、signKey。')
    return
  }

  const primary = $('sendPrimary')
  primary.disabled = true
  primary.textContent = '发送中...'

  try {
    const headers = await buildHeaders(request.method, request.body)
    const response = await rawFetch(request.path, request.method, request.body, headers)
    setResult(response)
  } catch (error) {
    setResult(formatError(error))
  } finally {
    primary.disabled = false
    primary.textContent = primaryLabel()
  }
}

async function resolveHosts() {
  const entries = splitValues(fields.agentIds.value)
  if (!entries.length) {
    setResult('请先在“主机 Agent ID”框里输入主机 IP、主机名或 Agent ID。')
    return
  }

  if (!state.auth.comId || !state.auth.jwt || !state.auth.signKey) {
    setResult('解析主机需要先登录并获取签名参数。')
    return
  }

  $('resolveHosts').disabled = true
  $('resolveHosts').textContent = '解析中...'

  try {
    const resolved = []
    const details = []

    for (const entry of entries) {
      const { rows, source, error } = await queryHostRows(entry)

      if (rows.length) {
        rows.forEach((row) => {
          const agentId = row.agentId || row.id
          if (agentId) resolved.push(agentId)
          details.push({
            input: entry,
            source,
            agentId,
            displayIp: row.displayIp,
            connectionIp: row.connectionIp,
            internalIp: row.internalIp,
            externalIp: row.externalIp,
            hostname: row.hostname,
            onlineStatus: row.onlineStatus,
            available: row.available,
            msEnabled: row.msEnabled
          })
        })
      } else if (isLikelyAgentId(entry)) {
        resolved.push(entry)
        details.push({ input: entry, agentId: entry, note: '未查询到主机，按 Agent ID 保留' })
      } else {
        details.push({ input: entry, error: error || '未查询到匹配主机' })
      }
    }

    fields.agentIds.value = Array.from(new Set(resolved)).join('\n')
    render()
    setResult({ resolvedAgentIds: Array.from(new Set(resolved)), details })
  } catch (error) {
    setResult(formatError(error))
  } finally {
    $('resolveHosts').disabled = false
    $('resolveHosts').textContent = '按 IP/主机名解析 Agent ID'
  }
}

async function queryHostRows(entry) {
  const query = isLikelyIp(entry) ? { ip: entry, page: 0, size: 20 } : { hostname: entry, page: 0, size: 20 }
  const attempts = [
    {
      source: '微隔离主机列表',
      path: `/external/api/ms-srv/api/hosts/list?${new URLSearchParams(query).toString()}`
    },
    {
      source: '资产清点 Linux 主机',
      path: `/external/api/assets/host/linux?${new URLSearchParams(query).toString()}`
    },
    {
      source: '资产清点 Windows 主机',
      path: `/external/api/assets/host/win?${new URLSearchParams(query).toString()}`
    }
  ]
  const errors = []

  for (const attempt of attempts) {
    try {
      const headers = await buildHeaders('GET', undefined, query)
      const response = await rawFetch(attempt.path, 'GET', undefined, headers)
      const rows = normalizeRows(response)
      if (rows.length) return { rows, source: attempt.source }
    } catch (error) {
      errors.push(`${attempt.source}: ${formatError(error)}`)
    }
  }

  return { rows: [], source: '', error: errors.join('\n\n') }
}

function normalizeRows(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.rows)) return response.rows
  if (Array.isArray(response?.data?.rows)) return response.data.rows
  if (Array.isArray(response?.data)) return response.data
  return []
}

function buildRequest() {
  if (state.mode === 'segmentation') return buildSegmentationRequest('create')
  if (state.mode === 'blacklist') return buildBlacklistRequest()
  return buildBrutecrackRequest()
}

function buildSegmentationRequest(action) {
  const form = parseForm()
  return {
    method: 'POST',
    path: `/external/api/ms-srv/api/segmentation/${action}`,
    body: {
      agentIds: form.agentIds,
      direction: fields.direction.value,
      ipList: form.ipItems,
      portList: form.ports,
      remark: remarkWithExpiry()
    }
  }
}

function buildBlacklistRequest() {
  const form = parseForm()
  const srcIsCustomIp = fields.blacklistDirection.value === 'src'
  const body = {
    strategyName: fields.strategyName.value.trim() || `临时黑名单-${formatCompactDate(new Date())}`,
    remark: remarkWithExpiry(),
    ports: form.ports,
    protos: parseProtocols(),
    switchStatus: 1,
    srcRealmType: srcIsCustomIp ? 3 : 2,
    dstRealmType: srcIsCustomIp ? 2 : 3
  }

  if (srcIsCustomIp) {
    body.srcIpRanges = form.ipRanges
    body.dstAgentIds = form.agentIds
  } else {
    body.srcAgentIds = form.agentIds
    body.dstIpRanges = form.ipRanges
  }

  return {
    method: 'POST',
    path: '/external/api/ms-srv/api/black-strategy/create',
    body
  }
}

function buildBrutecrackRequest() {
  return {
    method: 'POST',
    path: '/external/api/detect/brutecrack/linux/block',
    body: {
      id: fields.brutecrackId.value.trim(),
      block: 1,
      remark: remarkWithExpiry()
    }
  }
}

function validateRequest(request) {
  const form = parseForm()

  if (request.path.includes('/segmentation') && !form.agentIds.length) return '主机隔离需要填写 Agent ID。'
  if (request.path.includes('/black-strategy') && !form.agentIds.length) return '黑名单策略需要填写主机 Agent ID。'
  if (request.path.includes('/black-strategy') && !form.ipItems.length) return '黑名单策略需要填写 IP 或 IP 段。'
  if (request.path.includes('/brutecrack') && !fields.brutecrackId.value.trim()) return '暴力破解封停需要填写记录 ID。'

  return ''
}

async function buildHeaders(method, body, query) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const info = method === 'GET' ? buildGetSignInfo(query || {}) : body ? JSON.stringify(body) : ''
  const sign = await sha1(`${state.auth.comId}${info}${timestamp}${state.auth.signKey}`)

  return {
    'Content-Type': 'application/json',
    comId: state.auth.comId,
    timestamp,
    sign,
    Authorization: `Bearer ${state.auth.jwt}`
  }
}

function buildGetSignInfo(query) {
  return Object.keys(query)
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join('')
}

async function rawFetch(path, method, body, headers) {
  const baseUrl = fields.baseUrl.value.trim().replace(/\/$/, '')
  const url = buildRequestUrl(baseUrl, path)
  let response

  try {
    response = await fetch(url, {
      method,
      headers: headers || { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    })
  } catch (error) {
    throw new Error(
      [
        '请求没有到达 Console。请检查：',
        '1. Console 地址和端口是否正确；',
        '2. 如果直接打开 index.html，请改用 README 中的本地代理方式；',
        '3. 如果浏览器控制台有 CORS 报错，请勾选“使用本地代理请求 Console”。',
        `原始错误：${formatError(error)}`
      ].join('\n')
    )
  }

  const text = await response.text()
  const payload = parseJson(text)
  if (!response.ok) {
    throw new Error(
      [
        `HTTP ${response.status} ${response.statusText}`,
        `请求地址：${path}`,
        `返回内容：${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`,
        `请求体：${body ? JSON.stringify(body, null, 2) : '-'}`
      ].join('\n')
    )
  }
  return payload
}

function buildRequestUrl(baseUrl, path) {
  if (fields.useProxy.checked && location.protocol !== 'file:') {
    return `/proxy?baseUrl=${encodeURIComponent(baseUrl)}&path=${encodeURIComponent(path)}`
  }

  return `${baseUrl}${path}`
}

function render() {
  const form = parseForm()
  const request = buildRequest()

  $('hostCount').textContent = form.agentIds.length
  $('ipCount').textContent = form.ipItems.length
  $('portCount').textContent = form.ports.length
  $('expiryText').textContent = expiryText()
  $('expirySummary').textContent = expiryText()
  $('methodBadge').textContent = request.method
  $('endpoint').textContent = request.path
  $('requestPreview').textContent = JSON.stringify(request.body, null, 2)
  $('sendPrimary').textContent = primaryLabel()

  if (location.protocol === 'file:' && fields.useProxy.checked) {
    $('resultBox').textContent =
      '当前是 file:// 方式打开，本地代理不会生效。请改用 http://127.0.0.1:5177/ 打开本工具后再执行。'
  }
}

function renderMode() {
  const isBlacklist = state.mode === 'blacklist'
  const isBrutecrack = state.mode === 'brutecrack'

  document.querySelectorAll('.blacklist-only').forEach((item) => item.classList.toggle('hidden', !isBlacklist))
  document.querySelectorAll('.brutecrack-only').forEach((item) => item.classList.toggle('hidden', !isBrutecrack))
  $('sendEdit').classList.toggle('hidden', state.mode !== 'segmentation')
  $('sendRelease').classList.toggle('hidden', state.mode !== 'segmentation')
}

function parseForm() {
  const agentIds = splitValues(fields.agentIds.value)
  const ports = splitValues(fields.ports.value)
  const ipItems = splitLines(fields.ips.value)

  return {
    agentIds,
    ports: ports.length ? ports : ['all'],
    ipItems,
    ipRanges: ipItems.map(toIpRange)
  }
}

function parseProtocols() {
  return fields.proto.value.split(',').filter(Boolean)
}

function splitValues(value) {
  return value
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value) {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isLikelyIp(value) {
  return /^[\d.:-]+(?:\/\d+)?$/.test(value)
}

function isLikelyAgentId(value) {
  return /^[a-zA-Z0-9_-]{12,64}$/.test(value)
}

function toIpRange(value) {
  if (value.includes('-')) {
    const [startIp, endIp] = value.split('-').map((item) => item.trim())
    return { startIp, endIp }
  }
  return { startIp: value, endIp: value }
}

function durationSeconds() {
  const value = Math.max(1, Number(fields.durationValue.value || 1))
  return value * unitSeconds[fields.durationUnit.value]
}

function expiryDate() {
  return new Date(Date.now() + durationSeconds() * 1000)
}

function expiryText() {
  return formatDate(expiryDate())
}

function remarkWithExpiry() {
  const remark = fields.remark.value.trim()
  const expiry = `有效期至 ${expiryText()}; duration=${durationSeconds()}s`
  return remark ? `${remark}; ${expiry}` : expiry
}

function primaryLabel() {
  if (state.mode === 'segmentation') return '创建隔离'
  if (state.mode === 'blacklist') return '创建黑名单策略'
  return '执行封停'
}

async function copyBody() {
  await navigator.clipboard.writeText($('requestPreview').textContent)
  setResult('请求体已复制。')
}

async function sha1(input) {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function formatDate(date) {
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatCompactDate(date) {
  return formatDate(date).replace(/[-: ]/g, '')
}

function mask(value) {
  if (!value) return '-'
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function setResult(value) {
  $('resultBox').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function formatError(error) {
  if (error instanceof Error) return error.message
  return JSON.stringify(error, null, 2)
}
