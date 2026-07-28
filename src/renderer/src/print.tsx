import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PrintPayload, PrintTitlePage } from '../../shared/types/print.js'
import './print.css'

const formatDate = (value: string): string => {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${year} 年 ${Number(month)} 月 ${Number(day)} 日` : value
}

const Cover = ({ payload }: { payload: Extract<PrintPayload, { kind: 'cover' }> }) => (
  <section className={`print-page cover-page ${payload.orientation}`}>
    <h1>{payload.title}</h1>
    <div className="cover-information">
      {payload.ownerName ? (
        <p>
          <span>{'姓\u3000\u3000名'}</span>
          <strong>{payload.ownerName}</strong>
        </p>
      ) : null}
      {payload.organization ? (
        <p>
          <span>所属单位</span>
          <strong>{payload.organization}</strong>
        </p>
      ) : null}
      {payload.purpose ? (
        <p>
          <span>材料用途</span>
          <strong>{payload.purpose}</strong>
        </p>
      ) : null}
    </div>
    <time>{formatDate(payload.compiledDate)}</time>
  </section>
)

const Toc = ({ payload }: { payload: Extract<PrintPayload, { kind: 'toc' }> }) => (
  <main className={`toc-document ${payload.orientation}`}>
    <h1>{payload.title}</h1>
    <ol className="toc-list">
      {payload.entries.map((entry) => (
        <li className={`toc-entry level-${entry.level}`} key={entry.id}>
          <span className="toc-title">{entry.displayText}</span>
          <span className="toc-dots" aria-hidden="true" />
          <span className="toc-page-number">{entry.logicalPageNumber}</span>
        </li>
      ))}
    </ol>
  </main>
)

const TitlePage = ({ page, orientation }: { page: PrintTitlePage; orientation: string }) => (
  <section className={`print-page title-page ${orientation}`}>
    {page.sequenceLabel ? <div className="title-sequence">{page.sequenceLabel}</div> : null}
    <h1>{page.title}</h1>
    {page.category ? <p className="title-category">{page.category}</p> : null}
    {page.notes ? <p className="title-notes">{page.notes}</p> : null}
  </section>
)

const PrintApp = () => {
  const [payload, setPayload] = useState<PrintPayload | null>(null)

  useEffect(() => {
    void window.printBridge.getPayload().then(setPayload)
  }, [])

  useEffect(() => {
    if (!payload) return
    document.documentElement.dataset.orientation = payload.orientation
    void document.fonts.ready.then(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      window.printBridge.ready()
    })
  }, [payload])

  if (!payload) return null
  if (payload.kind === 'cover') return <Cover payload={payload} />
  if (payload.kind === 'toc') return <Toc payload={payload} />
  return (
    <>
      {payload.pages.map((page) => (
        <TitlePage key={page.id} page={page} orientation={payload.orientation} />
      ))}
    </>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('打印页面根节点不存在。')

createRoot(rootElement).render(
  <StrictMode>
    <PrintApp />
  </StrictMode>,
)
