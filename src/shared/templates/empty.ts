import type { ProjectTemplateDefinition } from './template-types.js'

export const emptyTemplate: ProjectTemplateDefinition = {
  id: 'empty',
  name: '自定义空白模板',
  description: '创建不含预设目录的空白项目。',
  nodes: [],
}
