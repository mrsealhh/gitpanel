import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * 代码高亮配色：深色 / 浅色各一套。
 * 浅色用接近 GitHub Light 的低饱和色，避免浅色主题下绿/紫过亮看不清。
 */
export function codeHighlight(theme: string) {
  const light = theme === 'light'
  return HighlightStyle.define(
    light
      ? [
          { tag: tags.comment, color: '#6e7781', fontStyle: 'italic' },
          { tag: tags.keyword, color: '#cf222e' },
          { tag: [tags.string, tags.special(tags.string)], color: '#0a3069' },
          { tag: [tags.number, tags.bool, tags.null], color: '#0550ae' },
          { tag: [tags.function(tags.variableName), tags.labelName], color: '#8250df' },
          { tag: [tags.typeName, tags.className], color: '#953800' },
          { tag: tags.propertyName, color: '#0550ae' },
          { tag: [tags.operator, tags.punctuation], color: '#57606a' },
          { tag: tags.heading, color: '#0969da', fontWeight: '600' },
          { tag: tags.link, color: '#0969da', textDecoration: 'underline' },
        ]
      : [
          { tag: tags.comment, color: '#7c8a9e', fontStyle: 'italic' },
          { tag: tags.keyword, color: '#c084fc' },
          { tag: [tags.string, tags.special(tags.string)], color: '#7bd88f' },
          { tag: [tags.number, tags.bool, tags.null], color: '#fbbf24' },
          { tag: [tags.function(tags.variableName), tags.labelName], color: '#60a5fa' },
          { tag: [tags.typeName, tags.className], color: '#2dd4bf' },
          { tag: tags.propertyName, color: '#7dd3fc' },
          { tag: [tags.operator, tags.punctuation], color: '#94a3b8' },
          { tag: tags.heading, color: '#f0abfc', fontWeight: '600' },
          { tag: tags.link, color: '#7dd3fc', textDecoration: 'underline' },
        ],
  )
}
