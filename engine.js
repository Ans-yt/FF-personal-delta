// No DOM parsing: untouched tracker fragments retain their exact original bytes.
export const escapeText = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decode = s => s.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'"})[x]);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const tag = (text, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const destinations = ['sw','so','ss','st','sc','sd','si/Materials','si/Objects','si/Skill orbs','si/Equipment','gm','fac'];
const prefixes = {sw:'wpn',so:'eqp',ss:'skl',st:'ttl',sc:'cnd',sd:'mod',gm:'gm',fac:'fac','si/Materials':'mat','si/Objects':'obj','si/Skill orbs':'orb','si/Equipment':'eqp'};
const labels = ['ID','Name','Quantity','Type','Class','Grade','Slot','Properties','Composition','Uses','Orb skill/effect','Skill effect','Goal','Intel','Fibs','State','Conflict','Relations','Text'];
const labelRe = new RegExp(`(^|;\\s*)(${labels.join('|')}):\\s*`, 'g');

export function detailBlocks(text) {
    const stack = [], blocks = [];
    for (const m of text.matchAll(/<details\b[^>]*>|<\/details>/gi)) {
        if (!m[0].startsWith('</')) stack.push(m.index);
        else {
            check(stack.length, 'Unbalanced details tags');
            const start = stack.pop(), end = m.index + m[0].length;
            const raw = text.slice(start,end);
            blocks.push({start,end,raw,summary:/^<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(raw)?.[1] ?? ''});
        }
    }
    check(!stack.length, 'Unclosed details block');
    return blocks;
}

