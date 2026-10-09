import test from 'node:test'
import assert from 'node:assert/strict'
import { originAllowed } from '../src/origin.js'

const SITE = 'https://er-diagram-co-op-web.vercel.app'

test('empty list allows everything', () => {
  assert.equal(originAllowed('https://anything.example', ''), true)
  assert.equal(originAllowed(null, undefined), true)
})
test('only the listed web origin (and local development) is allowed', () => {
  assert.equal(originAllowed(SITE, SITE), true)
  assert.equal(originAllowed(SITE, SITE + '/'), true) // trailing slash in the setting is tolerated
  assert.equal(originAllowed('https://evil.example', SITE), false)
  assert.equal(originAllowed('https://er-diagram-co-op-web.vercel.app.evil.example', SITE), false)
  assert.equal(originAllowed('http://er-diagram-co-op-web.vercel.app', SITE), false) // http vs https
  assert.equal(originAllowed(null, SITE), false) // no Origin header (scripts)
  assert.equal(originAllowed('http://localhost:5173', SITE), true)
  assert.equal(originAllowed('http://127.0.0.1:8787', SITE), true)
  assert.equal(originAllowed('http://localhost.evil.example', SITE), false)
})
test('several origins can be listed', () => {
  const list = `${SITE}, https://er.mycompany.com`
  assert.equal(originAllowed('https://er.mycompany.com', list), true)
  assert.equal(originAllowed('https://other.example', list), false)
})
