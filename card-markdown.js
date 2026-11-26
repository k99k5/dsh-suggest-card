import MarkdownIt from 'markdown-it/browser';

// Only enable formatting: HTML, links, images and reference definitions stay visible text.
const md = new MarkdownIt('zero', {html:false, breaks:true}).enable([
  'backticks','emphasis','strikethrough','newline','escape','list','blockquote','code','fence','heading'
]);
const escape = md.utils.escapeHtml;
md.renderer.rules.fence = (tokens,i) => {
  const {info,content}=tokens[i];
  const label=info.trim() ? `<small>${escape(info.trim())}</small>` : '';
  return `<pre>${label}<code>${escape(content)}</code></pre>\n`;
};

export function cardMarkdown(source, inline=false) {
  const tokens=inline ? md.parseInline(source,{}) : md.parse(source,{});
  // Beyond the parser's block nesting limit, show the source rather than a truncated task.
  if(tokens.some(t=>t.level>=md.options.maxNesting-1))return `<span class="dsc-raw">${escape(source)}</span>`;
  return md.renderer.render(tokens,md.options,{});
}
