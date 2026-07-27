import type { ProjectTemplateDefinition } from './template-types.js'

export const titleApplicationTemplate: ProjectTemplateDefinition = {
  id: 'title-application',
  name: '职称申报支撑材料',
  description: '适用于高校和专业技术人员职称评审材料整理。',
  nodes: [
    { title: '一、基本资格材料', children: ['学历与学位', '任职资格与聘任材料'] },
    { title: '二、教育教学成果', children: ['教学工作', '教学研究与改革'] },
    { title: '三、科研论文', children: ['第一作者论文', '其他代表性论文'] },
    { title: '四、知识产权', children: ['发明专利', '软件著作权'] },
    { title: '五、科研项目', children: ['主持项目', '参与项目'] },
    { title: '六、获奖成果', children: ['科研奖励', '教学奖励'] },
    { title: '七、社会服务', children: ['学术服务', '行业与社会服务'] },
    { title: '八、其他材料', children: ['其他支撑材料'] },
  ],
}
