/**
 * Tiny .xlsx reader (zip + XML) - enough for plain tables: returns [{ name, rows: string[][] }].
 * Handles shared strings, inline strings and numbers; ignores formatting and formulas' cached values only.
 */
export async function readXlsx(buffer) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const xml = async (path) => {
    const f = zip.file(path)
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null
  }
  const all = (doc, tag) => Array.from(doc.getElementsByTagNameNS('*', tag))

  const workbook = await xml('xl/workbook.xml')
  if (!workbook) throw new Error('Not a valid .xlsx file')
  const rels = await xml('xl/_rels/workbook.xml.rels')
  const relTarget = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]))

  const shared = []
  const sst = await xml('xl/sharedStrings.xml')
  if (sst) for (const si of all(sst, 'si')) shared.push(all(si, 't').map((t) => t.textContent).join(''))

  const colIndex = (ref) => {
    const letters = ref.match(/^[A-Z]+/)[0]
    let n = 0
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }

  const sheets = []
  for (const s of all(workbook, 'sheet')) {
    const hidden = s.getAttribute('state')
    if (hidden === 'hidden' || hidden === 'veryHidden') continue
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id')
    let target = relTarget.get(rid)
    if (!target) continue
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.?\//, '')}`
    const doc = await xml(target)
    if (!doc) continue
    const rows = []
    for (const row of all(doc, 'row')) {
      const out = []
      for (const c of all(row, 'c')) {
        const ref = c.getAttribute('r')
        const idx = ref ? colIndex(ref) : out.length
        const t = c.getAttribute('t')
        let value = ''
        if (t === 's') value = shared[Number(c.getElementsByTagNameNS('*', 'v')[0]?.textContent)] ?? ''
        else if (t === 'b') value = c.getElementsByTagNameNS('*', 'v')[0]?.textContent === '1' ? 'true' : 'false'
        else if (t === 'inlineStr') value = all(c, 't').map((x) => x.textContent).join('')
        else value = c.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? ''
        while (out.length < idx) out.push('')
        out[idx] = value
      }
      rows.push(out)
    }
    while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
    sheets.push({ name: s.getAttribute('name'), rows })
  }
  return sheets
}
