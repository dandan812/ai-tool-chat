import * as XLSX from 'xlsx'

export function zipDocument(parts) {
  const archive = XLSX.CFB.utils.cfb_new()
  for (const [name, text] of Object.entries(parts)) {
    XLSX.CFB.utils.cfb_add(archive, name, Buffer.from(text))
  }
  return XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true })
}

export function docxDocument(body = 'Synthetic contract: delivery in 15 days.') {
  const xml = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return zipDocument({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml
      .split('\n')
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
    'word/header1.xml':
      '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Synthetic header</w:t></w:r></w:p></w:hdr>'
  })
}

export function docDocument(body = 'Synthetic legacy contract.', encrypted = false) {
  // Minimal Word 97 compound document with one UTF-16 text piece.
  const text = body + '\r'
  const fib = Buffer.alloc(512)
  fib.writeUInt16LE(0xa5ec)
  fib.writeUInt16LE(0x00c1, 2)
  fib.writeUInt16LE(0x0204 | (encrypted ? 0x0100 : 0), 10)
  fib.writeUInt32LE(512, 0x18)
  fib.writeUInt32LE(512 + text.length * 2, 0x1c)
  fib.writeUInt32LE(text.length, 0x4c)
  fib.writeUInt32LE(21, 0x1a6)
  const table = Buffer.alloc(21)
  table[0] = 2
  table.writeUInt32LE(16, 1)
  table.writeUInt32LE(text.length, 9)
  table.writeUInt32LE(512, 15)
  const compound = XLSX.CFB.utils.cfb_new()
  XLSX.CFB.utils.cfb_add(
    compound,
    'WordDocument',
    Buffer.concat([fib, Buffer.from(text, 'utf16le')])
  )
  XLSX.CFB.utils.cfb_add(compound, '1Table', table)
  return XLSX.CFB.write(compound, { type: 'buffer' })
}

export function spreadsheetDocument(
  type = 'xlsx',
  sheets = {
    Revenue: [
      ['Product', 'Amount'],
      ['Widget', 1234.5]
    ],
    Notes: [
      ['负责人', '林青'],
      ['交付期限', '十五日']
    ]
  }
) {
  const book = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return XLSX.write(book, { type: 'buffer', bookType: type })
}

export function pdfDocument(
  pages = ['Synthetic contract: delivery in 15 days.'],
  encrypted = false,
  unicode = false
) {
  const font = unicode
    ? `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UTF16-H /DescendantFonts [${4 + pages.length * 2} 0 R] >>`
    : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  const objects = ['', '', font]
  const kids = []
  for (const text of pages) {
    const pageId = objects.length + 1
    const contentId = pageId + 1
    kids.push(`${pageId} 0 R`)
    const literal = unicode
      ? '<' + Buffer.from(text, 'utf16le').swap16().toString('hex') + '>'
      : '(' + text.replace(/[\\()]/g, '\\$&') + ')'
    const content = text ? `BT /F1 12 Tf 50 750 Td ${literal} Tj ET` : ''
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    )
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`
  if (unicode) {
    objects.push(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 /FontDescriptor ${objects.length + 2} 0 R >>`,
      '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>'
    )
  }
  let encryption = ''
  if (encrypted) {
    objects.push(
      '<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <' +
        '00'.repeat(32) +
        '> /U <' +
        '00'.repeat(32) +
        '> >>'
    )
    encryption = ` /Encrypt ${objects.length} 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>]`
  }
  let source = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}
