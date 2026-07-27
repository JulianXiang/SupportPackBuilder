import type { ProjectTemplateDefinition } from './template-types.js'

export const researchProjectTemplate: ProjectTemplateDefinition = {
  id: 'research-project',
  name: '科研项目申报材料',
  description: '适用于科研项目申请、任务书和前期成果支撑材料。',
  nodes: [
    { title: '一、申请人资质', children: ['个人资质', '团队成员资质'] },
    { title: '二、前期研究基础', children: ['代表性论文', '知识产权'] },
    { title: '三、在研与完成项目', children: ['主持项目', '参与项目'] },
    { title: '四、条件与平台', children: ['实验条件', '协作单位'] },
    { title: '五、其他附件', children: ['证明文件', '其他材料'] },
  ],
}
