/** * PHASER BRIDGE
 * logic.js からの命令を受け取り、Phaser 3で描画を行うアダプタークラス
 */

let phaserScene = null; // 外部アクセス用

const Renderer = {
    game: null,
    
    // logic.js が呼ぶ初期化関数
    init(canvasElement) {
        // 既存のCanvas要素はPhaserが置換/管理するため、ID指定だけ行う
        const config = {
            type: Phaser.AUTO,
            parent: 'game-view',
            width: document.getElementById('game-view').clientWidth,
            height: document.getElementById('game-view').clientHeight,
            backgroundColor: '#0b0e0a',
            scene: MainScene,
            fps: { target: 60 },
            physics: { default: 'arcade', arcade: { debug: false } }
        };
        this.game = new Phaser.Game(config);
        
        // リサイズ対応
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        if(this.game) {
            const w = document.getElementById('game-view').clientWidth;
            const h = document.getElementById('game-view').clientHeight;
            this.game.scale.resize(w, h);
        }
    },

    centerOn(q, r) {
        if(phaserScene) phaserScene.centerCamera(q, r);
    },

    // 座標変換ユーティリティ
    hexToPx(q, r) {
        return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) };
    },
    
    pxToHex(mx, my) {
        if(!phaserScene) return {q:0, r:0};
        // Phaserのカメラ位置を加味した座標変換
        const worldPoint = phaserScene.cameras.main.getWorldPoint(mx, my);
        const q = (2/3 * worldPoint.x) / HEX_SIZE;
        const r = (-1/3 * worldPoint.x + Math.sqrt(3)/3 * worldPoint.y) / HEX_SIZE;
        return this.roundHex(q, r);
    },

    roundHex(q,r) { 
        let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); 
        const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); 
        if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; 
        return {q:rq, r:rr}; 
    },

    // 旧logicとの互換用（Phaserループで描画するので中身は空で良い）
    frame: 0,
    draw() { /* No-op */ }
};

