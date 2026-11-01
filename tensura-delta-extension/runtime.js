import { mergeMessage, previousSnapshot } from './engine.js';

export const KEY = 'tensura_saved_delta_v1';

// Synchronous calculation and commit before the first await prevents duplicate events
// from seeing a half-applied transaction. A completed message contains no delta.
export function commitMessage(context, index) {
    const chat=context.chat, message=chat[index];
    if(!message || message.is_user || message.is_system || !message.mes?.includes('<delta>'))return false;
    const input=message.mes;
    const {text,changed}=mergeMessage(input,previousSnapshot(chat,index));
    if(!changed)return false;
    const backup={input,output:text};
    message.extra??={};
    message.extra[KEY]=backup;
    message.mes=text;
    delete message.extra.token_count;
    // Don't overwrite translation/display overrides owned by another extension.
    if(message.extra.display_text===input)delete message.extra.display_text;
    if(Array.isArray(message.swipes)&&Number.isInteger(message.swipe_id)&&message.swipe_id>=0) {
        message.swipes[message.swipe_id]=text;
        message.swipe_info??=[];
        const info=message.swipe_info[message.swipe_id]??={};
        info.extra??={};info.extra[KEY]=structuredClone(backup);
        delete info.extra.token_count;
    }
    return true;
}

export function restoreMessage(context,index) {
    const m=context.chat[index];
    // Read the selected swipe's metadata first, never another swipe's transaction.
    const backup=m?.swipe_info?.[m.swipe_id]?.extra?.[KEY]??m?.extra?.[KEY];
    if(!backup||m.mes!==backup.output)throw new Error('No matching backup for this exact message; edited messages are never overwritten.');
    m.mes=backup.input;
    if(m.swipes&&Number.isInteger(m.swipe_id))m.swipes[m.swipe_id]=m.mes;
    delete m.extra?.[KEY];
    if(m.swipe_info?.[m.swipe_id]?.extra)delete m.swipe_info[m.swipe_id].extra[KEY];
    return true;
}
