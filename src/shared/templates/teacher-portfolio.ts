import type { ProjectTemplateDefinition } from './template-types.js'

export const teacherPortfolioTemplate: ProjectTemplateDefinition = {
  id: 'teacher-portfolio',
  name: '教师个人成果汇编',
  description: '适用于教师个人教学、科研和社会服务成果归档。',
  nodes: [
    { title: '一、个人简介', children: ['基本信息', '学习与工作经历'] },
    { title: '二、教育教学', children: ['课程教学', '教学建设'] },
    { title: '三、科学研究', children: ['论文著作', '科研项目'] },
    { title: '四、知识产权', children: ['专利', '软件著作权'] },
    { title: '五、奖励与荣誉', children: ['奖励证书', '荣誉称号'] },
    { title: '六、社会服务', children: ['学术兼职', '咨询与服务'] },
  ],
}
