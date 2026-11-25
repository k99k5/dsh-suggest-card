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
  await ctx.sessionProjections.register({key:projectionKey,stateVersion:1,
    stateSchema:z.object({turn:z.number().nullable(),pending:z.object({id:z.string(),card:task}).nullable(),task:task.nullable(),question:question.nullable(),visible}),
    init:initial, apply:fold, wire:{viewSchema:visible,view:s=>s.visible,summary:false}});
  ctx.tools.register({name:toolName,description:'Offer one optional task beneath the final reply. This does not execute it. next_task is independent work you discovered; session_choice lets the user route a newly assigned task before work starts. Use the conversation language. The visible title and description are the entire task sent on click; include the needed context, never secret or hidden instructions.',
    parameters:{type:'object',additionalProperties:false,required:['kind','title','description'],properties:{kind:{type:'string',enum:['next_task','session_choice']},title:{type:'string',minLength:1,maxLength:100},description:{type:'string',minLength:1,maxLength:1600}}},
    output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'Card proposed. No task has been started.'}]},
    async execute(args){if (!taskCard(args)) throw new Error('Expected a supported kind, a short title, and a non-empty task description.'); if (!enabled()) throw new Error('This card type is disabled. Continue in plain text; do not wait for a card click.'); return true;}}, {when:enabled});
  ctx.systemPrompt.section({name:'suggest-card-usage',order:810, text:()=>enabled() ? [
    'When useful, offer independent work with offer_task_card(kind=next_task).',
    'For a separable newly assigned task, you may offer session_choice before starting and wait for a click. After selection do the task; do not offer routing again.',
    !config.reviewModel.get() && 'For an actual decision, ask one standalone question on the final line. The app can derive quick replies.',
    'Offer at most one card; do not combine it with a decision question or offer routine cards every turn.'
  ].filter(Boolean).join(' ') : ''});
}
