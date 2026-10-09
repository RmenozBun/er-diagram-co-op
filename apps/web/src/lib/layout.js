import { deriveRelations } from '@er/schema'

export const NODE_WIDTH = 250
export const HEADER_H = 38
export const ROW_H = 26

export function tableHeight(table) {
  return HEADER_H + Math.max(1, table.fields.length) * ROW_H + 6
}

/** Cheap grid placement used until someone runs "Auto layout" or drags a table. */
export function gridPosition(schema, index) {
  const cols = 3
  const col = index % cols
  const rowIndex = Math.floor(index / cols)
  let y = 0
  for (let r = 0; r < rowIndex; r++) {
    const slice = schema.tables.slice(r * cols, r * cols + cols)
    y += Math.max(...slice.map(tableHeight)) + 70
  }
  return { x: col * (NODE_WIDTH + 90), y }
}

/** @returns {Promise<Record<string,{x:number,y:number}>>} */
export async function autoLayout(schema) {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const names = new Set(schema.tables.map((t) => t.name))
  const edges = deriveRelations(schema).filter((r) => r.from.table !== r.to.table && names.has(r.from.table) && names.has(r.to.table))
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.edgeRouting': 'POLYLINE',
    },
    children: schema.tables.map((t) => ({ id: t.name, width: NODE_WIDTH, height: tableHeight(t) })),
    edges: edges.map((r, i) => ({ id: `e${i}`, sources: [r.from.table], targets: [r.to.table] })),
  }
  const res = await elk.layout(graph)
  const out = {}
  for (const c of res.children ?? []) out[c.id] = { x: Math.round(c.x), y: Math.round(c.y) }
  return out
}
