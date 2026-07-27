export type OutlineTemplateNode = {
  title: string
  children: string[]
}

export type ProjectTemplateDefinition = {
  id: string
  name: string
  description: string
  nodes: OutlineTemplateNode[]
}
