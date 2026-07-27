import { create } from 'zustand'
import type { ProjectSessionView } from '../../../preload/api-types.js'
import type { PagePlan } from '../../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../../shared/schemas/project-schema.js'

export type Selection =
  | { kind: 'project'; id: string }
  | { kind: 'outline'; id: string }
  | { kind: 'material'; id: string }
  | { kind: 'page'; id: string }

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

type ProjectStore = {
  project: Project | null
  projectDirectory: string | null
  revision: number
  dirty: boolean
  saveStatus: SaveStatus
  saveError: string | null
  pagePlan: PagePlan | null
  planLoading: boolean
  selection: Selection | null
  selectedPageIds: string[]
  past: Project[]
  future: Project[]
  setSession: (session: ProjectSessionView) => void
  clearSession: () => void
  mutateProject: (mutator: (draft: Project) => void, selection?: Selection) => void
  replaceProjectFromMain: (project: Project, revision: number, markDirty: boolean) => void
  applySavedSession: (session: ProjectSessionView) => void
  setSaveStatus: (status: SaveStatus, error?: string | null) => void
  setPagePlan: (plan: PagePlan) => void
  setPlanLoading: (loading: boolean) => void
  setSelection: (selection: Selection | null) => void
  setSelectedPageIds: (ids: string[]) => void
  undo: () => void
  redo: () => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  projectDirectory: null,
  revision: 0,
  dirty: false,
  saveStatus: 'idle',
  saveError: null,
  pagePlan: null,
  planLoading: false,
  selection: null,
  selectedPageIds: [],
  past: [],
  future: [],
  setSession: (session) =>
    set({
      project: session.project,
      projectDirectory: session.projectDirectory,
      revision: session.revision,
      dirty: false,
      saveStatus: 'saved',
      saveError: null,
      pagePlan: null,
      selection: { kind: 'project', id: session.project.id },
      selectedPageIds: [],
      past: [],
      future: [],
    }),
  clearSession: () =>
    set({
      project: null,
      projectDirectory: null,
      revision: 0,
      dirty: false,
      saveStatus: 'idle',
      pagePlan: null,
      selection: null,
      selectedPageIds: [],
      past: [],
      future: [],
    }),
  mutateProject: (mutator, selection) => {
    const current = get().project
    if (!current) return
    const next = structuredClone(current)
    mutator(next)
    next.updatedAt = new Date().toISOString()
    set((state) => ({
      project: next,
      revision: state.revision + 1,
      dirty: true,
      saveStatus: 'dirty',
      saveError: null,
      pagePlan: state.pagePlan,
      selection: selection ?? state.selection,
      past: [...state.past.slice(-49), current],
      future: [],
    }))
  },
  replaceProjectFromMain: (project, revision, markDirty) => {
    const current = get().project
    set((state) => ({
      project,
      revision,
      dirty: markDirty,
      saveStatus: markDirty ? 'dirty' : 'saved',
      past: current ? [...state.past.slice(-49), current] : state.past,
      future: [],
    }))
  },
  applySavedSession: (session) => {
    if (get().revision !== session.revision) return
    set({
      project: session.project,
      projectDirectory: session.projectDirectory,
      dirty: false,
      saveStatus: 'saved',
      saveError: null,
    })
  },
  setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  setPagePlan: (pagePlan) => set({ pagePlan, planLoading: false }),
  setPlanLoading: (planLoading) => set({ planLoading }),
  setSelection: (selection) => set({ selection }),
  setSelectedPageIds: (selectedPageIds) => set({ selectedPageIds }),
  undo: () => {
    const { project, past } = get()
    const previous = past.at(-1)
    if (!project || !previous) return
    set((state) => ({
      project: previous,
      revision: state.revision + 1,
      dirty: true,
      saveStatus: 'dirty',
      past: state.past.slice(0, -1),
      future: [project, ...state.future].slice(0, 50),
    }))
  },
  redo: () => {
    const { project, future } = get()
    const next = future[0]
    if (!project || !next) return
    set((state) => ({
      project: next,
      revision: state.revision + 1,
      dirty: true,
      saveStatus: 'dirty',
      past: [...state.past.slice(-49), project],
      future: state.future.slice(1),
    }))
  },
}))
