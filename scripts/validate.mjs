#!/usr/bin/env node
// Checks the catalog before it is published: every item listed in
// catalog.json exists, matches its size and sha256, is a well-formed Pod
// Designer snapshot, and uses only features WebPod knows. Also flags content
// that a WebPod would refuse to install (scripts, javascript: links, network
// calls). No dependencies: `node scripts/validate.mjs`.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const KINDS = { template: 'templates', component: 'components', document: 'documents' }
const FEATURES = new Set([
  'pod-designer-snapshot/1',
  'runtime-variables',
  'initial-from-prop',
  'remembered-variables',
  'mapping-functions',
  'list-props',
  'document-pages',
  'free-position'
])
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION = /^\d+\.\d+\.\d+$/
const PARENT_KEYS = ['parentFlexContainerId', 'parentListContainerId']

const errors = []
const warnings = []
const fail = (where, message) => errors.push(`${where}: ${message}`)
const warn = (where, message) => warnings.push(`${where}: ${message}`)
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' && value.trim() !== ''

const childIds = (block) => (Array.isArray(block.flexItems)
  ? block.flexItems.flatMap((item) => (Array.isArray(item?.childBlockIds) ? item.childBlockIds : []))
  : Array.isArray(block.childBlockIds) ? block.childBlockIds : [])

const checkSnapshot = (where, content) => {
  if (!isObject(content)) return fail(where, 'content must be an object')
  if (!isObject(content.blocks) || !Object.keys(content.blocks).length) return fail(where, 'content.blocks must hold at least one block')
  Object.entries(content.blocks).forEach(([blockId, block]) => {
    if (!isObject(block)) return fail(where, `block ${blockId} is not an object`)
    if (block.id !== blockId) fail(where, `block key ${blockId} does not match its id ${block.id}`)
    if (!text(block.type)) fail(where, `block ${blockId} has no type`)
    PARENT_KEYS.forEach((key) => {
      if (!block[key]) return
      const parent = content.blocks[block[key]]
      if (!parent) fail(where, `block ${blockId} names missing ${key} ${block[key]}`)
      else if (!childIds(parent).includes(blockId)) fail(where, `block ${blockId} is not listed as a child of ${block[key]}`)
    })
    childIds(block).forEach((childId) => {
      if (!content.blocks[childId]) fail(where, `block ${blockId} lists missing child ${childId}`)
    })
  })
}

// What a WebPod checks again on install; here it stops a bad publish early.
const scanSafety = (where, content) => {
  const hosts = new Set()
  const visit = (value, path) => {
    if (typeof value === 'string') {
      if (/<script\b/i.test(value)) fail(where, `script tag in ${path}`)
      if (/^\s*javascript:/i.test(value)) fail(where, `javascript: link in ${path}`)
      for (const match of value.matchAll(/\b(https?):\/\/([^/\s"'?#)]+)/gi)) {
        if (match[1].toLowerCase() === 'http') warn(where, `insecure http link to ${match[2]} in ${path}`)
        hosts.add(match[2].toLowerCase())
      }
      return
    }
    if (Array.isArray(value)) return value.forEach((entry, index) => visit(entry, `${path}[${index}]`))
    if (isObject(value)) {
      if (value.globalMethodKey === 'fetch') warn(where, `network call (fetch reaction) at ${path}`)
      Object.entries(value).forEach(([key, entry]) => visit(entry, `${path}.${key}`))
    }
  }
  visit(content, 'content')
  return [...hosts].sort()
}

const catalogPath = join(root, 'catalog.json')
let catalog = null
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
} catch (error) {
  fail('catalog.json', `unreadable: ${error.message}`)
}

const listed = new Set()
if (catalog) {
  if (catalog.schema !== 'webpod-catalog/1') fail('catalog.json', 'schema must be "webpod-catalog/1"')
  if (!VERSION.test(String(catalog.version || ''))) fail('catalog.json', 'version must look like 1.2.3')
  if (!Array.isArray(catalog.items)) fail('catalog.json', 'items must be a list')
  const seen = new Set()
  const hostsUsed = new Set()
  ;(catalog.items || []).forEach((entry, index) => {
    const where = `catalog.json items[${index}] (${entry?.kind}/${entry?.id})`
    if (!KINDS[entry?.kind]) return fail(where, `kind must be one of ${Object.keys(KINDS).join(', ')}`)
    if (!ID.test(String(entry.id || ''))) fail(where, 'id must be lowercase words joined by hyphens')
    const key = `${entry.kind}/${entry.id}`
    if (seen.has(key)) fail(where, 'duplicate id for this kind')
    seen.add(key)
    if (!text(entry.title)) fail(where, 'title is required')
    if (!text(entry.description)) fail(where, 'description is required')
    if (!Array.isArray(entry.requires) || !entry.requires.includes('pod-designer-snapshot/1')) fail(where, 'requires must list pod-designer-snapshot/1')
    ;(entry.requires || []).filter((feature) => !FEATURES.has(feature)).forEach((feature) => fail(where, `unknown feature "${feature}"`))
    const expectedFile = `${KINDS[entry.kind]}/${entry.id}.json`
    if (entry.file !== expectedFile) fail(where, `file must be ${expectedFile}`)
    const file = join(root, entry.file || '')
    listed.add(entry.file)
    if (!existsSync(file)) return fail(where, `missing file ${entry.file}`)
    const raw = readFileSync(file)
    if (raw.length !== entry.bytes) fail(where, `bytes ${entry.bytes} do not match the file (${raw.length}); re-run the export`)
    if (createHash('sha256').update(raw).digest('hex') !== entry.sha256) fail(where, 'sha256 does not match the file; re-run the export')
    let item = null
    try {
      item = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      return fail(entry.file, `not JSON: ${error.message}`)
    }
    if (item.schema !== 'webpod-catalog-item/1') fail(entry.file, 'schema must be "webpod-catalog-item/1"')
    if (item.id !== entry.id || item.kind !== entry.kind) fail(entry.file, 'id and kind must match catalog.json')
    checkSnapshot(entry.file, item.content)
    scanSafety(entry.file, item.content).forEach((host) => hostsUsed.add(host))
    if (entry.kind === 'component') {
      if (item.content?.authoringType !== 'component') fail(entry.file, 'a component\'s content must have authoringType "component"')
      const declared = Object.keys(item.content?.props || {}).sort().join(',')
      if (declared !== Object.keys(entry.props || {}).sort().join(',')) fail(where, 'props must match the component\'s declared props')
    }
    if (entry.kind === 'template' && !['page', 'section'].includes(entry.templateKind)) fail(where, 'templateKind must be page or section')
    if (entry.kind === 'document' && item.content?.authoringType !== 'document') fail(entry.file, 'a document\'s content must have authoringType "document"')
  })
  if (hostsUsed.size) console.log(`External hosts referenced: ${[...hostsUsed].join(', ')}`)
}

// Files nobody lists are never served to WebPods; flag them.
Object.values(KINDS).forEach((folder) => {
  const dir = join(root, folder)
  if (!existsSync(dir)) return
  readdirSync(dir).filter((name) => name.endsWith('.json')).forEach((name) => {
    const file = relative(root, join(dir, name)).split('\\').join('/')
    if (!listed.has(file)) fail(file, 'not listed in catalog.json')
  })
})

warnings.forEach((message) => console.warn(`warning  ${message}`))
errors.forEach((message) => console.error(`error    ${message}`))
if (errors.length) {
  console.error(`\n${errors.length} error(s). The catalog is not ready to publish.`)
  process.exit(1)
}
console.log(`Catalog OK: ${catalog.items.length} items, version ${catalog.version}${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`)
