// Gameクラスの中に以下を記述 (他のメソッドは既存のまま)
    showContext(mx,my){
        const p=Renderer.pxToHex(mx,my);
        const m=document.getElementById('context-menu');
        if(!m) return;

        const u=this.getUnit(p.q,p.r);
        const t=this.isValidHex(p.q,p.r)?this.map[p.q][p.r]:null; 
        
        let h=""; 
        if(u){
            h+=`<div style="color:#0af;font-weight:bold">${u.name}</div>`;
            h+=`<div style="font-size:10px">${u.def.name} (${RANKS[u.rank]})</div>`;
            h+=`HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br>`;
            h+=`Stance: ${u.stance}`;
        } else if(t){
            h+=`<div style="color:#da4;font-weight:bold">${t.name}</div>`;
            h+=`Cost:${t.cost} Cover:${t.cover}%`; 
        }
        
        // Turn End Button
        h+=`<hr style="border:0;border-top:1px solid #444;margin:5px 0;">`;
        h+=`<button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`;
        
        if(h!=="") {
            m.innerHTML=h;
            m.style.display='block'; 
            m.style.left=(mx+10)+'px'; 
            m.style.top=(my+10)+'px';
        }
    }
