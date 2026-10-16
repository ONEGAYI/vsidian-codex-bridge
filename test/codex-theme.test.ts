// Codex 色板与配置契约（票 #3）：迁移自 vsidian 内核 src/webview/mermaidTheme.ts
// 的 buildCodexMermaidConfig——迁移口径是「逐值拷贝」，期望值直接从上游
// 源码（origin/main@301d2c16）抄写，与被测实现对拍。任何一处色值、CSS
// 行、布局参数漂移都视为迁移回归。上游实现签名：
//   buildCodexMermaidConfig(type = 'flowchart', dark = false)
// 六类图型分支的 themeVariables 不依赖 type（仅 state 的 themeCSS 追加
// marker 行），期望对象按亮暗各写一份全量，逐类型调用对拍。
import { describe, expect, it } from 'vitest'
import { buildCodexMermaidConfig } from '../src/codex/theme'

const FONT = 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'

/** 六类图型白名单（与上游一致；detectType 实际返回这些 id） */
const SIX_DIAGRAM_TYPES = [
  'sequence',
  'class',
  'classDiagram',
  'state',
  'stateDiagram',
  'er',
  'gantt',
  'pie',
] as const

describe('buildCodexMermaidConfig：流程图分支（ELK 布局）', () => {
  it('暗色：themeVariables / flowchart / elk / themeCSS 逐值一致', () => {
    const config = buildCodexMermaidConfig('flowchart', true)
    expect(config).toBeDefined()
    expect(config!.theme).toBe('base')
    expect(config!.layout).toBe('elk')
    expect(config!.htmlLabels).toBe(false)
    expect(config!.themeVariables).toEqual({
      darkMode: true,
      primaryColor: '#1a283d',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#b8b9ba',
      secondaryColor: '#22344f',
      tertiaryColor: '#22344f',
      lineColor: '#b8b9ba',
      textColor: '#ffffff',
      fontSize: '14px',
      fontFamily: FONT,
      edgeLabelBackground: 'transparent',
      clusterBkg: '#22344f',
      clusterBorder: '#b8b9ba',
    })
    // ELK 布局契约：声明顺序约束（considerModelOrder + forceNodeModelOrder）
    // 与 LINEAR_SEGMENTS 节点排布、不合边——ELK 迁移的核心参数组
    expect(config!.elk).toEqual({
      nodePlacementStrategy: 'LINEAR_SEGMENTS',
      mergeEdges: false,
      considerModelOrder: 'NODES_AND_EDGES',
      forceNodeModelOrder: true,
    })
    expect(config!.flowchart).toEqual({
      htmlLabels: false,
      useMaxWidth: false,
      padding: 16,
      wrappingWidth: 320,
      curve: 'linear',
      nodeSpacing: 40,
      rankSpacing: 40,
    })
    expect(config!.themeCSS).toBe(
      '& { background-color:#181818; }\n' +
        '.node rect.label-container { rx:16px; ry:16px; stroke-width:1px; }\n' +
        '.node polygon.label-container { fill:#22344f; }\n' +
        '.node .label, .edgeLabel { font-weight:600; }\n' +
        '.flowchart-link { stroke-linecap:round; stroke-linejoin:round; }',
    )
  })

  it('亮色：themeVariables / themeCSS 逐值一致', () => {
    const config = buildCodexMermaidConfig('flowchart', false)
    expect(config).toBeDefined()
    expect(config!.theme).toBe('base')
    expect(config!.layout).toBe('elk')
    expect(config!.themeVariables).toEqual({
      darkMode: false,
      primaryColor: '#e5f3ff',
      primaryTextColor: '#004f99',
      primaryBorderColor: '#b8b9ba',
      secondaryColor: '#f5faff',
      tertiaryColor: '#f5faff',
      lineColor: '#b8b9ba',
      textColor: '#004f99',
      fontSize: '14px',
      fontFamily: FONT,
      edgeLabelBackground: 'transparent',
      clusterBkg: '#f5faff',
      clusterBorder: '#b8b9ba',
    })
    expect(config!.elk).toEqual({
      nodePlacementStrategy: 'LINEAR_SEGMENTS',
      mergeEdges: false,
      considerModelOrder: 'NODES_AND_EDGES',
      forceNodeModelOrder: true,
    })
    expect(config!.themeCSS).toBe(
      '& { background-color:#ffffff; }\n' +
        '.node rect.label-container { rx:16px; ry:16px; stroke-width:1px; }\n' +
        '.node polygon.label-container { fill:#f5faff; }\n' +
        '.node .label, .edgeLabel { font-weight:600; }\n' +
        '.flowchart-link { stroke-linecap:round; stroke-linejoin:round; }',
    )
  })

  it('flowchart 前缀形态（flowchart-v2 等 detectType 返回值）也走流程图分支', () => {
    expect(buildCodexMermaidConfig('flowchart-v2', true)).toBeDefined()
    expect(buildCodexMermaidConfig('flowchart-v2', true)!.layout).toBe('elk')
  })

  it('缺省参数：默认 type=flowchart、dark=false', () => {
    expect(buildCodexMermaidConfig()).toBeDefined()
    expect((buildCodexMermaidConfig()!.themeVariables as Record<string, unknown>).darkMode).toBe(false)
  })
})

