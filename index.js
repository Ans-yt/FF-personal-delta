import { commitMessage, restoreMessage } from './runtime.js';

const label='Tensura Delta';
const context=()=>SillyTavern.getContext();
function report(error) {
    console.error(`[${label}]`,error);
    globalThis.toastr?.error(`${error.message} Original delta kept; edit it and save, or use /td-repair.`,label,{timeOut:12000,preventDuplicates:true});
}
async function process(index) {
    const ctx=context();
    if(!Number.isInteger(Number(index)))return;
    index=Number(index);
    try {if(!commitMessage(ctx,index))return;}catch(error){report(error);return;}
    try {
        ctx.updateMessageBlock(index,ctx.chat[index]);
        // Core's saveChat currently logs server errors rather than throwing them.
        // Explicitly use its normal persistence path; never invent a success receipt.
        await ctx.saveChat();
    } catch(error) {
        console.error(`[${label}] Could not render/save reconstructed message`,error);
        globalThis.toastr?.error('Snapshot reconstructed, but rendering or saving failed. Original delta is retained in message metadata; check the browser console.',label);
    }
}

const ctx=context();
const events=ctx.eventTypes??ctx.event_types;
for(const key of ['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED']) {
    if(events[key])ctx.eventSource.on(events[key],process);
}
// MESSAGE_RECEIVED is the primary hook for streaming and non-streaming replies.
// GENERATION_ENDED's argument is chat length, not a message index.
if(events.GENERATION_ENDED)ctx.eventSource.on(events.GENERATION_ENDED,()=>process(context().chat.length-1));

if(ctx.SlashCommandParser&&ctx.SlashCommand) {
    const add=(name,helpString,callback)=>ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name,helpString,callback}));
    add('td-repair','Apply a complete delta in the latest assistant message, or supply its zero-based message index.',async(_args,value)=>{
        const c=context();const n=String(value??'').trim();
        const index=n?Number(n):c.chat.findLastIndex(m=>!m.is_user&&!m.is_system);
        await process(index);return '';
    });
    add('td-restore','Restore the original delta for the latest assistant message, or supply its zero-based index. Does not overwrite edits.',async(_args,value)=>{
        const c=context();const n=String(value??'').trim();
        const index=n?Number(n):c.chat.findLastIndex(m=>!m.is_user&&!m.is_system);
        try {restoreMessage(c,index);c.updateMessageBlock(index,c.chat[index]);await c.saveChat();}catch(error){report(error);}
        return '';
    });
}
console.info(`[${label}] 1.0.1 loaded. Existing display Regex remains responsible for the UI.`);
