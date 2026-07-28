import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { openPromise } from 'yauzl'
import { ZipFile } from 'yazl'

const safeArchivePath = (name: string): string => {
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new Error(`XLSX 包含不安全路径“${name}”。`)
  }
  const normalized = posix.normalize(name)
  if (
    normalized !== name ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    isAbsolute(normalized)
  ) {
    throw new Error(`XLSX 包含目录穿越路径“${name}”。`)
  }
  return normalized
}

const patchWorksheetXml = (xml: string): string => {
  if (/<pageSetup\b/.test(xml)) return xml
  let patched = xml
  if (!/<pageSetUpPr\b/.test(patched)) {
    if (/<sheetPr\b[^>]*\/>/.test(patched)) {
      patched = patched.replace(
        /<sheetPr\b([^>]*)\/>/,
        '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>',
      )
    } else if (/<sheetPr\b[^>]*>/.test(patched)) {
      patched = patched.replace(/<sheetPr\b([^>]*)>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/>')
    } else {
      patched = patched.replace(
        /(<worksheet\b[^>]*>)/,
        '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
      )
    }
  }

  const settings = `${
    /<pageMargins\b/.test(patched)
      ? ''
      : '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
  }<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>`
  const insertionTarget =
    /<(?:headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|drawing|legacyDrawing|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/
  if (insertionTarget.test(patched)) return patched.replace(insertionTarget, `${settings}$&`)
  return patched.replace('</worksheet>', `${settings}</worksheet>`)
}

const addDirectoryToZip = async (
  zip: ZipFile,
  rootDirectory: string,
  currentDirectory = rootDirectory,
): Promise<void> => {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(currentDirectory, entry.name)
    const archivePath = relative(rootDirectory, path).split('\\').join('/')
    if (entry.isSymbolicLink()) throw new Error(`XLSX 临时目录包含符号链接“${archivePath}”。`)
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, rootDirectory, path)
    } else if (entry.isFile()) {
      zip.addFile(path, archivePath, { mode: 0o100600 })
    }
  }
}

export const ensureXlsxPrintSettings = async (
  sourcePath: string,
  outputPath: string,
): Promise<void> => {
  const extractionDirectory = `${outputPath}.parts-${crypto.randomUUID()}`
  await mkdir(extractionDirectory, { recursive: false })
  const archive = await openPromise(sourcePath, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  try {
    for await (const entry of archive.eachEntry()) {
      const archivePath = safeArchivePath(entry.fileName)
      const destination = resolve(extractionDirectory, archivePath)
      const destinationRelative = relative(extractionDirectory, destination)
      if (destinationRelative.startsWith('..') || isAbsolute(destinationRelative)) {
        throw new Error(`XLSX 条目“${archivePath}”的目标路径越界。`)
      }
      if (archivePath.endsWith('/')) {
        await mkdir(destination, { recursive: true })
        continue
      }
      await mkdir(dirname(destination), { recursive: true })
      const input = await archive.openReadStreamPromise(entry)
      await pipeline(input, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
    }
  } finally {
    archive.close()
  }

  try {
    const worksheetDirectory = join(extractionDirectory, 'xl', 'worksheets')
    const worksheetEntries = await readdir(worksheetDirectory, { withFileTypes: true })
    let changed = false
    for (const entry of worksheetEntries) {
      if (!entry.isFile() || !/^sheet\d+\.xml$/i.test(entry.name)) continue
      const path = join(worksheetDirectory, entry.name)
      const xml = await readFile(path, 'utf8')
      const patched = patchWorksheetXml(xml)
      if (patched !== xml) {
        await writeFile(path, patched, 'utf8')
        changed = true
      }
    }
    if (!changed) {
      await copyFile(sourcePath, outputPath)
      return
    }
    const zip = new ZipFile()
    await addDirectoryToZip(zip, extractionDirectory)
    const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })
    const completed = pipeline(zip.outputStream, output)
    zip.end()
    await completed
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