describe('buildCodexMermaidConfig：六类图型分支（时序/类/状态/ER/甘特/饼）', () => {
  /** 暗色全量期望（六类共享；仅 state 的 themeCSS 有追加行） */
  const darkVariables = {
    darkMode: true,
    background: '#181818',
    primaryColor: '#1a283d',
    primaryTextColor: '#ffffff',
    primaryBorderColor: '#1f4e94',
    secondaryColor: '#1a283d',
    secondaryTextColor: '#ffffff',
    tertiaryColor: '#1a283d',
    tertiaryTextColor: '#ffffff',
    lineColor: '#8b8b8b',
    arrowheadColor: '#8b8b8b',
    textColor: '#ffffff',
    titleColor: '#ffffff',
    fontFamily: FONT,
    edgeLabelBackground: '#19202b',
    actorLineColor: '#8b8b8b',
    signalColor: '#8b8b8b',
    signalTextColor: '#ffffff',
    labelBoxBkgColor: '#181818',
    labelBoxBorderColor: '#2b2b2b',
    activationBkgColor: '#1f1f1f',
    activationBorderColor: '#2b2b2b',
    noteBkgColor: '#1f1f1f',
    noteBorderColor: '#3a843f',
    noteTextColor: '#ffffff',
    sequenceNumberColor: '#515151',
    compositeBackground: '#1a283d',
    compositeTitleBackground: '#1a283d',
    attributeBackgroundColorOdd: '#1a283d',
    attributeBackgroundColorEven: '#22344f',
    rowOdd: '#1a283d',
    rowEven: '#22344f',
    sectionBkgColor: '#222222',
    sectionBkgColor2: '#18273b',
    altSectionBkgColor: '#ffffff',
    gridColor: '#0a0a0a',
    taskBkgColor: '#1a283d',
    taskBorderColor: '#1f4e94',
    activeTaskBkgColor: '#1a283d',
    activeTaskBorderColor: '#1f4e94',
    doneTaskBkgColor: '#1f1f1f',
    doneTaskBorderColor: '#2b2b2b',
    critBkgColor: '#4c4c4c',
    critBorderColor: '#3a843f',
    taskTextColor: '#ffffff',
    taskTextDarkColor: '#ffffff',
    taskTextLightColor: '#ffffff',
    taskTextOutsideColor: '#ffffff',
    pie1: '#1f4e94',
    pie2: '#3a843f',
    pie3: '#ac4f23',
    pie4: '#d9a337',
    pie5: '#7849d1',
    pie6: '#ab4f7a',
    pieOpacity: '0.7',
    pieStrokeColor: '#181818',
    pieStrokeWidth: '2px',
    pieOuterStrokeWidth: '0px',
    pieSectionTextColor: '#ffffff',
    pieLegendTextColor: '#ffffff',
    pieTitleTextColor: '#ffffff',
  }

  /** 亮色全量期望（无 rowOdd/rowEven——上游仅暗色注入） */
  const lightVariables = {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#e0edfe',
    primaryTextColor: '#1a1c1f',
    primaryBorderColor: '#539af8',
    secondaryColor: '#e0edfe',
    secondaryTextColor: '#1a1c1f',
    tertiaryColor: '#e0edfe',
    tertiaryTextColor: '#1a1c1f',
    lineColor: '#8e8f90',
    arrowheadColor: '#8e8f90',
    textColor: '#1a1c1f',
    titleColor: '#1a1c1f',
    fontFamily: FONT,
    edgeLabelBackground: '#eff6fe',
    actorLineColor: '#8e8f90',
    signalColor: '#8e8f90',
    signalTextColor: '#1a1c1f',
    labelBoxBkgColor: '#ffffff',
    labelBoxBorderColor: '#ededed',
    activationBkgColor: '#ffffff',
    activationBorderColor: '#ededed',
    noteBkgColor: '#ffffff',
    noteBorderColor: '#6bc67f',
    noteTextColor: '#1a1c1f',
    sequenceNumberColor: '#c6c7c7',
    compositeBackground: '#e0edfe',
    compositeTitleBackground: '#e0edfe',
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#f9fbff',
    sectionBkgColor: '#ffffff',
    sectionBkgColor2: '#f9fbff',
    altSectionBkgColor: '#ffffff',
    gridColor: '#8e8f90',
    taskBkgColor: '#e0edfe',
    taskBorderColor: '#539af8',
    activeTaskBkgColor: '#e0edfe',
    activeTaskBorderColor: '#539af8',
    doneTaskBkgColor: '#ffffff',
    doneTaskBorderColor: '#ededed',
    critBkgColor: '#ffffff',
    critBorderColor: '#6bc67f',
    taskTextColor: '#1a1c1f',
    taskTextDarkColor: '#1a1c1f',
    taskTextLightColor: '#1a1c1f',
    taskTextOutsideColor: '#1a1c1f',
    pie1: '#539af8',
    pie2: '#6bc67f',
    pie3: '#ef8b57',
    pie4: '#f8d45d',
    pie5: '#b897f4',
    pie6: '#f68ebc',
    pieOpacity: '0.7',
    pieStrokeColor: '#ffffff',
    pieStrokeWidth: '2px',
    pieOuterStrokeWidth: '0px',
    pieSectionTextColor: '#1a1c1f',
    pieLegendTextColor: '#1a1c1f',
    pieTitleTextColor: '#1a1c1f',
  }

  it.each(SIX_DIAGRAM_TYPES)('暗色 %s：全量 themeVariables 逐值一致', (type) => {
    const config = buildCodexMermaidConfig(type, true)
    expect(config).toBeDefined()
    expect(config!.theme).toBe('base')
    expect(config!.htmlLabels).toBe(false)
    expect(config!.fontFamily).toBe(FONT)
    expect(config!.themeVariables).toEqual(darkVariables)
  })

  it.each(SIX_DIAGRAM_TYPES)('亮色 %s：全量 themeVariables 逐值一致', (type) => {
    const config = buildCodexMermaidConfig(type, false)
    expect(config).toBeDefined()
    expect(config!.themeVariables).toEqual(lightVariables)
  })

  it('themeCSS：背景 + 网格线；state 形态追加 marker 行', () => {
    expect(buildCodexMermaidConfig('sequence', true)!.themeCSS).toBe(
      '& { background-color:#181818; }\n.grid .tick line { stroke:#0a0a0a; }',
    )
    expect(buildCodexMermaidConfig('gantt', false)!.themeCSS).toBe(
      '& { background-color:#ffffff; }\n.grid .tick line { stroke:#8e8f90; }',
    )
    expect(buildCodexMermaidConfig('state', true)!.themeCSS).toBe(
      '& { background-color:#181818; }\n.grid .tick line { stroke:#0a0a0a; }\nmarker path { fill:#8b8b8b; stroke:#8b8b8b; }',
    )
    expect(buildCodexMermaidConfig('stateDiagram', false)!.themeCSS).toBe(
      '& { background-color:#ffffff; }\n.grid .tick line { stroke:#8e8f90; }\nmarker path { fill:#8e8f90; stroke:#8e8f90; }',
    )
  })

  it('六类分支不声明 ELK 布局（layout 键不在）', () => {
    expect(buildCodexMermaidConfig('sequence', true)!.layout).toBeUndefined()
    expect(buildCodexMermaidConfig('pie', false)!.layout).toBeUndefined()
  })
})

describe('buildCodexMermaidConfig：白名单外类型返回 undefined（保持站点配置）', () => {
  it.each(['mindmap', 'timeline', 'journey', 'gitGraph', 'unknown-type'])('%s → undefined', (type) => {
    expect(buildCodexMermaidConfig(type, true)).toBeUndefined()
    expect(buildCodexMermaidConfig(type, false)).toBeUndefined()
  })
})
