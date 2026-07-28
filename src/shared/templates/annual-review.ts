import type { ProjectTemplateDefinition } from './template-types.js'

export const annualReviewTemplate: ProjectTemplateDefinition = {
  id: 'annual-review',
  name: '年度考核成果材料',
  description: '适用于年度考核、岗位考核和绩效材料整理。',
  nodes: [
    { title: '岗位履职', children: ['年度工作', '公共事务'] },
    { title: '教学成果', children: ['教学任务', '教学成效'] },
    { title: '科研成果', children: ['论文与著作', '项目与知识产权'] },
    { title: '奖励与服务', children: ['获奖成果', '社会服务'] },
    { title: '其他材料', children: ['补充材料'] },
  ],
}
