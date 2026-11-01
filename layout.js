const titles=/^(?:NPC LOCATIONS|STATUS|FACTIONS|GM['’]S NOTEBOOK|DND TASK SIM|PHYSICS,? ENGINE\s*&\s*WORLD|NPC THOUGHTS|NPC AGENDAS|BONDS|CHEKHOV)/i;
const normalized=text=>text.replace(/^[^A-Za-z]+/,'').trim();

// Touch only recognized tracker panels inside chat messages, never narrative spacing.
export function compactTrackerPanels(root) {
    for(const panel of root.querySelectorAll('details')) {
        const summary=[...panel.children].find(n=>n.tagName==='SUMMARY');
        if(!summary||!titles.test(normalized(summary.textContent)))continue;
        panel.classList.add('td-tracker-panel');
    }
    for(const panel of root.querySelectorAll('.td-tracker-panel')) {
        const separators=[];
        let next=panel.nextSibling;
        while(next) {
            if(next.nodeType===3&&!next.textContent.trim()) {next=next.nextSibling;continue;}
            if(next.nodeType===8) {next=next.nextSibling;continue;}
            if(next.nodeType===1&&(next.tagName==='BR'||(next.tagName==='P'&&[...next.childNodes].every(n=>n.nodeType===3&&!n.textContent.trim()||n.nodeType===1&&n.tagName==='BR')))) {
                separators.push(next);next=next.nextSibling;continue;
            }
            break;
        }
        if(next?.nodeType===1&&next.classList.contains('td-tracker-panel')) {
            panel.classList.add('td-tracker-adjacent');
            for(const separator of separators)separator.remove();
        } else panel.classList.remove('td-tracker-adjacent');
    }
}

export function installLayout() {
    if(typeof document==='undefined')return;
    if(!document.getElementById('td-compact-style')) {
        const style=document.createElement('style');style.id='td-compact-style';
        style.textContent='.mes_text details.td-tracker-panel.td-tracker-adjacent{margin-bottom:2px!important}.mes_text details.td-tracker-panel.td-tracker-adjacent+details.td-tracker-panel{margin-top:0!important}';
        document.head.append(style);
    }
    let queued=false;
    const refresh=()=>{
        if(queued)return;
        queued=true;
        requestAnimationFrame(()=>{queued=false;for(const el of document.querySelectorAll('#chat .mes_text'))compactTrackerPanels(el);});
    };
    const chat=document.getElementById('chat');
    if(chat)new MutationObserver(refresh).observe(chat,{childList:true,subtree:true,characterData:true});
    refresh();
}
