/** PHASER SOUND ENGINE (Asset Manager + Synth Fallback + Throttling) */
const Sfx = {
    ctx: null,
    _activeNodes: new Set(),
    _scheduledTimers: new Set(),
    _visibilityEpoch: 0,
    _muteUntil: 0,
    _pageActive: true,
    _windowFocused: true,
    RESUME_GUARD_MS: 1200,
    
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
        // M1 Garand: 実録音 66秒素材から10テイクを切り出し（相関の中央値0.20＝別テイク）。
        // 生成元は scripts/audio/wav_chop.py、台帳は asset/audio/sfx/m1_shot_manifest.json。
        // ここは {prefix, count} で持つ — ファイル名を10個並べると manifest と二重管理に
        // なってドリフトする（tests/sfx_variants.test.js が実ファイルとの一致を検証）。
        'm1_garand': { prefix: 'm1_shot', count: 10 },
        // MG42 は射撃任務に合わせて、連射・短連射・単発を使い分ける。
        'mg42_auto': { prefix: 'mg42_auto', count: 1 },
        'mg42_burst': { prefix: 'mg42_burst', count: 4 },
        'mg42_single': { prefix: 'mg42_single', count: 10 },
        // Kar98K / M1903系ボルトアクション用。
        'kar98k': { prefix: 'kar98k_shot', count: 10 },
    },

    /**
     * 武器コード -> 音プロファイル。**明示的な対応表**にしてあるのは、武器コードを
     * そのまま群のキーにすると、名前が似ているだけの別物（M1A1 SMG=thompson,
     * M1903=k98_scope, M1918 BAR=bar, M1911=拳銃）へ誤って流用される余地が
     * 残るため。PL版のM1小銃を足す時もここへ1行足すだけでよい。
     */
    weaponSfx: {
        'm1': 'm1_garand',
        'k98_scope': 'kar98k',
    },

    /** 群のキー一覧を実ファイル名へ展開する */
    variantKeys(group) {
        const g = this.variantGroups[group];
        if (!g) return [];
        if (Array.isArray(g)) return g.slice();
        const out = [];
        for (let i = 1; i <= g.count; i++) {
            out.push(g.prefix + '_' + String(i).padStart(2, '0'));
        }
        return out;
    },
    /** id（武器コード or プロファイル名）から群名を解決する */
    groupFor(id) {
        if (this.variantGroups[id]) return id;
        const prof = this.weaponSfx[id];
        return (prof && this.variantGroups[prof]) ? prof : null;
    },
    /**
     * SimWeapon を実際に鳴らすIDへ解決する。
     *
     * sim_battle は rifle の大半が M1 なので実録音が常に聞こえるが、本編では PL 小銃を
     * 含む多様なコードが来る。個別音源がまだ無い rifle は、製品ビューの基準音である
     * M1 実録群へ寄せる。SMG/拳銃/BAR等を名前だけで誤判定せず、sim の class を使う。
     */
    soundIdForWeapon(weapon, fireMode) {
        const code = weapon && weapon.code;
        let master = null;
        if (code && typeof WPNS !== 'undefined') master = WPNS[code] || null;
        const family = master && master.statTemplate;

        if (weapon && (code === 'mg42' || family === 'mg42')) {
            // SimWeapon は burstSize、旧Action側の WPNS は burst を持つ。
            // 共通入口で両方を受けないと手動射撃だけSingle音へ落ちる。
            const burstSize = weapon.burstSize != null ? weapon.burstSize : (weapon.burst || 1);
            if (burstSize <= 1) return 'mg42_single';
            return fireMode === 'suppress' ? 'mg42_auto' : 'mg42_burst';
        }
        if (code && (this.groupFor(code) || this.assets[code])) return code;
        if (family === 'm1' || (weapon && weapon.class === 'rifle'
            && (!master || master.plCategory === 'rifle'))) return 'm1';
        return code || 'shot';
    },
    /** sim_battle / 本編の共通射撃音入口 */
    playWeapon(weapon, fireMode, visibilityEpoch) {
        return this.play(this.soundIdForWeapon(weapon, fireMode), 'shot', visibilityEpoch);
    },
    variantPathOf(key) { return 'asset/audio/sfx/' + key + '.wav'; },
    _bags: {},
    _lastVariant: {},

    /**
     * 群から1つ選ぶ。袋が空になるまで重複せず、袋を作り直す時も直前と同じテイクが
     * 先頭に来ないようにする（"ランダム"だと体感的に同じ音が続いて聞こえるため）。
     */
    pickVariant(idOrGroup) {
        const id = this.groupFor(idOrGroup);
        if (!id) return null;
        const list = this.variantKeys(id);
        if (!list.length) return null;
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
        'mg42_auto': 1800,
        'mg42_burst': 1100,
        'mg42_single': 180,
        'tank_reload': 1500  // 敵戦車の連続射撃で2回鳴るのを防止
    },
    lastPlayTime: {},

    _isHidden() {
        const documentHidden = typeof document !== 'undefined'
            && (document.hidden || document.visibilityState === 'hidden');
        return documentHidden || this._pageActive === false;
    },

    isPageActive() { return !this._isHidden(); },

    _canPlay(visibilityEpoch) {
        if (this._isHidden()) return false;
        if (Date.now() < (this._muteUntil || 0)) return false;
        return visibilityEpoch == null || visibilityEpoch === this._visibilityEpoch;
    },

    captureEpoch() { return this._visibilityEpoch; },

    _trackNode(node) {
        if (!node) return node;
        this._activeNodes.add(node);
        const forget = () => this._activeNodes.delete(node);
        if (node.addEventListener) node.addEventListener('ended', forget, { once: true });
        else node.onended = forget;
        return node;
    },

    _stopActiveNodes() {
        this._activeNodes.forEach((node) => {
            try { if (node.stop) node.stop(0); } catch (e) { }
            try { if (node.disconnect) node.disconnect(); } catch (e) { }
        });
        this._activeNodes.clear();
    },

    _stopPhaserSounds() {
        [window.phaserGame, window.simGame].filter(Boolean).forEach((game) => {
            try { if (game.sound && game.sound.stopAll) game.sound.stopAll(); } catch (e) { }
            const scenes = game.scene && game.scene.getScenes ? game.scene.getScenes(false) : [];
            scenes.forEach((scene) => {
                try { if (scene && scene.sound) scene.sound.stopAll(); } catch (e) { }
            });
        });
    },

    _clearScheduled() {
        this._scheduledTimers.forEach((timer) => clearTimeout(timer));
        this._scheduledTimers.clear();
    },

    schedule(fn, delay) {
        const epoch = this.captureEpoch();
        const timer = setTimeout(() => {
            this._scheduledTimers.delete(timer);
            if (this._canPlay(epoch)) fn();
        }, delay);
        this._scheduledTimers.add(timer);
        return timer;
    },

    _applyActivityChange(active) {
        const now = Date.now();
        this._visibilityEpoch++;
        this._clearScheduled();
        this._stopActiveNodes();
        this._stopPhaserSounds();
        Object.keys(this.lastPlayTime || {}).forEach(k => { this.lastPlayTime[k] = now; });
        // 復帰直後は、hidden中に期限を迎えたタイマーが一斉に走る。
        this._muteUntil = active ? now + this.RESUME_GUARD_MS : Infinity;
        if (this.ctx && this.ctx.state === 'running' && this.ctx.suspend) {
            try { this.ctx.suspend(); } catch (e) { }
        }
    },

    _setPageActive(active) {
        active = !!active;
        if (this._pageActive === active) return;
        this._pageActive = active;
        this._applyActivityChange(active);
    },

    _handleVisibilityChange() {
        const documentVisible = typeof document === 'undefined'
            || (!document.hidden && document.visibilityState !== 'hidden');
        this._setPageActive(documentVisible && this._windowFocused !== false);
    },

    bindLifecycle() {
        if (this._visibilityBound) return;
        this._visibilityBound = () => this._handleVisibilityChange();
        this._blurBound = () => {
            this._windowFocused = false;
            this._setPageActive(false);
        };
        this._focusBound = () => {
            this._windowFocused = true;
            this._handleVisibilityChange();
        };
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', this._visibilityBound);
        }
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('blur', this._blurBound);
            window.addEventListener('focus', this._focusBound);
            window.addEventListener('pagehide', this._blurBound);
            window.addEventListener('pageshow', this._focusBound);
        }
    },

    init() {
        this.bindLifecycle();
        if (!this._canPlay()) return false;
        if(!this.ctx) this.ctx = new (window.AudioContext||window.webkitAudioContext)();
        if(this.ctx.state==='suspended' && this.ctx.resume) this.ctx.resume();
        return true;
    },

    preload(scene) {
        // AudioContextを作らず、画面ライフサイクルだけ先に監視する。
        this.bindLifecycle();
        for (const [key, path] of Object.entries(this.assets)) {
            scene.load.audio(key, path);
        }
        for (const group of Object.keys(this.variantGroups)) {
            for (const key of this.variantKeys(group)) scene.load.audio(key, this.variantPathOf(key));
        }
    },

    noise(dur, freq, type='lowpass', vol=0.2) {
        if(!this.ctx || !this._canPlay()) return;
        const t=this.ctx.currentTime;
        const b=this.ctx.createBuffer(1,this.ctx.sampleRate*dur,this.ctx.sampleRate);
        const d=b.getChannelData(0);
        for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(d.length*0.3));
        const s=this._trackNode(this.ctx.createBufferSource()); s.buffer=b;
        const f=this.ctx.createBiquadFilter(); f.type=type; f.frequency.value=freq;
        const g=this.ctx.createGain(); 
        g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.01,t+dur);
        s.connect(f); f.connect(g); g.connect(this.ctx.destination);
        s.start(t);
    },
    tone(freq, type, dur, vol=0.1) {
        if(!this.ctx || !this._canPlay()) return;
        const t=this.ctx.currentTime;
        const o=this._trackNode(this.ctx.createOscillator()); o.type=type; o.frequency.value=freq;
        const g=this.ctx.createGain();
        g.gain.setValueAtTime(vol, t); g.gain.linearRampToValueAtTime(0, t+dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t+dur);
    },
    metalImpact() {
        if(!this.ctx || !this._canPlay()) return;
        const t = this.ctx.currentTime;
        const o1 = this._trackNode(this.ctx.createOscillator()); o1.type = 'square'; o1.frequency.setValueAtTime(800, t); o1.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        const g1 = this.ctx.createGain(); g1.gain.setValueAtTime(0.1, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        const o2 = this._trackNode(this.ctx.createOscillator()); o2.type = 'sine'; o2.frequency.setValueAtTime(2000, t); o2.frequency.linearRampToValueAtTime(1500, t + 0.3);
        const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.05, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o1.connect(g1); g1.connect(this.ctx.destination); o2.connect(g2); g2.connect(this.ctx.destination);
        o1.start(t); o1.stop(t + 0.15); o2.start(t); o2.stop(t + 0.3);
    },

    /** ソフトターゲット命中: 短いキレのよい肉弾着音 */
    softHit() {
        if (!this.ctx || !this._canPlay()) return;
        const t = this.ctx.currentTime;
        const dur = 0.06;
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.15));
        const s = this._trackNode(this.ctx.createBufferSource()); s.buffer = b;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.ctx.destination);
        s.start(t);
    },

    /** ハードターゲット命中（リコシェ）: 短い金属的な跳弾音 */
    hardHit() {
        if (!this.ctx || !this._canPlay()) return;
        const t = this.ctx.currentTime;
        const o = this._trackNode(this.ctx.createOscillator()); o.type = 'sine';
        o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.08);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t + 0.08);
    },

    play(id, fallbackType = null, visibilityEpoch = null) {
        if (id === 'tank_reload') return;
        // hidden中、復帰直後、または古いActionの世代なら再生予約そのものを作らない。
        if (!this._canPlay(visibilityEpoch)) return;
        if (!this.init()) return;

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
        if (this.groupFor(id)) {
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
            this.schedule(()=>this.tone(440,'square',0.1),0);
            this.schedule(()=>this.tone(554,'square',0.1),150);
            this.schedule(()=>this.tone(659,'square',0.4),300);
        }
    }
};
window.Sfx = Sfx;
