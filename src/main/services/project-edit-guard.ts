import type { Material, MaterialSource, Project } from '../../shared/schemas/project-schema.js'

const allMaterials = (project: Project): Material[] =>
  project.outlineNodes.flatMap((node) => node.children.flatMap((child) => child.materials))

const sourceSignature = (source: MaterialSource): string =>
  JSON.stringify({
    id: source.id,
    sourcePath: source.sourcePath,
    storedPath: source.storedPath,
    originalFileName: source.originalFileName,
    fileHash: source.fileHash,
    fileSize: source.fileSize,
    modifiedTime: source.modifiedTime,
    mimeType: source.mimeType,
    pageCount: source.pageCount,
    width: source.width ?? null,
    height: source.height ?? null,
    exifOrientation: source.exifOrientation ?? null,
    conversion: source.conversion ?? null,
  })

const materialSourceSignature = (material: Material): string =>
  JSON.stringify({
    id: material.id,
    sourceType: material.sourceType,
    sourcePath: material.sourcePath,
    storedPath: material.storedPath,
    originalFileName: material.originalFileName,
    fileHash: material.fileHash,
    fileSize: material.fileSize,
    modifiedTime: material.modifiedTime,
    pageCount: material.pageCount,
    sources: material.sourceItems.map(sourceSignature),
  })

/**
 * Renderer 可以编辑结构化项目配置，但不能借此注入任意本地路径。
 * 新增和替换来源文件只能由主进程的导入服务完成。
 */
export const assertProjectFileReferencesUnchanged = (current: Project, incoming: Project): void => {
  const currentMaterials = new Map(allMaterials(current).map((material) => [material.id, material]))
  for (const material of allMaterials(incoming)) {
    const currentMaterial = currentMaterials.get(material.id)
    if (
      !currentMaterial ||
      materialSourceSignature(currentMaterial) !== materialSourceSignature(material)
    ) {
      throw new Error('来源文件元数据不得由界面直接修改，请使用导入、替换或重新定位功能。')
    }
  }
}
