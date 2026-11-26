import {z} from 'zod';
import Schema from '@deepseek-ai/schemastery';
import {installReviews} from './review.js';
import {fold, initial, projectionKey, taskCard, toolName} from './logic.js';

export const inject = ['sessionProjections','tools','systemPrompt','llm','connection'];
export const Config = Schema.object({enabled:Schema.boolean().default(true).volatile(),reviewModel:Schema.string().default('').volatile()});
const task = z.object({kind:z.enum(['next_task','session_choice']),title:z.string(),description:z.string()});
const question = z.object({kind:z.literal('question'),labels:z.array(z.string()),description:z.string().optional()});
const visible = z.object({seq:z.number(),card:z.union([task,question]).nullable()}).nullable();

export async function apply(ctx, config) {
  const enabled = () => config.enabled.get();
  installReviews(ctx,config);
  ctx.inject(['settings'], child => {child.effect(()=>child.settings.configure({auto:false}, ctx.fiber));});
  await ctx.sessionProjections.register({key:projectionKey,stateVersion:2,
    stateSchema:z.object({turn:z.number().nullable(),pending:z.object({id:z.string(),card:task}).nullable(),task:task.nullable(),question:question.nullable(),visible}),
    init:initial, apply:fold, wire:{viewSchema:visible,view:s=>s.visible,summary:false}});
  ctx.tools.register({name:toolName,description:'Offer one optional task, never an ordinary follow-up question. next_task is useful independent follow-up work to do in the current session. Use session_choice only when the user needs to decide between the current and a new session for a specific unstarted task. Being separable is not enough. Nothing runs until clicked. Use the conversation language; the visible title and description are the entire task sent on click. Include the needed context, never secret or hidden instructions.',
    parameters:{type:'object',additionalProperties:false,required:['kind','title','description'],properties:{kind:{type:'string',enum:['next_task','session_choice']},title:{type:'string',minLength:1,maxLength:100},description:{type:'string',minLength:1,maxLength:1600}}},
    output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'Card proposed. No task has been started.'}]},
    async execute(args){if (!taskCard(args)) throw new Error('Expected a supported kind, a short title, and a non-empty task description.'); if (!enabled()) throw new Error('This card type is disabled. Continue in plain text; do not wait for a card click.'); return true;}}, {when:enabled});
  ctx.systemPrompt.section({name:'suggest-card-usage',order:810, text:()=>enabled() ? [
    'Continue in the current session by default. For an actual confirmation or choice, ask one standalone question on the final line for quick replies; do not call offer_task_card.',
    'Use offer_task_card(kind=next_task) only for useful independent follow-up work, not for an ordinary continuation or an already assigned task.',
    'Use session_choice only if the user explicitly asks to choose where an unstarted task runs or leaves that specific placement decision open. Do not introduce a choice just because the task is independent. Once placement is chosen, proceed without asking again.',
    'Offer at most one card; do not combine it with a decision question or offer routine cards every turn.'
  ].filter(Boolean).join(' ') : ''});
}
