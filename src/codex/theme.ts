// Codex Mermaid 主题配置（票 #3）：迁移自 vsidian 内核 src/webview/
// mermaidTheme.ts（origin/main@301d2c16）的 buildCodexMermaidConfig——迁移
// 口径是「逐值拷贝」，函数体保持上游取值不动；期望值契约由
// test/codex-theme.test.ts 与上游源码对拍钉死。升级或修色时同步改两侧。
//
// 结构速览（详见各分支）：
// - 流程图分支（type 以 'flowchart' 前缀，含 detectType 返回的
//   'flowchart-v2'）：theme 'base' + layout 'elk'（ELK 布局）+ 圆角矩形
//   等图形 CSS；
// - 六类图型分支（sequence / class / classDiagram / state / stateDiagram /
//   er / gantt / pie——mermaid 11.12.2 detectType 的 diagram id）：一套
//   覆盖六类的 themeVariables（时序/类/状态/ER/甘特/饼各自消费其中子集）；
// - 白名单外类型返回 undefined：保持站点配置不叠加（mindmap/timeline 等
//   不在 Codex 预设范围）。

/**
 * 构建 Codex 明暗截图的近似预设；保留各图布局与源码覆写。
 * （上游原注释；「保留源码覆写」= 图内显式配置优先，见 runtime.ts）
 */
export function buildCodexMermaidConfig(type = 'flowchart', dark = false): Record<string, unknown> | undefined {
  const background = dark ? '#181818' : '#ffffff'
  const fill = dark ? '#1a283d' : '#e0edfe'
  const border = dark ? '#1f4e94' : '#539af8'
  const ink = dark ? '#ffffff' : '#1a1c1f'
  const line = dark ? '#8b8b8b' : '#8e8f90'
  const green = dark ? '#3a843f' : '#6bc67f'
  const muted = dark ? '#1f1f1f' : '#ffffff'
  const mutedBorder = dark ? '#2b2b2b' : '#ededed'
  if (!type.startsWith('flowchart')) {
    if (!['sequence', 'class', 'classDiagram', 'state', 'stateDiagram', 'er', 'gantt', 'pie'].includes(type)) {
      return undefined
    }
    return {
      theme: 'base', htmlLabels: false,
      fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      themeCSS: `& { background-color:${background}; }\n.grid .tick line { stroke:${dark ? '#0a0a0a' : line}; }` +
        (type === 'state' || type === 'stateDiagram' ? `\nmarker path { fill:${line}; stroke:${line}; }` : ''),
      themeVariables: {
        darkMode: dark, background,
        primaryColor: fill, primaryTextColor: ink, primaryBorderColor: border,
        secondaryColor: fill, secondaryTextColor: ink,
        tertiaryColor: fill, tertiaryTextColor: ink,
        lineColor: line, arrowheadColor: line, textColor: ink, titleColor: ink,
        fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
        edgeLabelBackground: dark ? '#19202b' : '#eff6fe',
        actorLineColor: line, signalColor: line, signalTextColor: ink,
        labelBoxBkgColor: background, labelBoxBorderColor: mutedBorder,
        activationBkgColor: muted, activationBorderColor: mutedBorder,
        noteBkgColor: muted, noteBorderColor: green, noteTextColor: ink,
        sequenceNumberColor: dark ? '#515151' : '#c6c7c7',
        compositeBackground: fill, compositeTitleBackground: fill,
        attributeBackgroundColorOdd: dark ? fill : '#ffffff', attributeBackgroundColorEven: dark ? '#22344f' : '#f9fbff',
        ...(dark ? { rowOdd: fill, rowEven: '#22344f' } : {}),
        // 原生甘特分区为 0.2 透明度；暗色叠加后分别为 #1a1a1a、#181b1f、#464646。
        sectionBkgColor: dark ? '#222222' : '#ffffff', sectionBkgColor2: dark ? '#18273b' : '#f9fbff', altSectionBkgColor: '#ffffff',
        gridColor: dark ? '#0a0a0a' : line,
        taskBkgColor: fill, taskBorderColor: border,
        activeTaskBkgColor: fill, activeTaskBorderColor: border,
        doneTaskBkgColor: muted, doneTaskBorderColor: mutedBorder,
        critBkgColor: dark ? '#4c4c4c' : '#ffffff', critBorderColor: green,
        taskTextColor: ink, taskTextDarkColor: ink,
        taskTextLightColor: ink, taskTextOutsideColor: ink,
        pie1: border, pie2: green, pie3: dark ? '#ac4f23' : '#ef8b57',
        pie4: dark ? '#d9a337' : '#f8d45d', pie5: dark ? '#7849d1' : '#b897f4', pie6: dark ? '#ab4f7a' : '#f68ebc',
        pieOpacity: '0.7', pieStrokeColor: background, pieStrokeWidth: '2px',
        pieOuterStrokeWidth: '0px', pieSectionTextColor: ink,
        pieLegendTextColor: ink, pieTitleTextColor: ink,
      },
    }
  }
  return {
    theme: 'base', layout: 'elk', htmlLabels: false,
    themeVariables: {
      darkMode: dark,
      primaryColor: dark ? fill : '#e5f3ff', primaryTextColor: dark ? ink : '#004f99', primaryBorderColor: '#b8b9ba',
      secondaryColor: dark ? '#22344f' : '#f5faff', tertiaryColor: dark ? '#22344f' : '#f5faff',
      lineColor: '#b8b9ba', textColor: dark ? ink : '#004f99', fontSize: '14px',
      fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      edgeLabelBackground: 'transparent', clusterBkg: dark ? '#22344f' : '#f5faff', clusterBorder: '#b8b9ba',
    },
    flowchart: { htmlLabels: false, useMaxWidth: false, padding: 16, wrappingWidth: 320, curve: 'linear', nodeSpacing: 40, rankSpacing: 40 },
    elk: { nodePlacementStrategy: 'LINEAR_SEGMENTS', mergeEdges: false, considerModelOrder: 'NODES_AND_EDGES', forceNodeModelOrder: true },
    themeCSS: `& { background-color:${background}; }\n` +
      '.node rect.label-container { rx:16px; ry:16px; stroke-width:1px; }\n' +
      `.node polygon.label-container { fill:${dark ? '#22344f' : '#f5faff'}; }\n` +
      '.node .label, .edgeLabel { font-weight:600; }\n' +
      '.flowchart-link { stroke-linecap:round; stroke-linejoin:round; }',
  }
}
