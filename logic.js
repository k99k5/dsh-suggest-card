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
  const reply = labels => ({kind:'question',description:q,labels});
  const choices = body.match(/^(?:你(?:想|希望|要|更倾向于|更喜欢)|你选|请选择[：:]?|选择[：:]?)?(.{1,35}?)[，,\s]*还是\s*(.{1,35}?)$/u)
    ?? body.match(/^(?:would you (?:prefer|like)|do you (?:prefer|want)|should (?:I|we)|which do you prefer[:,]?)\s+(.{1,35}?)\s+or\s+(.{1,35})$/i);
  if (choices) {
    const labels = choices.slice(1).map(s => s.trim().replace(/^[「“](.+)[」”]$/u, '$1'));
    if (labels.every(s => s && !/[,:：，、。；<>\[\]]|还是|\bor\b/i.test(s)) && labels[0] !== labels[1]) return reply(labels);
    return null;
  }
  if (/^(?:要不要|是否(?:需要|要|继续)|需要(?:我|现在)|要(?:我|现在)|可以(?:开始|继续)|继续|现在(?:开始|执行)|你(?:想|希望|要|同意))/.test(body) && (/(?:吗|么)$/.test(body) || /^(?:要不要|是否)/.test(body))) return reply(['好的','暂时不用']);
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
    const card = s.task ?? s.question;
    return {...initial(), visible:d.reason.kind === 'completed' ? {seq, card} : null};
  }
  return s;
}
