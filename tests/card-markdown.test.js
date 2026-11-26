import test from 'node:test';
import assert from 'node:assert/strict';
import {cardMarkdown} from '../card-markdown.js';

test('参考卡的包名渲染为代码，标题只使用行内排版',()=>{
  assert.equal(cardMarkdown('验证 **npm** 包可用性',true),'验证 <strong>npm</strong> 包可用性');
  const source='检查 `@k99k5/dsh-suggest-card@0.0.3` 是否已可下载；确认可用后再切换，未就绪则保持当前本地版。';
  assert.equal(cardMarkdown(source),'<p>'+source.replace('`@k99k5/dsh-suggest-card@0.0.3`','<code>@k99k5/dsh-suggest-card@0.0.3</code>')+'</p>\n');
});

test('说明支持段落、换行、嵌套列表及引用，格式未闭合仍可读',()=>{
  const result=cardMarkdown('先检查\n再执行\n\n1. **主任务**\n   - *子任务*\n\n> 注意 `版本`');
  for(const part of ['先检查<br>','再执行','<ol>','<ul>','<strong>主任务</strong>','<em>子任务</em>','<blockquote>','<code>版本</code>']) assert.ok(result.includes(part),part);
  assert.ok(cardMarkdown('`未闭合').includes('`未闭合'));
});

test('HTML、注释、图片、链接地址和引用定义均保留可见，不生成网络资源',()=>{
  const result=cardMarkdown('<b>原文</b> <!--说明-->\n\n![图片](https://example.org/image) [访问](https://example.org)\n\n[备注]: https://example.org/note');
  for(const part of ['&lt;b&gt;原文&lt;/b&gt;','&lt;!--说明--&gt;','![图片](https://example.org/image)','[访问](https://example.org)','[备注]: https://example.org/note'])assert.ok(result.includes(part),part);
  assert.doesNotMatch(result,/<(?:a|img|b)\b/);
});

test('围栏的语言、附注和正文均转义显示；过深的块结构回退为完整原文',()=>{
  const result=cardMarkdown('```text <附注>\n<b>示例</b>\n```');
  assert.match(result,/<small>text &lt;附注&gt;<\/small>/);assert.match(result,/<code>&lt;b&gt;示例&lt;\/b&gt;/);
  assert.ok(cardMarkdown('> '.repeat(40)+'仍应可见').includes('仍应可见'));
});
