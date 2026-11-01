import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, mergeMessage, previousSnapshot } from '../engine.js';
import { commitMessage, restoreMessage, KEY } from '../runtime.js';

const coat='<sr>Coat ×1|ID: eqp_01; Composition: A &amp; B; Properties: Dense; flexible; Grade: Rare</sr>';
const orb='<sr>Flame Orb ×2|ID: orb_01; Type: Skill Orb; Skill effect: Fire &lt; heat; retains detail</sr>';
const skill='<sr>Reclaimer|Type: Unique Skill; Skill effect: Deconstruction; Inventory; Analysis; Synthesis</sr>';
const status=`<ts><sa><sv>100/100|200</sv><sb>Hihi'irokane &amp; Adamantite</sb><sw>None</sw><so>${coat}</so></sa><ss>${skill}</ss><si><sg>Skill orbs|${orb}</sg></si><sx><st><sr>Hero|ID: ttl_01; Properties: +1</sr></st></sx></ts>`;
const gm="<details>\n<summary>📓 GM'S NOTEBOOK</summary>\n- [R] Preserve player knowledge.\n</details>";
const fac='<details><summary>🏳️ FACTIONS</summary>\n- <b>Guild</b> | Goal: Survive | Intel: Hidden &amp; old | Fibs: None | State: Calm | Conflict: None | Relations: Friendly\n</details>';
const wrap=s=>`<!-- GFX_START --><internal_states><details><summary>Turn 2</summary>${s}</details></internal_states><!-- GFX_END -->`;
const baseline=wrap(status+fac+gm);
const delta=ops=>wrap('<details><summary>NPC LOCATIONS</summary>New location</details><delta>\n'+ops.map(o=>JSON.stringify(o)).join('\n')+'\n</delta>');
const v=['v','90/100','200'];

