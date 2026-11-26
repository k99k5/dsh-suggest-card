export const toolName = 'offer_task_card';
export const projectionKey = 'suggestCardV2';

// Only direct, answerable decisions get controls. Never turn arbitrary prose into a command.
export function closingDecision(text) {
  const lines = text.trimEnd().split(/\r?\n/);
  const raw = lines.pop() ?? '';
  if (/^(?: {4}|\t)/.test(raw)) return null;
  const q = raw.trim();
  if (!q || q.length > 160 || !/[?？]$/.test(q) || /[。！？?!；;]/.test(q.slice(0, -1)) || /^[>#*`~\-|\d]+[.、\s]?/.test(q)) return null;
  let fence;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    if (!fence) fence = m[1];
    else if (m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = undefined;
  }
  if (fence) return null;
  const body = q.slice(0, -1);
  // “还是”也有“仍然”的意思，不能把原因或方法问题拆成两个答案。
  if (/(?:为什么|为何|怎么|如何)/u.test(body.split('还是',1)[0])) return null;
  const reply = labels => ({kind:'question',description:q,labels});
  const choices = body.match(/^(?:你(?:想|希望|要|更倾向于|更喜欢)|你选|请选择[：:]?|选择[：:]?)?(.{1,35}?)[，,\s]*还是\s*(.{1,35}?)$/u)
    ?? body.match(/^(?:would you (?:prefer|like)|do you (?:prefer|want)|should (?:I|we)|which do you prefer[:,]?)\s+(.{1,35}?)\s+or\s+(.{1,35})$/i);
  if (choices) {
    const labels = choices.slice(1).map(s => s.trim().replace(/^[「“](.+)[」”]$/u, '$1'));
    if (labels.every(s => s && !/[,:：，、。；<>\[\]]|还是|\bor\b/i.test(s)) && labels[0] !== labels[1]) return reply(labels);
    return null;
  }
  if (/^(?:要不要|是否(?:需要|要|继续)|(?:还|也)?需要(?:我|现在|继续)|要(?:我|现在|继续)|可以(?:开始|继续)|继续|现在(?:开始|执行)|你(?:想|希望|要|同意))/.test(body) && (/(?:吗|么)$/.test(body) || /^(?:要不要|是否)/.test(body))) return reply(['好的','暂时不用']);
  if (/^(?:shall (?:I|we)|should (?:I|we)|would you like (?:me |us )?to|do you want (?:me |us )?to)\b/i.test(body)) return reply(['Yes','Not now']);
  return null;
}

export function taskCard(value) {
  if (!value || !['next_task','session_choice'].includes(value.kind) || Object.keys(value).some(k => !['kind','title','description'].includes(k))) return null;
  for (const [k, max] of [['title',100],['description',1600]]) {
    const s = value[k];
    if (typeof s !== 'string' || !s.trim() || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/.test(s)) return null;
  }
  return {kind:value.kind, title:value.title.trim(), description:value.description.trim()};
}

export const initial = () => ({turn:null, pending:null, task:null, question:null, visible:null});
// 成对选项允许在位置后写任务；单独确认另开会话时，只认明确的新建或开始动作。
const hereZh = /^(?:继续|留)?在(?:这里|本轮|(?:当前|本次?|这个)(?:会话|对话))(?![里中]?的)|^(?:这里|本轮|(?:当前|本次?|这个)(?:会话|对话))[里中]?$/u;
const newZh = /^(?:在|到|转到)(?:一个)?新的?(?:会话|对话)(?![里中]?的)|^(?:另开|新开|创建|开启|打开)(?:一个)?(?:新的?)?(?:会话|对话)(?![里中]?的)|^(?:新的?(?:会话|对话)|(?:另开|新开)一个)$/u;
const hereEn = /^(?:(?:continue|start|stay|work|proceed|do (?:it|this))(?: in)? |in )?(?:here|(?:this|(?:the )?current) (?:session|chat|conversation))$/i;
const newEn = /^(?:(?:continue|start|work|proceed|do (?:it|this))(?: in)? |(?:in|open|create|switch to) )?(?:(?:a|an) )?(?:new|separate) (?:session|chat|conversation)$/i;
export function asksWhere(question) {
  if (question?.kind !== 'question') return false;
  const here = label => hereZh.test(label) || hereEn.test(label);
  const fresh = label => newZh.test(label) || newEn.test(label);
  const [a,b] = question.labels;
  if ((here(a) && fresh(b)) || (fresh(a) && here(b))) return true;
  const ask = question.description ?? '';
  return /^(?:要不要|是否(?:需要|要)?|需要|要|你(?:想|希望|要))(?:我|我们)?(?:在新(?:的)?(?:会话|对话)[里中]?(?:开始|继续)|(?:另开|新开|创建)(?:一个)?(?:新的?)?(?:会话|对话))[吗么]?[？?]$/u.test(ask)
    || /^(?:shall (?:I|we)|should (?:I|we)|would you like (?:me |us )?to) (?:open|create|start(?: in)?|continue in) a new (?:session|chat|conversation)\?$/i.test(ask);
}
export function fold(s, {type, seq, data:d}) {
  if (type === 'turn/start') return {...initial(), turn:d.turn};
  if (s.turn === null || d.turn !== s.turn) return s;
  if (type === 'tool/call' && d.name === toolName) {
    let card;
    try { card = taskCard(JSON.parse(d.arguments)); } catch { return s; }
    return card ? {...s, pending:{id:d.callId, card}} : s;
  }
  if (type === 'tool/result' && s.pending && d.message.toolCallId === s.pending.id) return {...s, task:d.message.isError ? s.task : s.pending.card, pending:null};
  if (type === 'assistant/message') {
    const parts = d.message.content;
    const question = !d.interrupted && !parts.some(b => b.type === 'tool-call') ? closingDecision(parts.filter(b => b.type === 'text').map(b => b.text).join('')) : null;
    return question || s.question ? {...s, question} : s;
  }
  if (type === 'turn/end') {
    const routing = s.task?.kind === 'session_choice' && asksWhere(s.question);
    const card = routing ? s.task : s.question ?? s.task;
    return {...initial(), visible:d.reason.kind === 'completed' ? {seq, card} : null};
  }
  return s;
}