function htmlSection(text, destination) {
    const matcher = destination === 'gm' ? /GM['’]S NOTEBOOK/i : /FACTIONS/i;
    return detailBlocks(text).find(b => matcher.test(b.summary));
}

function rowsFrom(section, destination) {
    if (!section) return [];
    if (!['gm','fac'].includes(destination)) return [...section.matchAll(/<sr>[\s\S]*?<\/sr>/g)].map(m=>m[0]);
    const inner = section.replace(/^[\s\S]*?<\/summary>/i,'').replace(/<\/details>\s*$/i,'');
    return inner.split('\n').filter(l=>destination==='gm' ? /^\s*-\s*\[[RTD]\]/.test(l) && !/No active notes\./.test(l) : /^\s*-\s*<b>/.test(l));
}

function fieldsOf(raw, destination) {
    if (destination==='gm') {
        const m = /^\s*-\s*\[([RTD])\]\s*([\s\S]*?)(?:\s*\|\s*ID:\s*([\w-]+))?$/.exec(raw);
        check(m, 'Invalid legacy GM note');
        return {Type:m[1],Text:decode(m[2]),...(m[3]?{ID:m[3]}:{})};
    }
    const plain = destination==='fac' ? raw.replace(/^\s*-\s*<b>([\s\S]*?)<\/b>\s*\|\s*/, '$1|') : raw.slice(4,-5);
    const split = plain.indexOf('|');
    const head = decode(split<0?plain:plain.slice(0,split));
    const quantity = /\s*×\s*(\d+(?:\.\d+)?)\s*$/.exec(head);
    const fields = {Name:quantity?head.slice(0,quantity.index):head};
    if(quantity) fields.Quantity=Number(quantity[1]);
    const tail = split<0?'':plain.slice(split+1);
    if(destination==='fac') {
        for(const m of tail.matchAll(/(?:^|\|\s*)(Goal|Intel|Fibs|State|Conflict|Relations|ID):\s*([\s\S]*?)(?=\s*\|\s*(?:Goal|Intel|Fibs|State|Conflict|Relations|ID):|$)/g)) fields[m[1]]=decode(m[2].trim());
    } else {
        const matches=[...tail.matchAll(labelRe)];
        matches.forEach((m,i)=>fields[m[2]]=decode(tail.slice(m.index+m[0].length,matches[i+1]?.index??tail.length).trim()));
    }
    return fields;
}

function serialize(record) {
    const f=record.fields, e=escapeText;
    if(record.destination==='gm') return `- [${f.Type}] ${e(f.Text)}`;
    if(record.destination==='fac') return `- <b>${e(f.Name)}</b> | ${Object.entries(f).filter(([k])=>k!=='Name'&&k!=='Quantity'&&k!=='ID').map(([k,v])=>`${k}: ${e(v)}`).join(' | ')}`;
    const suffix=Object.entries(f).filter(([k])=>k!=='Name'&&k!=='Quantity').map(([k,v])=>`${k}: ${e(v)}`).join('; ');
    return `<sr>${e(f.Name)}${f.Quantity===undefined?'':` ×${f.Quantity}`}|${suffix}</sr>`;
}

// Update just the requested field span; all other rich descriptions remain verbatim.
function setField(record, key, value) {
    check(labels.includes(key)&&key!=='ID', `Unsupported or immutable field: ${key}`);
    check(value===null || ['string','number'].includes(typeof value), 'Field values must be strings, numbers or null');
    if(key==='Quantity') check(Number.isFinite(value)&&value>=0, 'Invalid quantity');
    if(record.destination==='gm') {
        check(['Type','Text'].includes(key)&&value!==null,'GM notes need Type and Text');
        if(key==='Type') check(['R','T','D'].includes(value),'Invalid GM note type');
        record.fields[key]=value; record.raw=serialize(record); return;
    }
    check(!(key==='Name'&&value===null),'Name cannot be removed');
    const old=record.raw;
    if(key==='Name') {
        if(record.destination==='fac') record.raw=old.replace(/(<b>)[\s\S]*?(<\/b>)/,(_m,a,b)=>a+escapeText(value)+b);
        else record.raw=old.replace(/^(<sr>)[\s\S]*?(?=\s*×\s*\d+(?:\.\d+)?\s*\||\|)/,(_m,a)=>a+escapeText(value));
    } else if(key==='Quantity') {
        check(!['ss','st','sc','sd','fac'].includes(record.destination),'This record has no quantity');
        if(/×\s*\d+(?:\.\d+)?\s*\|/.test(old)) record.raw=old.replace(/×\s*\d+(?:\.\d+)?(?=\s*\|)/,()=>`×${value}`);
        else record.raw=old.replace('|',` ×${value}|`);
    } else {
        const separator=record.destination==='fac'?'\\|':'[;|]';
        const following=record.destination==='fac'?'\\|\\s*(?:'+labels.join('|')+'):':'(?:;\\s*(?:'+labels.join('|')+'):|</sr>)';
        const re=new RegExp(`(${separator}\\s*)${key.replaceAll('/','\\/')}:(\\s*)([\\s\\S]*?)(?=${following}|$)`);
        if(re.test(old)) record.raw=old.replace(re,(_m,a,b)=>value===null?(a.includes('|')?'|':''):a+key+':'+b+escapeText(value));
        else if(value!==null) {
            if(record.destination==='fac') record.raw+=` | ${key}: ${escapeText(value)}`;
            else record.raw=old.replace('</sr>',()=>`; ${key}: ${escapeText(value)}</sr>`);
        }
    }
    if(value===null) delete record.fields[key]; else record.fields[key]=value;
}

export class Tracker {
    constructor(snapshot='') {
        this.original=snapshot; this.status=tag(snapshot,'ts')?.[0]??'';
        check(!/^<ts>\s*\{/.test(this.status),'Legacy JSON status requires conversion to the tagged format first');
        this.records=[]; this.changed=new Set(); this.values=null; this.body=tag(this.status,'sb')?.[1]??'Unknown';
        const mapping=/<!-- TD_IDS ([\s\S]*?) -->/.exec(snapshot);
        this.idMap=mapping?JSON.parse(mapping[1]):{};
        const sections={};
        for(const d of destinations) {
            if(d==='gm'||d==='fac') sections[d]=htmlSection(snapshot,d)?.raw??'';
            else if(d.startsWith('si/')) sections[d]=[...this.status.matchAll(/<sg>([^|<]*)\|([\s\S]*?)<\/sg>/g)].find(m=>decode(m[1])===d.slice(3))?.[2]??'';
            else sections[d]=tag(this.status,d)?.[1]??'';
        }
        const reserved=new Set(Object.keys(this.idMap));
        for(const d of destinations) for(const [i,raw] of rowsFrom(sections[d],d).entries()) {
            const fields=fieldsOf(raw,d); if(fields.ID) reserved.add(fields.ID);
        }
        const used=new Set(['body']);
        for(const d of destinations) for(const [i,raw] of rowsFrom(sections[d],d).entries()) {
            const fields=fieldsOf(raw,d);
            let id=fields.ID||Object.entries(this.idMap).find(([,v])=>Array.isArray(v)&&v[0]===d&&v[1]===i)?.[0];
            if(!id) { let n=1; do {id=`${prefixes[d]}_${String(n++).padStart(2,'0')}`;} while(reserved.has(id)||used.has(id)); }
            check(idPattern.test(id)&&!used.has(id),`Duplicate or invalid ID: ${id}`);
            used.add(id); this.records.push({id,destination:d,raw,fields});
        }
        this.reserved=new Set([...reserved,...used]);
    }
    get(id) {const r=this.records.find(r=>r.id===id);check(r,`Unknown ID: ${id}`);return r;}
    apply(ops) {
        for(const op of ops) {
            check(Array.isArray(op),'Each operation must be a JSON array');
            const [code,id,key,value]=op;
            if(code==='v') {check(op.length===3&&typeof id==='string'&&typeof key==='string','v needs magicules and EP strings');check(!this.values,'Duplicate v');this.values=[id,key];continue;}
            if(code==='a') {
                const destination=id, newId=key, fields=value;
                check(op.length===4&&destinations.includes(destination)&&idPattern.test(newId)&&!this.reserved.has(newId),'Invalid destination or duplicate/reused ID');
                check(fields&&typeof fields==='object'&&!Array.isArray(fields),'a needs a field object');
                for(const [k,v] of Object.entries(fields)) check(labels.includes(k)&&k!=='ID'&&['string','number'].includes(typeof v),`Invalid new field: ${k}`);
                check(destination==='gm'?['R','T','D'].includes(fields.Type)&&typeof fields.Text==='string':typeof fields.Name==='string','Missing record name or GM fields');
                if('Quantity'in fields) check(Number.isFinite(fields.Quantity)&&fields.Quantity>0,'New quantity must be positive');
                const r={id:newId,destination,fields:{...fields},raw:''};r.raw=serialize(r);this.records.push(r);this.reserved.add(newId);this.changed.add(destination);continue;
            }
            if(code==='s'&&id==='body') {check(op.length===4&&key==='Name'&&typeof value==='string','Body requires Name string');this.body=escapeText(value);this.changed.add('sb');continue;}
            const r=this.get(id);this.changed.add(r.destination);
            if(code==='s') {check(op.length===4,'s needs ID, field and value');setField(r,key,value);if(key==='Quantity'&&value===0)this.records.splice(this.records.indexOf(r),1);}
            else if(code==='q') {
                check(op.length===3&&Number.isFinite(key)&&typeof r.fields.Quantity==='number','q needs a numeric quantity and signed change');
                const n=r.fields.Quantity+key;check(n>=0&&Number.isFinite(n),'Quantity would be negative');
                if(n===0)this.records.splice(this.records.indexOf(r),1);else setField(r,'Quantity',n);
            } else if(code==='d') {check(op.length===2,'d needs only an ID');this.records.splice(this.records.indexOf(r),1);}
            else if(code==='m') {
                const dest=key;
                check(op.length===3&&['sw','so','si/Materials','si/Objects','si/Skill orbs','si/Equipment'].includes(dest)&&['sw','so','si/Materials','si/Objects','si/Skill orbs','si/Equipment'].includes(r.destination),'m requires an item destination');
                check(dest!==r.destination,'Move destination equals source');
                if((r.fields.Quantity??1)>1) {
                    setField(r,'Quantity',r.fields.Quantity-1);
                    const copy=structuredClone(r);let n=1;do{copy.id=`${id}_split${n++}`;}while(this.reserved.has(copy.id));
                    delete copy.fields.ID;copy.raw=copy.raw.replace(/;?\s*ID:\s*[^;<|]+;?/, ';');setField(copy,'Quantity',1);copy.destination=dest;
                    this.reserved.add(copy.id);this.records.push(copy);
                } else r.destination=dest;
                this.changed.add(dest);
            } else throw new Error(`Unknown operation: ${code}`);
        }
        check(this.records.filter(r=>r.destination==='gm').length<=20,'GM notebook exceeds 20 entries; include explicit prune commands');
    }
    render() {
        let ts=this.status||'<ts><sa><sv>Unknown|Unknown</sv><sb>Unknown</sb><sw>None</sw><so>None</so></sa><ss>None</ss><si>None</si></ts>';
        const replace=(name,content,parent)=>{const m=tag(ts,name);if(m)ts=ts.replace(m[0],()=>`<${name}>${content}</${name}>`);else ts=ts.replace(`</${parent}>`,()=>`<${name}>${content}</${name}></${parent}>`);};
        if(this.values) replace('sv',this.values.map(escapeText).join('|'),'sa');
        if(this.changed.has('sb')) replace('sb',this.body,'sa');
        for(const d of ['sw','so','ss','st','sc','sd']) if(this.changed.has(d)) {
            if(['st','sc','sd'].includes(d)&&!tag(ts,'sx')) ts=ts.replace('</ts>','<sx></sx></ts>');
            replace(d,this.records.filter(r=>r.destination===d).map(r=>r.raw).join('')||'None',['sw','so'].includes(d)?'sa':['st','sc','sd'].includes(d)?'sx':'ts');
        }
        for(const group of ['Materials','Objects','Skill orbs','Equipment']) if(this.changed.has('si/'+group)) {
            let si=tag(ts,'si')?.[1]??''; const re=new RegExp(`<sg>${group}\\|[\\s\\S]*?</sg>`);
            const rows=this.records.filter(r=>r.destination==='si/'+group).map(r=>r.raw).join('');
            if(re.test(si))si=si.replace(re,()=>rows?`<sg>${group}|${rows}</sg>`:'');
            else if(rows)si=(si.trim()==='None'?'':si)+`<sg>${group}|${rows}</sg>`;
            replace('si',si||'None','ts');
        }
        const hasStatus=this.status||this.values||[...this.changed].some(d=>d!=='gm'&&d!=='fac');
        const blocks=hasStatus?[ts]:[];
        for(const d of ['fac','gm']) {
            const old=htmlSection(this.original,d)?.raw;
            if(!this.changed.has(d)&&old){blocks.push(old);continue;}
            if(!old&&!this.changed.has(d))continue;
            const title=d==='fac'?'🏳️ FACTIONS':"📓 GM'S NOTEBOOK";
            blocks.push(`<details><summary>${title}</summary>\n${this.records.filter(r=>r.destination===d).map(r=>r.raw).join('\n')||'None'}\n</details>`);
        }
        const map=Object.create(null),indices={};
        for(const d of destinations)for(const r of this.records.filter(r=>r.destination===d)){const i=indices[d]??0;map[r.id]=[d,i];indices[d]=i+1;}
        // Include retired IDs so newly generated records cannot reuse deleted IDs.
        for(const id of this.reserved)if(id!=='body'&&!Object.hasOwn(map,id))map[id]=null;
        blocks.push(`<!-- TD_IDS ${JSON.stringify(map)} -->`);
        return blocks.join('\n\n');
    }
}

export function snapshots(text) {return [...text.matchAll(/<internal_states>[\s\S]*?<\/internal_states>/g)];}
export function previousSnapshot(chat,index) {
    for(let i=index-1;i>=0;i--) {
        if(chat[i].is_user||chat[i].is_system)continue;
        const candidates=snapshots(chat[i].mes??'').filter(m=>!m[0].includes('<delta>'));
        if(candidates.length)return candidates.at(-1)[0];
        check(!(chat[i].mes??'').includes('<delta>'),'Preceding message has an unresolved delta; repair it first');
    }
    return '';
}

export function mergeMessage(text, baseline='') {
    if(!text.includes('<delta>'))return {text,changed:false};
    const matches=[...text.matchAll(/<delta>([\s\S]*?)<\/delta>/g)];
    check(matches.length===1,'Expected one complete delta block; unfinished or multiple blocks are not applied');
    const delta=matches[0], containers=snapshots(text);
    const container=containers.find(m=>m.index<=delta.index&&m.index+m[0].length>=delta.index+delta[0].length);
    check(container,'Delta must be inside a complete internal_states block');
    const inline=containers.filter(m=>m.index<container.index&&!m[0].includes('<delta>')).at(-1);
    // An appended delta in the same container can use an existing inline full tracker.
    const ownBase=tag(container[0],'ts')?container[0].replace(delta[0],''):null;
    const state=new Tracker(ownBase??inline?.[0]??baseline);
    const lines=delta[1].trim().split(/\r?\n/).filter(l=>l.trim());
    const ops=lines.map((line,i)=>{try{return JSON.parse(line);}catch{throw new Error(`Invalid JSON on delta line ${i+1}`);}});
    check(!state.status||ops.some(o=>o[0]==='v'),'Existing Status requires current magicules and EP (v)');
    state.apply(ops);
    let replacement=container[0];
    // Remove only the three static trackers, leaving every other generated section intact.
    const removals=[];
    const oldTs=tag(replacement,'ts');if(oldTs)removals.push({start:oldTs.index,end:oldTs.index+oldTs[0].length});
    for(const d of ['fac','gm']){const b=htmlSection(replacement,d);if(b)removals.push(b);}
    for(const m of replacement.matchAll(/<!-- TD_IDS [\s\S]*? -->/g))removals.push({start:m.index,end:m.index+m[0].length});
    for(const r of removals.sort((a,b)=>b.start-a.start))replacement=replacement.slice(0,r.start)+replacement.slice(r.end);
    replacement=replacement.replace(delta[0],()=>state.render());
    let output=text.slice(0,container.index)+replacement+text.slice(container.index+container[0].length);
    // Continuations leave one current Internal States snapshot, preserving narrative.
    for(const old of containers.filter(m=>m.index<container.index).reverse()) {
        let start=old.index,end=start+old[0].length;
        const before=output.slice(0,start),after=output.slice(end);
        const open=/<!--\s*GFX_START\s*-->\s*$/.exec(before),close=/^\s*<!--\s*GFX_END\s*-->/.exec(after);
        if(open&&close){start=open.index;end+=close[0].length;}
        output=output.slice(0,start)+output.slice(end);
    }
    return {text:output,changed:true};
}
