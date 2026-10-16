/** Original, synthetic fixtures frozen independently of the separate randomized boundary tests. */
export interface EvidenceFixture {
  id: string
  question: string
  kind: 'fact' | 'compare' | 'absent' | 'long' | 'budget' | 'overview' | 'citation'
  documents: string[]
  expectedText?: string
  expectedFiles?: number
  citationMode?: 'valid' | 'forged' | 'missing' | 'duplicate-name' | 'unicode'
}

export const EVIDENCE_FIXTURES: EvidenceFixture[] = [
  {
    id: 'fact-01',
    kind: 'fact',
    question: '项目代号是什么',
    documents: ['项目代号是什么：晨星。负责人林青。'],
    expectedText: '晨星'
  },
  {
    id: 'fact-02',
    kind: 'fact',
    question: '合同付款条件',
    documents: ['合同付款条件：验收后十五日内支付。'],
    expectedText: '十五日'
  },
  {
    id: 'fact-03',
    kind: 'fact',
    question: '实验温度记录',
    documents: ['实验温度记录：二十五摄氏度。'],
    expectedText: '二十五'
  },
  {
    id: 'fact-04',
    kind: 'fact',
    question: '数据库备份频率',
    documents: ['数据库备份频率：每天一次，每周恢复测试。'],
    expectedText: '每天一次'
  },
  {
    id: 'fact-05',
    kind: 'fact',
    question: '课程复习规则',
    documents: ['课程复习规则：答错题目须重新作答。'],
    expectedText: '重新作答'
  },
  {
    id: 'fact-06',
    kind: 'fact',
    question: 'deployment region',
    documents: ['deployment region: Tokyo; standby region: Osaka.'],
    expectedText: 'Tokyo'
  },
  {
    id: 'fact-07',
    kind: 'fact',
    question: 'upload size limit',
    documents: ['upload size limit is 12 MB for the synthetic project.'],
    expectedText: '12 MB'
  },
  {
    id: 'fact-08',
    kind: 'fact',
    question: 'retry policy',
    documents: ['retry policy: maximum two attempts, never retry a charged completed task.'],
    expectedText: 'two attempts'
  },
  {
    id: 'fact-09',
    kind: 'fact',
    question: 'cache expiration',
    documents: ['cache expiration is 600 seconds.'],
    expectedText: '600 seconds'
  },
  {
    id: 'fact-10',
    kind: 'fact',
    question: 'support contact',
    documents: ['support contact is the internal service desk, not a personal phone.'],
    expectedText: 'service desk'
  },
  {
    id: 'compare-01',
    kind: 'compare',
    question: '付款到期时间',
    documents: ['付款到期时间：十日。', '付款到期时间：二十日。'],
    expectedFiles: 2
  },
  {
    id: 'compare-02',
    kind: 'compare',
    question: 'retention duration',
    documents: ['retention duration: 30 days.', 'retention duration: 90 days.'],
    expectedFiles: 2
  },
  {
    id: 'compare-03',
    kind: 'compare',
    question: '交付日期规定',
    documents: ['交付日期规定：六月一日。', '交付日期规定：六月十日。'],
    expectedFiles: 2
  },
  {
    id: 'compare-04',
    kind: 'compare',
    question: 'max concurrency',
    documents: ['max concurrency: 2.', 'max concurrency: 4.'],
    expectedFiles: 2
  },
  {
    id: 'compare-05',
    kind: 'compare',
    question: '学习计划差异',
    documents: ['学习计划差异：周末两小时。', '学习计划差异：每天一小时。'],
    expectedFiles: 2
  },
  {
    id: 'compare-06',
    kind: 'compare',
    question: 'warranty period',
    documents: ['warranty period: one year.', 'warranty period: two years.'],
    expectedFiles: 2
  },
  {
    id: 'absent-01',
    kind: 'absent',
    question: 'xenobiology protocol',
    documents: ['The document describes sorting algorithms.']
  },
  {
    id: 'absent-02',
    kind: 'absent',
    question: '火星基地密码',
    documents: ['这是普通的采购清单：纸张、订书机。']
  },
  {
    id: 'absent-03',
    kind: 'absent',
    question: 'quantum entanglement threshold',
    documents: ['Weekly chores: clean windows and wash dishes.']
  },
  {
    id: 'absent-04',
    kind: 'absent',
    question: '航天燃料配方',
    documents: ['文本只介绍了花盆尺寸。']
  },
  { id: 'absent-05', kind: 'absent', question: 'volcano evacuation codes', documents: [''] },
  {
    id: 'long-01',
    kind: 'long',
    question: 'critical sentinel delta',
    documents: [
      'Routine filler without relevant facts.\n'.repeat(220) +
        '\ncritical sentinel delta: final appendix.'
    ],
    expectedText: 'final appendix'
  },
  {
    id: 'long-02',
    kind: 'long',
    question: '跨段预算说明',
    documents: ['普通背景介绍。\n'.repeat(600) + '\r\n跨段预算说明：上限四十八。\r\n'],
    expectedText: '四十八'
  },
  {
    id: 'budget-01',
    kind: 'budget',
    question: 'resource allocation',
    documents: ['resource allocation: detailed settings.\n'.repeat(100)]
  },
  {
    id: 'overview-01',
    kind: 'overview',
    question: '概览多个文件的内容',
    documents: ['开篇：计划目标。', '末尾：结果与局限。'],
    expectedFiles: 2
  },
  {
    id: 'citation-01',
    kind: 'citation',
    question: '引用是否来自当前资料',
    documents: ['证据标记验证。'],
    citationMode: 'valid'
  },
  {
    id: 'citation-02',
    kind: 'citation',
    question: '能否伪造其他账号引用',
    documents: ['禁止伪造来源。'],
    citationMode: 'forged'
  },
  {
    id: 'citation-03',
    kind: 'citation',
    question: '没有引用能否视为已核验',
    documents: ['引用缺失须显式指出。'],
    citationMode: 'missing'
  },
  {
    id: 'citation-04',
    kind: 'citation',
    question: '同名文件是否混淆来源',
    documents: ['版本一。', '版本二。'],
    citationMode: 'duplicate-name'
  },
  {
    id: 'citation-05',
    kind: 'citation',
    question: '换行与表情原文位置是否准确',
    documents: ['  中文😀\r\n第二行\n é'],
    citationMode: 'unicode'
  }
]
