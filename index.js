import { commitPending, restoreMessage } from './runtime.js?v=1.1.0';
import { installLayout } from './layout.js?v=1.1.0';

const label='Tensura Delta';
const context=()=>SillyTavern.getContext();
const failures=new WeakMap();
function report(error,message) {
    // Incomplete streamed blocks are retried at the next update/completion event.
    if(error.message.includes('Expected one complete delta'))return;
    if(message&&failures.get(message)===message.mes)return;
    if(message)failures.set(message,message.mes);
    console.error(`[${label}]`,error);
    globalThis.toastr?.error(`${error.message} The original update is preserved; automatic retry runs after edits and when the chat opens.`,label,{timeOut:10000,preventDuplicates:true});
}
async function process(index) {
    const ctx=context();
    const through=index===undefined?ctx.chat.length-1:Number(index);
    if(!Number.isInteger(through)||through<0)return;
    // All commits happen synchronously before render/save can emit another event.
    const result=commitPending(ctx,through);
    if(result.error)report(result.error.cause,ctx.chat[result.error.index]);
    if(!result.changed.length)return;
    try {
        for(const i of result.changed) {
            if(context().chat!==ctx.chat)return;
            await ctx.updateMessageBlock(i,ctx.chat[i]);
        }
        if(context().chat!==ctx.chat)return;
        await ctx.saveChat();
    } catch(error) {
        console.error(`[${label}] Could not render/save reconstructed message`,error);
        globalThis.toastr?.error('Tracker reconstructed, but rendering or saving failed. The original delta is retained in message metadata.',label);
    }
}

const ctx=context();
const events=ctx.eventTypes??ctx.event_types??{};
for(const key of ['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED']) {
    if(events[key])ctx.eventSource.on(events[key],process);
}
if(events.GENERATION_ENDED)ctx.eventSource.on(events.GENERATION_ENDED,()=>process());
if(events.CHAT_CHANGED)ctx.eventSource.on(events.CHAT_CHANGED,()=>process());

if(ctx.SlashCommandParser&&ctx.SlashCommand) {
    const add=(name,helpString,callback)=>ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name,helpString,callback}));
    add('td-repair','Optional: retry pending assistant deltas through the supplied index (all pending messages by default).',async(_args,value)=>{
        const n=String(value??'').trim();await process(n?Number(n):undefined);return '';
    });
    add('td-restore','Restore the original delta for the latest assistant message, or supply its zero-based index. Does not overwrite edits.',async(_args,value)=>{
        const c=context(),n=String(value??'').trim();
        const index=n?Number(n):c.chat.findLastIndex(m=>!m.is_user&&!m.is_system);
        try {restoreMessage(c,index);await c.updateMessageBlock(index,c.chat[index]);await c.saveChat();}catch(error){report(error);}
        return '';
    });
}
installLayout();
// Existing failed updates are retried automatically on installation/reload.
await process();
console.info(`[${label}] 1.1.0 loaded. Automatic recovery and compact tracker spacing enabled.`);
