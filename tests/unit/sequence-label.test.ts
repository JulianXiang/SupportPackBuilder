import { describe, expect, it } from 'vitest'
import {
  formatChineseSequenceNumber,
  formatSequenceLabel,
  formatSequencedTitle,
  stripSequencePrefix,
} from '../../src/shared/utils/sequence-label.js'

describe('三级自动编号', () => {
  it('生成中文一级、中文括号二级和阿拉伯数字材料序号', () => {
    expect(formatSequenceLabel(1, 0)).toBe('一、')
    expect(formatSequenceLabel(2, 1)).toBe('（二）')
    expect(formatSequenceLabel(3, 9)).toBe('10.')
  })

  it('正确显示十以上中文序号', () => {
    expect(formatChineseSequenceNumber(10)).toBe('十')
    expect(formatChineseSequenceNumber(11)).toBe('十一')
    expect(formatChineseSequenceNumber(20)).toBe('二十')
    expect(formatChineseSequenceNumber(105)).toBe('一百零五')
  })

  it('为不同层级拼接规范显示文本', () => {
    expect(formatSequencedTitle('一、', '论文成果')).toBe('一、论文成果')
    expect(formatSequencedTitle('（一）', '第一作者论文')).toBe('（一） 第一作者论文')
    expect(formatSequencedTitle('1.', '测试材料')).toBe('1. 测试材料')
  })

  it('迁移时只清理可识别的层级前缀', () => {
    expect(stripSequencePrefix('一、论文成果', 1)).toBe('论文成果')
    expect(stripSequencePrefix('（十二） 教学成果', 2)).toBe('教学成果')
    expect(stripSequencePrefix('10. 发明专利', 3)).toBe('发明专利')
    expect(stripSequencePrefix('AI 2.0 教学改革', 3)).toBe('AI 2.0 教学改革')
  })

  it('拒绝非法序号索引', () => {
    expect(() => formatSequenceLabel(1, -1)).toThrow('非负整数')
    expect(() => formatChineseSequenceNumber(0)).toThrow('正整数')
  })
})
