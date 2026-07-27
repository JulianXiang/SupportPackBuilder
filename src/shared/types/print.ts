import type { TargetOrientation } from '../schemas/project-schema.js'
import type { TocEntry } from '../schemas/page-plan-schema.js'

export type PrintCoverPayload = {
  kind: 'cover'
  orientation: TargetOrientation
  title: string
  ownerName: string
  organization: string
  purpose: string
  compiledDate: string
}

export type PrintTocPayload = {
  kind: 'toc'
  orientation: TargetOrientation
  title: string
  entries: TocEntry[]
}

export type PrintTitlePage = {
  id: string
  kind: 'divider' | 'materialTitle'
  sequenceLabel?: string
  title: string
  category?: string
  notes?: string
}

export type PrintTitlesPayload = {
  kind: 'titles'
  orientation: TargetOrientation
  pages: PrintTitlePage[]
}

export type PrintPayload = PrintCoverPayload | PrintTocPayload | PrintTitlesPayload
