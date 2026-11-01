import test from 'node:test';
import assert from 'node:assert/strict';

test('entry point lifecycle hooks mutate, rerender and save exactly once',async()=>{
    const listeners=new Map(),commands=new Map();let saves=0,renders=0;
    const eventTypes=Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED','GENERATION_ENDED'].map(x=>[x,x]));
    const input='<internal_states><details><summary>States</summary><delta>\n["v","10/20","40"]\n</delta></details></internal_states>';
    const ctx={chat:[{mes:input}],eventTypes,eventSource:{on:(name,fn)=>listeners.set(name,fn)},saveChat:async()=>{saves++;},updateMessageBlock:()=>{renders++;},SlashCommand:{fromProps:x=>x},SlashCommandParser:{addCommandObject:c=>commands.set(c.name,c)}};
    globalThis.SillyTavern={getContext:()=>ctx};
    await import('../index.js');
    await listeners.get('MESSAGE_RECEIVED')(0,'normal');
    assert.ok(ctx.chat[0].mes.includes('<sv>10/20|40</sv>'));
    for(const name of ['MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_SWIPED'])await listeners.get(name)(0);
    await listeners.get('GENERATION_ENDED')(1);
    assert.equal(saves,1);assert.equal(renders,1);
    assert.ok(commands.has('td-repair'));assert.ok(commands.has('td-restore'));
    await commands.get('td-restore').callback({},'0');
    assert.equal(ctx.chat[0].mes,input);assert.equal(saves,2);
    await commands.get('td-repair').callback({},'0');assert.equal(saves,3);
    // Switching chats resolves the new context, with no captured state from chat A.
    ctx.chat=[{mes:input.replace('10/20','5/5')}];
    await listeners.get('MESSAGE_RECEIVED')(0,'normal');
    assert.ok(ctx.chat[0].mes.includes('<sv>5/5|40</sv>'));
    assert.equal(saves,4);
});
