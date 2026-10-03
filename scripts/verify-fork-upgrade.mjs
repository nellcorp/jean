#!/usr/bin/env node

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { readFileSync } from 'node:fs'

const { fetch, AbortSignal, WebSocket } = globalThis
const base = process.env.JEAN_SMOKE_URL
if (!base) throw new Error('Set JEAN_SMOKE_URL to the Jean server URL')
const expectedVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const token = process.env.JEAN_SMOKE_TOKEN
function endpoint(path) {
  const url = new URL(path, base)
  if (token) url.searchParams.set('token', token)
  return url
}

const response = await fetch(endpoint('/api/init'), {
  signal: AbortSignal.timeout(30_000),
})
assert.equal(response.status, 200, 'Jean bootstrap must return HTTP 200')
const bootstrap = await response.json()
assert.equal(bootstrap.appVersion, expectedVersion, 'Wrong app version')

const url = endpoint('/ws')
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
const socket = new WebSocket(url)
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  clearTimeout(request.timeout)
  if (message.type === 'error') {
    request.reject(new Error(`${request.command} failed`))
  } else {
    request.resolve(message.data)
  }
})

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.close()
    reject(new Error('WebSocket connection timed out'))
  }, 30_000)
  socket.addEventListener(
    'open',
    () => {
      clearTimeout(timeout)
      resolve()
    },
    { once: true }
  )
  socket.addEventListener(
    'error',
    () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket connection failed'))
    },
    { once: true }
  )
})

function invoke(command, args = {}) {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${command} timed out`))
    }, 30_000)
    pending.set(id, { command, resolve, reject, timeout })
    socket.send(JSON.stringify({ type: 'invoke', id, command, args }))
  })
}

try {
  const envelope = await invoke('get_server_preferences')
  for (const key of [
    'linear_api_key',
    'outline_api_key',
    'sentry_auth_token',
    'http_server_token',
  ]) {
    assert.equal(
      Object.hasOwn(envelope.preferences, key),
      false,
      `${key} must be redacted`
    )
    assert.equal(
      typeof envelope.preferences[`${key}_configured`],
      'boolean',
      `${key} configured flag missing`
    )
  }
  for (const command of [
    'list_projects',
    'list_jean_skills',
    'list_skill_backends',
    'list_claude_output_styles',
  ]) {
    assert.ok(
      Array.isArray(await invoke(command)),
      `${command} must return an array`
    )
    console.log(`PASS ${command}`)
  }
  if (process.env.JEAN_SMOKE_PROJECT_ID) {
    const args = { projectId: process.env.JEAN_SMOKE_PROJECT_ID }
    for (const command of ['list_linear_teams', 'list_outline_collections']) {
      assert.ok(
        Array.isArray(await invoke(command, args)),
        `${command} must return an array`
      )
      console.log(`PASS ${command}`)
    }
  }
  console.log(`PASS Jean ${expectedVersion} bootstrap and secret redaction`)
} finally {
  for (const request of pending.values()) clearTimeout(request.timeout)
  socket.close()
}