/**
 * Phaser Main Scene
 */
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.hexGroup = null;
        this.unitGroup = null;
        this.overlayGraphics = null;
        this.mapGenerated = false;
        this.hexSprites = new Map(); // q,r -> Sprite
    }

    preload() {
        // --- 動的テクスチャ生成 ---
        const g = this.make.graphics({x:0, y:0, add:false});
        
        // 1. Hexagon Texture
        g.lineStyle(2, 0xffffff, 1);
        g.fillStyle(0xffffff, 1);
        g.beginPath();
        for(let i=0; i<6; i++) {
            g.lineTo(HEX_SIZE * Math.cos(Math.PI/3*i), HEX_SIZE * Math.sin(Math.PI/3*i));
        }
        g.closePath();
        g.fillPath();
        g.strokePath();
        g.generateTexture('hex_base', HEX_SIZE*2, HEX_SIZE*2);

        // 2. Unit Textures (簡易)
        g.clear();
        g.fillStyle(0x00ff00, 1); g.fillCircle(16, 16, 10);
        g.generateTexture('unit_player', 32, 32);
        
        g.clear();
        g.fillStyle(0xff0000, 1); g.fillRect(4, 4, 24, 24);
        g.generateTexture('unit_enemy', 32, 32);

        // 3. Selection Cursor
        g.clear();
        g.lineStyle(3, 0x00ff00, 1); g.strokeCircle(32, 32, 28);
        g.generateTexture('cursor', 64, 64);
    }

    create() {
        phaserScene = this;
        this.cameras.main.setBackgroundColor('#0b0e0a');
        
        // グループ
        this.hexGroup = this.add.group();
        this.unitGroup = this.add.group(); // ユニット用
        this.vfxGroup = this.add.group();  // エフェクト用
        this.overlayGraphics = this.add.graphics(); // 射程範囲などの描画用

        // 入力イベント
        this.input.on('pointerdown', (pointer) => {
            // 左クリック
            if(pointer.button === 0) {
                const hex = Renderer.pxToHex(pointer.x, pointer.y);
                if(window.gameLogic) window.gameLogic.handleClick(hex);
            }
            // 右クリック（コンテキストメニュー）
            else if(pointer.button === 2) {
                if(window.gameLogic) window.gameLogic.showContext(pointer.x, pointer.y);
            }
        });

        // カメラ操作（ドラッグ）
        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown) {
                this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x);
                this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y);
            }
        });

        // 右クリックメニュー抑制
        this.input.mouse.disableContextMenu();
    }

    update(time, delta) {
        if (!window.gameLogic) return;

        // 1. マップ生成同期
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) {
            this.createMap();
            this.mapGenerated = true;
        }

        // 2. ユニット同期（簡易実装：毎回クリアして再描画）
        // ※ 本来はID管理してtweenさせるべきだが、まずは移植優先
        this.unitGroup.clear(true, true);
        
        window.gameLogic.units.forEach(u => {
            if(u.hp <= 0) return;
            const pos = Renderer.hexToPx(u.q, u.r);
            const texture = u.team === 'player' ? 'unit_player' : 'unit_enemy';
            
            // ユニットコンテナ
            const container = this.add.container(pos.x, pos.y);
            const sprite = this.add.sprite(0, 0, texture);
            
            // 色分け
            if(u.def.isTank) sprite.setTint(0x888888);
            if(u.team === 'player') sprite.setTint(0x6688aa);
            else sprite.setTint(0xcc6655);

            container.add(sprite);

            // HPバー
            const hpPct = u.hp / u.maxHp;
            const bar = this.add.rectangle(0, -20, 20, 4, 0x000000);
            const barFill = this.add.rectangle(-10 + (10*hpPct), -20, 20*hpPct, 4, hpPct > 0.5 ? 0x00ff00 : 0xff0000);
            container.add([bar, barFill]);

            // 選択中ハイライト
            if(window.gameLogic.selectedUnit === u) {
                const cursor = this.add.image(0, 0, 'cursor');
                this.tweens.add({
                    targets: cursor,
                    scale: { from: 1, to: 1.1 },
                    alpha: { from: 1, to: 0.5 },
                    yoyo: true, repeat: -1, duration: 800
                });
                container.add(cursor);
            }

            this.unitGroup.add(container);
        });

        // 3. オーバーレイ描画（射程・移動パス）
        this.overlayGraphics.clear();
        const selected = window.gameLogic.selectedUnit;
        
        // 射程表示
        if(selected && selected.ap >= 2) {
            const wpn = WPNS[selected.curWpn];
            const q = selected.q, r = selected.r;
            // 簡易的な範囲描画（Logicと同じロジックで円を描く）
            // ※ 正確にはHexを塗るべきだが、一旦円で表現
            const center = Renderer.hexToPx(q, r);
            this.overlayGraphics.lineStyle(2, 0xff0000, 0.3);
            this.overlayGraphics.strokeCircle(center.x, center.y, wpn.rng * HEX_SIZE * 1.5); // 概算サイズ
        }

        // パス表示
        const path = window.gameLogic.path;
        if(path.length > 0 && selected) {
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5);
            this.overlayGraphics.beginPath();
            const start = Renderer.hexToPx(selected.q, selected.r);
            this.overlayGraphics.moveTo(start.x, start.y);
            path.forEach(p => {
                const pos = Renderer.hexToPx(p.q, p.r);
                this.overlayGraphics.lineTo(pos.x, pos.y);
            });
            this.overlayGraphics.strokePath();
        }
    }

    createMap() {
        const map = window.gameLogic.map;
        for(let q=0; q<MAP_W; q++) {
            for(let r=0; r<MAP_H; r++) {
                const t = map[q][r];
                if(t.id === -1) continue;

                const pos = Renderer.hexToPx(q, r);
                const hex = this.add.image(pos.x, pos.y, 'hex_base');
                
                // 地形色設定
                let tint = 0x555555;
                if(t.id === 0) tint = 0x5a5245; // Dirt
                else if(t.id === 1) tint = 0x425030; // Grass
                else if(t.id === 2) tint = 0x222e1b; // Forest
                else if(t.id === 4) tint = 0x504540; // Town
                else if(t.id === 5) tint = 0x303840; // Water
                
                hex.setTint(tint);
                
                // 森の場合は木を生やす（円で表現）
                if(t.id === 2) {
                    const tree = this.add.circle(pos.x, pos.y, HEX_SIZE*0.6, 0x112211, 0.5);
                    this.hexGroup.add(tree);
                }
                
                this.hexGroup.add(hex);
                this.hexSprites.set(`${q},${r}`, hex);
            }
        }
    }

    centerCamera(q, r) {
        const pos = Renderer.hexToPx(q, r);
        this.cameras.main.centerOn(pos.x, pos.y);
    }
}

// サウンド互換用（エラー防止のダミー）
// ※ 後でPhaserのSound Managerに置き換えると良いです
const Sfx = {
    play(id) { 
        // console.log("Sound:", id); 
    }
};

// VFX互換用（パーティクルなど）
// ※ これもPhaserのParticle Emitterに置き換えるべきですが、一旦空実装でエラー回避
const VFX = {
    debris: [],
    add(p) {}, addProj(p) {}, addExplosion(x,y,c){}, 
    addUnitDebris(x,y){}, addStaticDebris(q,r,t){ 
        // 静的デブリはMap上にSpriteを置く形に変えると良い
    },
    update() {}, draw(ctx) {}
};
