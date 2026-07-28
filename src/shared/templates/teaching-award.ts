import type { ProjectTemplateDefinition } from './template-types.js'

export const teachingAwardTemplate: ProjectTemplateDefinition = {
  id: 'teaching-award',
  name: '教学成果奖支撑材料',
  description: '适用于教学成果奖申报和成果证明材料汇编。',
  nodes: [
    { title: '成果概述', children: ['成果简介', '成果形成过程'] },
    { title: '教学改革', children: ['课程建设', '教材与资源建设'] },
    { title: '应用成效', children: ['学生成效', '推广应用'] },
    { title: '评价与奖励', children: ['同行评价', '获奖证明'] },
    { title: '其他材料', children: ['补充证明'] },
  ],
}
