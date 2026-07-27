import ElectronStore from 'electron-store'

export type RecentProject = {
  projectDirectory: string
  title: string
  lastOpenedAt: string
}

type RecentProjectStore = {
  projects: RecentProject[]
}

const Store =
  typeof ElectronStore === 'function'
    ? ElectronStore
    : (ElectronStore as unknown as { default: typeof ElectronStore }).default

export class RecentProjectService {
  readonly #store = new Store<RecentProjectStore>({
    name: 'recent-projects',
    defaults: {
      projects: [],
    },
  })

  list(): RecentProject[] {
    return this.#store.get('projects')
  }

  add(project: RecentProject): void {
    const projects = this.list().filter(
      (candidate) => candidate.projectDirectory !== project.projectDirectory,
    )
    projects.unshift(project)
    this.#store.set('projects', projects.slice(0, 12))
  }

  remove(projectDirectory: string): void {
    this.#store.set(
      'projects',
      this.list().filter((project) => project.projectDirectory !== projectDirectory),
    )
  }
}
