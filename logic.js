/**
 * GAME LOGIC
 * ゲームのルール、マップデータ、ユニット管理、戦闘計算を担当
 */

const MAP_W = 15; // マップ幅
const MAP_H = 9;  // マップ高さ
const HEX_SIZE = 40; // ヘックスサイズ（描画と共有）

class GameLogic {
    constructor() {
        this.map = [];
        this.units = [];
        this.selectedUnit = null;
        this.reachableHexes = [];
        this.path = [];
        this.hoverHex = null;
        this.turn = 1;
        
        this.init();
    }

    init() {
        this.generateMap();
        this.spawnInitialUnits();
    }

    // マップ生成 (簡易的)
    generateMap() {
        this.map = [];
        for (let q = 0; q < MAP_W; q++) {
            this.map[q] = [];
            for (let r = 0; r < MAP_H; r++) {
                // 0:平地, 1:森, 2:山, -1:無効
                let id = 0; 
                if (Math.random() < 0.1) id = 1; // 森
                if (Math.random() < 0.05) id = 2; // 山
                this.map[q][r] = { q, r, id };
            }
        }
    }

    // 初期ユニット配置
    spawnInitialUnits() {
        // 味方
        this.spawnUnit(2, 4, 'player', 'infantry');
        this.spawnUnit(2, 5, 'player', 'tank');
        
        // 敵
        this.spawnUnit(10, 4, 'enemy', 'infantry');
        this.spawnUnit(11, 5, 'enemy', 'tiger');
    }

    spawnUnit(q, r, team, type) {
        let hp = 100;
        let maxHp = 100;
        let isTank = false;

        if (type === 'tank' || type === 'tiger') {
            hp = 300; maxHp = 300; isTank = true;
        } else if (type === 'heal') {
            // ユニットではないが、今回は簡易的にユニットとして扱う場合
        }

        const unit = {
            id: Math.random().toString(36).substr(2, 9),
            q, r, team, type,
            hp, maxHp,
            def: { isTank } // 定義データ
        };
        this.units.push(unit);
    }

    // --- ★ここが追加された爆撃処理 ---
    applyBombardment(targetHex) {
        console.log(`[Logic] Aerial Bombardment at ${targetHex.q}, ${targetHex.r}`);
        
        // 着弾地点にいるユニットを探す
        const targetUnit = this.units.find(u => u.q === targetHex.q && u.r === targetHex.r);

        if (targetUnit) {
            // 命中率 75%
            if (Math.random() < 0.75) {
                const dmg = 500;
                targetUnit.hp -= dmg;
                console.log(`HIT! Unit ${targetUnit.type} took ${dmg} damage. Remaining HP: ${targetUnit.hp}`);
                
                // HP減少エフェクト (ダメージポップアップなどを出すならここ)
                
                // 撃破判定
                if (targetUnit.hp <= 0) {
                    targetUnit.hp = 0;
                    console.log("Unit Destroyed!");
                    // 撃破時の追加爆発など
                    if(window.VFX) {
                        const pos = this.hexToPx(targetUnit.q, targetUnit.r);
                        window.VFX.addExplosion(pos.x, pos.y, '#ff0', 20);
                    }
                }
            } else {
                console.log("MISS! The bomb missed the target.");
            }
        } else {
            console.log("No unit at impact point.");
        }
    }

    // 通常のカード使用によるユニット配置
    deployUnit(targetHex, cardType) {
        // 既にユニットがいるかチェック
        const existing = this.units.find(u => u.q === targetHex.q && u.r === targetHex.r);
        if (existing) {
            console.log("Cannot deploy: Unit already exists here.");
            return;
        }
        
        // ユニット生成
        this.spawnUnit(targetHex.q, targetHex.r, 'player', cardType);
        
        // 出現エフェクト
        if(window.VFX) {
            const pos = this.hexToPx(targetHex.q, targetHex.r);
            window.VFX.addSmoke(pos.x, pos.y);
        }
    }

    // クリックハンドリング (移動・攻撃)
    handleClick(hex) {
        // ユニット選択
        const clickedUnit = this.units.find(u => u.q === hex.q && u.r === hex.r);
        
        if (clickedUnit) {
            if (clickedUnit.team === 'player') {
                this.selectedUnit = clickedUnit;
                this.calculateReach(clickedUnit);
                console.log("Selected:", clickedUnit);
            } else {
                // 敵をクリック（攻撃など）
                if (this.selectedUnit) {
                    this.attack(this.selectedUnit, clickedUnit);
                }
            }
        } else {
            // 地面をクリック（移動）
            if (this.selectedUnit && this.isReachable(hex)) {
                this.moveUnit(this.selectedUnit, hex);
            } else {
                this.selectedUnit = null;
                this.reachableHexes = [];
            }
        }
    }

    handleHover(hex) {
        this.hoverHex = hex;
        // パス計算などをここで行う
        if (this.selectedUnit) {
            // 簡易パスファインディング表示などが可能
        }
    }

    isReachable(hex) {
        return this.reachableHexes.some(h => h.q === hex.q && h.r === hex.r);
    }

    calculateReach(unit) {
        // 簡易的な移動範囲計算 (距離2以内)
        this.reachableHexes = [];
        const range = 2;
        for (let q = -range; q <= range; q++) {
            for (let r = -range; r <= range; r++) {
                if (Math.abs(q + r) <= range) { // Hex distance logic
                    const tq = unit.q + q;
                    const tr = unit.r + r;
                    // マップ範囲内かつ障害物なしなら
                    if (this.isValidHex(tq, tr)) {
                        this.reachableHexes.push({ q: tq, r: tr });
                    }
                }
            }
        }
    }

    isValidHex(q, r) {
        if (q < 0 || q >= MAP_W || r < 0 || r >= MAP_H) return false;
        // 他のユニットがいるか
        if (this.units.some(u => u.q === q && u.r === r)) return false;
        // 山は進入不可
        if (this.map[q][r].id === 2) return false;
        return true;
    }

    moveUnit(unit, hex) {
        unit.q = hex.q;
        unit.r = hex.r;
        this.selectedUnit = null;
        this.reachableHexes = [];
        console.log("Moved to", hex);
    }

    attack(attacker, defender) {
        const dmg = 30;
        defender.hp -= dmg;
        console.log("Attacked!", defender.hp);
        
        // 攻撃エフェクト
        if (window.VFX) {
            const start = this.hexToPx(attacker.q, attacker.r);
            const end = this.hexToPx(defender.q, defender.r);
            window.VFX.addProj({
                sx: start.x, sy: start.y, ex: end.x, ey: end.y,
                speed: 0.1, arcHeight: 50, type: 'shell',
                onHit: () => {
                    window.VFX.addExplosion(end.x, end.y, '#fa0', 10);
                }
            });
        }

        if (defender.hp <= 0) {
            defender.hp = 0;
            // 撃破
        }
        this.selectedUnit = null;
        this.reachableHexes = [];
    }

    showContext(mx, my) {
        console.log("Right click at", mx, my);
    }

    // ヘルパー: Hex座標 -> ピクセル座標 (VFX用)
    hexToPx(q, r) {
        return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) };
    }
}

// グローバルインスタンス化
window.gameLogic = new GameLogic();