test('no-change static data is copied byte for byte, only sv changes',()=>{
    const out=mergeMessage(delta([v]),baseline).text;
    assert.ok(out.includes(status.replace('100/100|200','90/100|200')));
    for(const raw of [coat,orb,skill,fac,gm])assert.ok(out.includes(raw));
    assert.ok(out.includes('New location'));assert.ok(!out.includes('<delta>'));
});
test('field patch retains other rich fields and punctuation',()=>{
    const out=mergeMessage(delta([v,['s','eqp_01','Properties','Fire & frost < shield >']]),baseline).text;
    assert.ok(out.includes('Composition: A &amp; B; Properties: Fire &amp; frost &lt; shield &gt;; Grade: Rare'));
    assert.ok(out.includes(orb));assert.ok(out.includes(skill));
});
test('one orb consumed; skill added with escaped complete details',()=>{
    const out=mergeMessage(delta([v,['q','orb_01',-1],['a','ss','skl_02',{Name:'Flame',Type:'Extra Skill','Skill effect':'A & B < C; all details'}]]),baseline).text;
    assert.ok(out.includes(orb.replace('×2','×1')));assert.ok(out.includes('A &amp; B &lt; C; all details'));
});
test('quantity zero deletes only its row and does not erase another group',()=>{
    const out=mergeMessage(delta([v,['q','orb_01',-2]]),baseline).text;
    assert.ok(!out.includes(orb));assert.ok(out.includes(coat));
    assert.equal(new Tracker(out).records.find(r=>r.id==='orb_01'),undefined);
});
test('move is one unit, split keeps source and derives stable new ID',()=>{
    const out=mergeMessage(delta([v,['m','orb_01','so']]),baseline).text;
    const tracker=new Tracker(out);
    assert.equal(tracker.get('orb_01').fields.Quantity,1);
    assert.equal(tracker.get('orb_01_split1').fields.Quantity,1);
    assert.equal(tracker.get('orb_01_split1').destination,'so');
    assert.ok(out.includes(coat));
});
test('move unique equipment preserves its exact row and stable ID',()=>{
    const out=mergeMessage(delta([v,['m','eqp_01','si/Equipment']]),baseline).text;
    assert.equal(new Tracker(out).get('eqp_01').destination,'si/Equipment');
    assert.equal(out.split(coat).length,2);
});
test('unnumbered skill and notebook IDs remain stable after deletions',()=>{
    const first=mergeMessage(delta([v,['a','ss','skl_02',{Name:'Second','Skill effect':'Keep'}],['a','gm','gm_02',{Type:'T',Text:'Next arc'}]]),baseline).text;
    assert.equal(new Tracker(first).get('skl_01').fields.Name,'Reclaimer');
    const second=mergeMessage(delta([v,['d','skl_01'],['d','gm_01']]),first).text;
    const t=new Tracker(second);assert.equal(t.get('skl_02').fields.Name,'Second');assert.equal(t.get('gm_02').fields.Text,'Next arc');
    assert.throws(()=>mergeMessage(delta([v,['a','ss','skl_01',{Name:'Reused'}]]),second),/reused/);
});
test('faction field and GM text changes retain established content',()=>{
    const out=mergeMessage(delta([v,['s','fac_01','State','Alert'],['s','gm_01','Text','Remember A & B']]),baseline).text;
    assert.ok(out.includes('Intel: Hidden &amp; old'));assert.ok(out.includes('State: Alert'));
    assert.ok(out.includes('Remember A &amp; B'));
});
test('body singleton escapes XML exactly once',()=>{
    const out=mergeMessage(delta([v,['s','body','Name','Steel & bone < bonded >']]),baseline).text;
    assert.ok(out.includes('<sb>Steel &amp; bone &lt; bonded &gt;</sb>'));
});
test('malformed, incomplete, unknown ID and negative quantity are atomic errors',()=>{
    const bad=[delta([v,['q','orb_01',-3]]),delta([v,['s','missing','Name','x']]),delta([v]).replace('</delta>',''),delta([v]).replace(JSON.stringify(v),'[oops]'),delta([['q','orb_01',-1]])];
    for(const mes of bad){const ctx={chat:[{mes:baseline},{mes}]};assert.throws(()=>commitMessage(ctx,1));assert.equal(ctx.chat[1].mes,mes);assert.equal(ctx.chat[1].extra,undefined);}
});
test('swipe chosen as preceding baseline; no global state leaks between branches',()=>{
    const a=mergeMessage(delta([v,['q','orb_01',-1]]),baseline).text;
    const b=mergeMessage(delta([v]),baseline).text;
    const chat=[{mes:a,swipes:[a,b],swipe_id:0},{is_user:true,mes:'go'},{mes:delta([v])}];
    assert.equal(new Tracker(previousSnapshot(chat,2)).get('orb_01').fields.Quantity,1);
    chat[0].mes=b;chat[0].swipe_id=1;
    assert.equal(new Tracker(previousSnapshot(chat,2)).get('orb_01').fields.Quantity,2);
});
test('duplicate lifecycle events apply quantity once and sync the selected swipe only',()=>{
    const input=delta([v,['q','orb_01',-1]]);
    const ctx={chat:[{mes:baseline},{mes:input,swipes:['other swipe',input],swipe_id:1,extra:{}}]};
    assert.equal(commitMessage(ctx,1),true);assert.equal(commitMessage(ctx,1),false);
    const m=ctx.chat[1];assert.equal(m.swipes[0],'other swipe');assert.equal(m.swipes[1],m.mes);
    assert.equal(new Tracker(m.mes).get('orb_01').fields.Quantity,1);
    assert.ok(m.swipe_info[1].extra[KEY]);
});
test('regeneration uses preceding message, not the replaced answer',()=>{
    const ctx={chat:[{mes:baseline},{mes:delta([v,['q','orb_01',-1]])}]};
    commitMessage(ctx,1);ctx.chat[1].mes=delta([v,['q','orb_01',-1]]);commitMessage(ctx,1);
    assert.equal(new Tracker(ctx.chat[1].mes).get('orb_01').fields.Quantity,1);
});
test('continuation uses existing inline snapshot then leaves one snapshot',()=>{
    const first=mergeMessage(delta([v,['q','orb_01',-1]]),baseline).text;
    const continuation='Original narrative.'+first+' More narrative.'+delta([v,['q','orb_01',-1]]);
    const out=mergeMessage(continuation,baseline).text;
    assert.equal(out.split('<internal_states>').length,2);assert.ok(out.includes('Original narrative.'));assert.ok(out.includes(' More narrative.'));
    assert.equal(new Tracker(out).records.find(r=>r.id==='orb_01'),undefined);
});
test('editing completed snapshots is respected; explicit restore refuses changed text',()=>{
    const ctx={chat:[{mes:baseline},{mes:delta([v])}]};commitMessage(ctx,1);
    const rendered=ctx.chat[1].mes;assert.equal(restoreMessage(ctx,1),true);assert.ok(ctx.chat[1].mes.includes('<delta>'));
    commitMessage(ctx,1);ctx.chat[1].mes+=' manual edit';assert.throws(()=>restoreMessage(ctx,1),/edited/);
    assert.ok(ctx.chat[1].mes.startsWith(rendered));
});
test('no baseline: only supplied established facts, no character fixtures',()=>{
    const out=mergeMessage(delta([['v','Unknown','Unknown'],['a','ss','skl_01',{Name:'Known skill','Skill effect':'Known effect'}]])).text;
    assert.ok(out.includes('Unknown|Unknown'));assert.ok(!out.includes('Reclaimer'));assert.ok(!out.includes('Coat'));
});
test('unresolved previous delta blocks later transactions',()=>{
    assert.throws(()=>previousSnapshot([{mes:baseline},{mes:delta([v])}],2),/unresolved/);
});
test('GM limit cannot silently discard reminders',()=>{
    const ops=[v,...Array.from({length:20},(_,i)=>['a','gm','new_'+i,{Type:'R',Text:'Keep '+i}])];
    assert.throws(()=>mergeMessage(delta(ops),baseline),/20 entries/);
});
test('removing a first optional field retains the structural row separator',()=>{
    const out=mergeMessage(delta([v,['s','skl_01','Type',null]]),baseline).text;
    assert.ok(out.includes('<sr>Reclaimer|; Skill effect:'));
    assert.equal(new Tracker(out).get('skl_01').fields['Skill effect'],'Deconstruction; Inventory; Analysis; Synthesis');
});
test('GM-only operation on a blank baseline does not enable Status',()=>{
    const out=mergeMessage(delta([['a','gm','gm_01',{Type:'R',Text:'Known reminder'}]])).text;
    assert.ok(!out.includes('<ts>'));assert.ok(out.includes('Known reminder'));
});
