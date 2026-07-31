import {
  createDefaultProject,
  type Material,
  type MaterialSource,
  type OutlineNode,
  type Project,
} from '../../src/shared/schemas/project-schema.js'

export const IDS = {
  project: '00000000-0000-4000-8000-000000000001',
  level1: '00000000-0000-4000-8000-000000000002',
  level2: '00000000-0000-4000-8000-000000000003',
  material: '00000000-0000-4000-8000-000000000004',
  source: '00000000-0000-4000-8000-000000000005',
} as const

export const createSourceFixture = (overrides: Partial<MaterialSource> = {}): MaterialSource => ({
  id: IDS.source,
  sourceType: 'pdf',
  sourcePath: '/tmp/source.pdf',
  storedPath: 'assets/source.pdf',
  originalFileName: 'source.pdf',
  fileHash: 'a'.repeat(64),
  fileSize: 1024,
  modifiedTime: 1_700_000_000_000,
  mimeType: 'application/pdf',
  pageCount: 3,
  selectedPageRanges: 'all',
  ...overrides,
})

export const createMaterialFixture = (overrides: Partial<Material> = {}): Material => {
  const source = createSourceFixture()
  return {
    id: IDS.material,
    outlineNodeId: IDS.level2,
    title: '测试材料',
    category: '论文',
    sourceType: 'pdf',
    sourcePath: source.sourcePath,
    storedPath: source.storedPath,
    originalFileName: source.originalFileName,
    fileHash: source.fileHash,
    fileSize: source.fileSize,
    modifiedTime: source.modifiedTime,
    pageCount: source.pageCount,
    selectedPageRanges: 'all',
    pageOrder: [],
    rotationByPage: {},
    removedPages: [],
    enabled: true,
    startPolicy: 'newSheet',
    insertTitlePage: false,
    notes: '',
    validationStatus: 'valid',
    validationMessages: [],
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourceItems: [source],
    ...overrides,
  }
}

export const createOutlineFixture = (material = createMaterialFixture()): OutlineNode[] => [
  {
    id: IDS.level1,
    parentId: null,
    level: 1,
    title: '论文成果',
    order: 0,
    enabled: true,
    insertDividerPage: true,
    materials: [],
    children: [
      {
        id: IDS.level2,
        parentId: IDS.level1,
        level: 2,
        title: '第一作者论文',
        order: 0,
        enabled: true,
        insertDividerPage: false,
        materials: [material],
        children: [],
      },
    ],
  },
]

export const createProjectFixture = (overrides: Partial<Project> = {}): Project => {
  const project = createDefaultProject(
    {
      title: '2026 年度个人成果支撑材料',
      ownerName: '张老师',
      organization: '示例大学',
      outlineNodes: createOutlineFixture(),
    },
    new Date('2026-01-01T00:00:00.000Z'),
  )
  return {
    ...project,
    id: IDS.project,
    ...overrides,
  }
}
