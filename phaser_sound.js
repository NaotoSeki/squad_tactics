/** PHASER SOUND ENGINE (Asset Manager + Synth Fallback + Throttling) */
const Sfx = {
    ctx: null,
    
    // 登録された音声アセット
    assets: {
        'reload': 'asset/audio/001_reload.wav',
        'mg42':   'asset/audio/002_mg42.wav',
        // ★追加: 戦車砲リロード音
        'tank_reload': 'asset/audio/003_tank_gun_reload.wav'
    },

    /**
     * ラウンドロビン音源群。キーは**武器コード**（logic_game.js が
     * `Sfx.play(w.code, 'shot')` と武器コードで呼ぶ）。
     *
     * 同じ1ファイルを連打すると機械的に聞こえる。実銃の連射は一発ごとに
     * 微妙に違うので、複数テイクを袋（shuffle bag）から引いて重複を避ける。
     * 素材は scripts/audio/wav_chop.py で長尺WAVから切り出したもの。
     */
    variantGroups: {
        // M1 Garand: 実録音 66秒素材から10テイクを切り出し（相関の中央値0.20＝別テイク）
        'm1': [
            'm1_shot_01', 'm1_shot_02', 'm1_shot_03', 'm1_shot_04', 'm1_shot_05',
            'm1_shot_06', 'm1_shot_07', 'm1_shot_08', 'm1_shot_09', 'm1_shot_10',
        ],
    },
    variantPathOf(key) { return 'asset/audio/sfx/' + key + '.wav'; },
    _bags: {},
    _lastVariant: {},

    /**
     * 群から1つ選ぶ。袋が空になるまで重複せず、袋を作り直す時も直前と同じテイクが
     * 先頭に来ないようにする（"ランダム"だと体感的に同じ音が続いて聞こえるため）。
     */
    pickVariant(id) {
        const list = this.variantGroups[id];
        if (!list || !list.length) return null;
        let bag = this._bags[id];
        if (!bag || bag.length === 0) {
            bag = list.slice();
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
            }
            if (bag.length > 1 && bag[bag.length - 1] === this._lastVariant[id]) {
                const t = bag[bag.length - 1]; bag[bag.length - 1] = bag[0]; bag[0] = t;
            }
            this._bags[id] = bag;
        }
        const pick = bag.pop();
        this._lastVariant[id] = pick;
        return pick;
    },

    /** 音を鳴らせるシーンを探す。本編は MainScene、sim_battle は別シーン名。 */
    _soundScene() {
        const games = [window.phaserGame, window.simGame].filter(Boolean);
        for (const g of games) {
            const scenes = (g.scene && g.scene.getScenes) ? g.scene.getScenes(true) : [];
            for (const s of scenes) if (s && s.sound) return s;
        }
        return null;
    },

    // 再生間隔の制限 (ms)
    throttles: {
        'mg42': 2000, // 1回の攻撃アクションが終わるまで次を鳴らさない
        'tank_reload': 1500  // 敵戦車の連続射撃で2回鳴るのを防止
    },
    lastPlayTime: {},

    init() { 
        if(!this.ctx) this.ctx = new (window.AudioContext||window.webkitAudioContext)(); 
        if(this.ctx.state==='suspended') this.ctx.resume();
        if (!this._visibilityBound) {
            this._visibilityBound = () => {
                const now = Date.now();
                if (document.visibilityState === 'hidden') {
                    if (window.phaserGame) {
                        const main = window.phaserGame.scene.getScene('MainScene');
                        if (main && main.sound) main.sound.stopAll();
                    }
                    Object.keys(this.lastPlayTime || {}).forEach(k => { this.lastPlayTime[k] = now; });
                } else {
                    Object.keys(this.lastPlayTime || {}).forEach(k => { this.lastPlayTime[k] = now; });
                    if (window.phaserGame) {
                        const main = window.phaserGame.scene.getScene('MainScene');
                        if (main && main.sound) main.sound.stopAll();
                    }
                }
            };
            document.addEventListener('visibilitychange', this._visibilityBound);
        }
    },

    preload(scene) {
        for (const [key, path] of Object.entries(this.assets)) {
            scene.load.audio(key, path);
        }
        for (const list of Object.values(this.variantGroups)) {
            for (const key of list) scene.load.audio(key, this.variantPathOf(key));
        }
    },

    noise(dur, freq, type='lowpass', vol=0.2) {
        if(!this.ctx) return; 
        const t=this.ctx.currentTime;
        const b=this.ctx.createBuffer(1,this.ctx.sampleRate*dur,this.ctx.sampleRate);
        const d=b.getChannelData(0);
        for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(d.length*0.3));
        const s=this.ctx.createBufferSource(); s.buffer=b;
        const f=this.ctx.createBiquadFilter(); f.type=type; f.frequency.value=freq;
        const g=this.ctx.createGain(); 
        g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.01,t+dur);
        s.connect(f); f.connect(g); g.connect(this.ctx.destination);
        s.start(t);
    },
    tone(freq, type, dur, vol=0.1) {
        if(!this.ctx) return;
        const t=this.ctx.currentTime;
        const o=this.ctx.createOscillator(); o.type=type; o.frequency.value=freq;
        const g=this.ctx.createGain();
        g.gain.setValueAtTime(vol, t); g.gain.linearRampToValueAtTime(0, t+dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t+dur);
    },
    metalImpact() {
        if(!this.ctx) return;
        const t = this.ctx.currentTime;
        const o1 = this.ctx.createOscillator(); o1.type = 'square'; o1.frequency.setValueAtTime(800, t); o1.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        const g1 = this.ctx.createGain(); g1.gain.setValueAtTime(0.1, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(2000, t); o2.frequency.linearRampToValueAtTime(1500, t + 0.3);
        const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.05, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o1.connect(g1); g1.connect(this.ctx.destination); o2.connect(g2); g2.connect(this.ctx.destination);
        o1.start(t); o1.stop(t + 0.15); o2.start(t); o2.stop(t + 0.3);
    },

    /** ソフトターゲット命中: 短いキレのよい肉弾着音 */
    softHit() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const dur = 0.06;
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.15));
        const s = this.ctx.createBufferSource(); s.buffer = b;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.ctx.destination);
        s.start(t);
    },

    /** ハードターゲット命中（リコシェ）: 短い金属的な跳弾音 */
    hardHit() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.08);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t + 0.08);
    },

    play(id, fallbackType = null) {
        this.init();

        if (id === 'tank_reload') return;
        if (document.visibilityState === 'hidden') return;

        if (window.gameLogic && window.gameLogic.isProcessingTurn) {
            const quiet = ['move', 'swap', 'click'];
            const ft = fallbackType || id;
            if (quiet.includes(id) || quiet.includes(ft)) return;
        }

        // スロットリング処理
        if (this.throttles[id]) {
            const now = Date.now();
            const last = this.lastPlayTime[id] || 0;
            if (now - last < this.throttles[id]) {
                return; 
            }
            this.lastPlayTime[id] = now;
        }

        // 1a. ラウンドロビン群が登録されていれば、そこから1テイク引いて再生
        if (this.variantGroups[id]) {
            const scene = this._soundScene();
            const key = scene && this.pickVariant(id);
            if (key && scene.sound && (!scene.cache || !scene.cache.audio || scene.cache.audio.exists(key))) {
                scene.sound.play(key, { volume: 0.45 });
                return;
            }
        }

        // 1b. assetsに登録されたIDなら、WAVファイルを再生
        if (this.assets[id]) {
            const scene = this._soundScene();
            if (scene && scene.sound) {
                const vol = (id === 'tank_reload') ? 0.28 : 0.4;
                scene.sound.play(id, { volume: vol });
                return;
            }
        }

        // 2. なければ従来のシンセ音を使用
        const target = fallbackType || id;

        if(target==='click') this.tone(1200, 'sine', 0.05, 0.05);
        else if(target==='move') this.noise(0.1, 300, 'lowpass', 0.1);
        else if(target==='swap') this.tone(600, 'square', 0.1, 0.05);
        else if(target==='shot') { this.noise(0.1, 2000, 'highpass', 0.2); this.noise(0.3, 500, 'lowpass', 0.3); }
        else if(target==='mg') this.noise(0.08, 1200, 'bandpass', 0.15);
        else if(target==='cannon') { this.noise(0.6, 100, 'lowpass', 0.6); this.noise(0.3, 400, 'lowpass', 0.4); }
        else if(target==='boom') { this.noise(1.2, 60, 'lowpass', 0.8); this.noise(0.5, 200, 'lowpass', 0.5); }
        else if(target==='rocket') { this.noise(1.5, 120, 'lowpass', 0.6); }
        else if(target==='ricochet') { this.metalImpact(); }
        else if(target==='soft_hit' || target==='hit') { this.softHit(); }
        else if(target==='hard_hit') { this.hardHit(); }
        else if(target==='death') { this.noise(0.5, 150, 'lowpass', 0.5); }
        else if(target==='win') { 
            setTimeout(()=>this.tone(440,'square',0.1),0);
            setTimeout(()=>this.tone(554,'square',0.1),150);
            setTimeout(()=>this.tone(659,'square',0.4),300);
        }
    }
};
window.Sfx = Sfx;
