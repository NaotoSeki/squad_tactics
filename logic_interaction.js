/** LOGIC INTERACTION: User Input & Mode Management */

class InteractionManager {
    constructor(game) {
        this.game = game;
        this.mode = 'SELECT'; // 'SELECT', 'MOVE', 'ATTACK', 'MELEE'
        this.path = [];
        this.reachableHexes = [];
        this.attackLine = [];
        this.aimTargetUnit = null;
    }

    setMode(mode) {
        this.mode = mode;
        this.game.ui.hideActionMenu();
        const indicator = document.getElementById('mode-label');
        
        if (mode === 'SELECT') {
            indicator.style.display = 'none';
            this.path = [];
            this.attackLine = [];
        } else {
            indicator.style.display = 'block';
            indicator.innerText = mode + " MODE";
            if (mode === 'MOVE') {
                this.calcReachableHexes(this.game.selectedUnit);
            } else if (mode === 'ATTACK') {
                this.reachableHexes = [];
            }
        }
        // ゲーム側の状態変数とも同期（念のため）
        this.game.interactionMode = mode;
    }

    clearSelection() {
        this.game.selectedUnit = null;
        this.reachableHexes = [];
        this.attackLine = [];
        this.aimTargetUnit = null;
        this.path = [];
        this.setMode('SELECT');
        this.game.ui.hideActionMenu();
        this.game.updateSidebar();
    }

    // ★修正箇所: 味方クリック時は無条件で選択へ
    handleClick(p) {
        if (this.game.state !== 'PLAY') return;
        const u = this.game.getUnitInHex(p.q, p.r);

        if (this.mode === 'SELECT') {
            if (!u) this.clearSelection();
            else this.onUnitClick(u);
        } 
        else if (this.mode === 'MOVE') {
            if (this.game.isValidHex(p.q, p.r) && this.path.length > 0) {
                const last = this.path[this.path.length - 1];
                if (last.q === p.q && last.r === p.r) {
                    this.game.actionMove(this.game.selectedUnit, this.path);
                    this.setMode('SELECT');
                }
            } else {
                this.setMode('SELECT');
            }
        } 
        else if (this.mode === 'ATTACK' || this.mode === 'MELEE') {
            if (!u) {
                this.setMode('SELECT');
            } else if (this.game.selectedUnit && u.team === this.game.selectedUnit.team) {
                // ★ここです！味方なら警告なしで即座に選択切り替え
                this.onUnitClick(u);
            } else {
                if (this.mode === 'ATTACK') this.game.actionAttack(this.game.selectedUnit, u);
                else {
                    this.game.actionMelee(this.game.selectedUnit, u);
                    this.setMode('SELECT');
                }
            }
        }
    }

    // ★修正箇所: 右クリックはキャンセルorコンテキストのみ（警告モーダル判定なし）
    handleRightClick(mx, my, hex) {
        if (this.mode !== 'SELECT') {
            this.setMode('SELECT');
            if (this.game.selectedUnit && this.game.selectedUnit.team === 'player') {
                this.game.ui.showActionMenu(this.game.selectedUnit, mx, my);
                if (window.Sfx) Sfx.play('click');
            }
        } else if (hex) {
            this.game.ui.showContext(mx, my, hex);
        }
    }

    handleHover(p) {
        if (this.game.state !== 'PLAY') return;
        this.game.hoverHex = p;
        const u = this.game.selectedUnit;
        
        if (u && u.team === 'player') {
            if (this.mode === 'MOVE') {
                const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
                if (isReachable) {
                    this.path = this.game.findPath(u, p.q, p.r);
                } else {
                    this.path = [];
                }
            } else if (this.mode === 'ATTACK') {
                this.calcAttackLine(u, p.q, p.r);
            }
        }
    }

    onUnitClick(u) {
        if (this.game.state !== 'PLAY') return;

        // 味方ユニット
        if (u.team === 'player') {
            // 選択モードでなければ強制的に選択モードへ
            if (this.mode !== 'SELECT') this.setMode('SELECT');
            
            this.game.selectedUnit = u;
            this.refreshUnitState(u);
            
            if (typeof Renderer !== 'undefined' && Renderer.game) {
                const pointer = Renderer.game.input.activePointer;
                this.game.ui.showActionMenu(u, pointer.x, pointer.y);
            }
            if (window.Sfx) Sfx.play('click');
            return;
        }

        // 敵ユニット（攻撃モード中などの処理は handleClick で分岐済みなので、ここは「純粋なクリック」）
        // 攻撃・白兵モード中に敵をクリックした場合は handleClick で処理されるため、
        // ここに来るのは「選択モードで敵をクリックした（ステータス確認）」場合
        this.game.selectedUnit = u;
        this.refreshUnitState(u);
        this.game.ui.hideActionMenu();
    }

    refreshUnitState(u) {
        if (!u || u.hp <= 0) {
            this.game.selectedUnit = null;
            this.reachableHexes = [];
            this.attackLine = [];
            this.aimTargetUnit = null;
        }
        this.game.updateSidebar();
    }

    calcReachableHexes(u) {
        this.reachableHexes = [];
        if (!u || u.team !== 'player') return;

        let frontier = [{ q: u.q, r: u.r, cost: 0 }];
        let costSoFar = new Map();
        costSoFar.set(`${u.q},${u.r}`, 0);

        while (frontier.length > 0) {
            let current = frontier.shift();
            this.game.getNeighbors(current.q, current.r).forEach(n => {
                if (this.game.getUnitsInHex(n.q, n.r).length >= 4) return;
                const cost = this.game.map[n.q][n.r].cost;
                if (cost >= 99) return;
                
                const newCost = costSoFar.get(`${current.q},${current.r}`) + cost;
                if (newCost <= u.ap) {
                    const key = `${n.q},${n.r}`;
                    if (!costSoFar.has(key) || newCost < costSoFar.get(key)) {
                        costSoFar.set(key, newCost);
                        frontier.push({ q: n.q, r: n.r });
                        this.reachableHexes.push({ q: n.q, r: n.r });
                    }
                }
            });
        }
        // ゲーム側の変数にも反映（描画用）
        this.game.reachableHexes = this.reachableHexes;
    }

    calcAttackLine(u, targetQ, targetR) {
        this.attackLine = [];
        this.aimTargetUnit = null;
        if (!u || u.ap < 2) return;
        const w = u.hands;
        if (!w) return;

        const range = w.rng;
        const dist = this.game.hexDist(u, { q: targetQ, r: targetR });
        if (dist === 0) return;

        const drawLen = Math.min(dist, range);
        const start = this.game.axialToCube(u.q, u.r);
        const end = this.game.axialToCube(targetQ, targetR);

        for (let i = 1; i <= drawLen; i++) {
            const t = i / dist;
            const lerpCube = {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
                z: start.z + (end.z - start.z) * t
            };
            const roundCube = this.game.cubeRound(lerpCube);
            const hex = this.game.cubeToAxial(roundCube);
            if (this.game.isValidHex(hex.q, hex.r)) {
                this.attackLine.push({ q: hex.q, r: hex.r });
            } else {
                break;
            }
        }
        if (this.attackLine.length > 0) {
            const lastHex = this.attackLine[this.attackLine.length - 1];
            if (lastHex.q === targetQ && lastHex.r === targetR) {
                const target = this.game.getUnitInHex(lastHex.q, lastHex.r);
                if (target && target.team !== u.team) {
                    this.aimTargetUnit = target;
                }
            }
        }
        // ゲーム側の変数にも反映
        this.game.attackLine = this.attackLine;
        this.game.aimTargetUnit = this.aimTargetUnit;
    }
}
