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
        'tank_reload': 'asset/audio/003_tank_gun_reload.wav',
        // セクター決着のジングル。**この2つ専用のキー**にしてある — 汎用の 'win' に
        // 実音を載せると、将来 'win' を別の場面で鳴らした時に巻き添えになる。
        // 既存の合成音フォールバック（'win' の tone 3連）はそのまま残す。
        'sector_clear': 'asset/audio/jingle_win.wav',
        'sector_fail':  'asset/audio/jingle_defeat.wav',
        // Project-owned conversions of user-provided sources; Downloads originals stay untouched.
        'grenade_explosion_ps': 'asset/audio/sfx/grenade_explosion_ps.wav',
        'm2_mortar_fire_ps': 'asset/audio/sfx/m2_mortar_fire_ps.wav'
    },
    assetVolumes: {
        // -3 dB from the original 0.36 runtime mix; keep the M2 and generic
        // boom fallback levels unchanged so this only tames grenade impacts.
        'grenade_explosion_ps': 0.255,
        'm2_mortar_fire_ps': 0.30
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
        // Thompson (SMG)。MG42 と同じく射撃任務で連射・短連射・単発を使い分ける。
        'thompson_auto': { prefix: 'thompson_auto', count: 1 },
        'thompson_burst': { prefix: 'thompson_burst', count: 8 },
        'thompson_single': { prefix: 'thompson_single', count: 10 },
        // StG 44。StG44系そのものに加え、**個別音源をまだ持たない小火器の既定**でもある
        // （合成音より実録の方が良い、というディレクター判断。2026-08-03）。
        'stg44_auto': { prefix: 'stg44_auto', count: 1 },
        'stg44_burst': { prefix: 'stg44_burst', count: 8 },
        'stg44_single': { prefix: 'stg44_single', count: 10 },
    },

    /**
     * クリップ1本に入っている**実際の発射弾数**（2026-08-04 実測）。
     *
     * これが無かった頃は、音は fireMode（制圧かどうか）だけで auto/burst を選び、
     * 弾数は WPNS.burst 固定だったので、両者は構造的に一致し得なかった
     * ——「auto が30発鳴っているのに弾倉は2発しか減らない」。ここを台帳にして、
     * **鳴らすクリップを実発射数から引く**ことで嘘が出ない形にしてある。
     *
     * 実測は `python scripts/audio/count_rounds.py`（オンセット検出＋自己相関）。
     * 数字を動かす時はスクリプトを回してから動かすこと。シム側の対は
     * SIM_TUNING.ROUNDS_PER_PULL で、tests/sim_fire_modes.test.js が両者を突合する。
     */
    variantRounds: {
        mg42:     { single: 1, burst: 5, auto: 32 },
        thompson: { single: 1, burst: 3, auto: 30 },
        stg44:    { single: 1, burst: 3, auto: 19 },
    },
    /** 連射レート（発/秒）。実測 mg42 1304rpm / thompson 769rpm / stg44 448rpm。
     *  auto クリップを実発射数ぶんで切る尺として使う。 */
    variantRate: { mg42: 21.7, thompson: 12.8, stg44: 7.5 },
    /** これ以上の発射数なら auto クリップを使う（SIM_TUNING.AUTO_MIN_ROUNDS と対）。 */
    AUTO_SOUND_MIN_ROUNDS: 8,
    /** 単発テイクしか持たない群（M1/Kar98K）で速射を表す時の間隔(ms)・ゆらぎ・上限。 */
    SEMI_REPEAT_MS: 220,
    SEMI_REPEAT_JITTER_MS: 40,
    SEMI_REPEAT_MAX: 4,

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

    /**
     * 実録を持つ銃の**同一実銃**コード。PL版は statTemplate を持たないので、
     * これが無いと `pl_94`(MG42) が「音の無い銃」扱いになって StG44 で鳴る。
     * 名前が似ているだけの別物を拾わないよう、表で明示する。
     */
    sameGunCodes: {
        mg42: { mg42: 1, pl_94: 1, pl_402: 1 },
        thompson: { thompson: 1, pl_16: 1, pl_17: 1 },
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
    /** 'mg42_auto' -> 'mg42'。接尾辞を持たないIDはそのまま返す。 */
    familyOf(id) {
        return String(id || '').replace(/_(single|burst|auto)$/, '');
    },
    /**
     * SimWeapon を実際に鳴らすIDへ解決する。
     *
     * sim_battle は rifle の大半が M1 なので実録音が常に聞こえるが、本編では PL 小銃を
     * 含む多様なコードが来る。個別音源がまだ無い rifle は、製品ビューの基準音である
     * M1 実録群へ寄せる。SMG/拳銃/BAR等を名前だけで誤判定せず、sim の class を使う。
     */
    soundIdForWeapon(weapon, fireMode, rounds) {
        const code = weapon && weapon.code;
        let master = null;
        if (code && typeof WPNS !== 'undefined') master = WPNS[code] || null;
        const family = master && master.statTemplate;

        if (!weapon) return 'shot';

        // 実録の銃声を当てるのは**実弾を撃つ小火器だけ**。砲・ロケット・擲弾は弾種が
        // 違うので嘘になるし、装備部品(type:'part')はそもそも発砲しない。
        // クラス判定より先に置くこと — 後ろに置くと、sim の class が smg に解決される
        // 部品が Thompson の音で鳴る（2026-08-03 実測で踏んだ）。
        const isSmallArm = (!master || master.type === 'bullet') && weapon.class !== 'at';

        if (isSmallArm) {
            const same = this.sameGunCodes;
            if ((code && same.mg42[code]) || family === 'mg42') {
                return this._burstVariant('mg42', weapon, fireMode, rounds);
            }
            if ((code && same.thompson[code]) || family === 'thompson' || weapon.class === 'smg') {
                return this._burstVariant('thompson', weapon, fireMode, rounds);
            }
        }
        if (code && (this.groupFor(code) || this.assets[code])) return code;
        if (isSmallArm) {
            if (family === 'm1' || (weapon.class === 'rifle'
                && (!master || master.plCategory === 'rifle'))) return 'm1';
            // 個別音源をまだ割り当てていない小火器は、一旦すべて StG 44 の実録で鳴らす
            // （2026-08-03 ディレクター指示。合成音より実録の方が良い）。
            return this._burstVariant('stg44', weapon, fireMode, rounds);
        }
        return code || 'shot';
    },

    /**
     * **実発射数**から auto / burst / single を選ぶ。
     *
     * 旧版は fireMode==='suppress' かどうかで選んでいたので、制圧射撃の兵は
     * 2発撃つたびに30発ぶんの auto クリップを鳴らしていた。判断材料を実発射数に
     * 一本化すれば、音と弾数は構造的に食い違えない。
     *
     * @param {string} prefix - 群の接頭辞（'mg42' 等）
     * @param {Object} weapon - SimWeapon（burstSize）or 旧Action の WPNS（burst）
     * @param {string} [fireMode] - **未使用**。呼び出し側の互換のために残している
     * @param {number} [rounds] - このトリガーで実際に出た弾数。無ければ武器の既定値
     */
    _burstVariant(prefix, weapon, fireMode, rounds) {
        const n = (Number.isFinite(rounds) && rounds > 0)
            ? rounds
            : (weapon.burstSize != null ? weapon.burstSize : (weapon.burst || 1));
        if (n >= this.AUTO_SOUND_MIN_ROUNDS) return prefix + '_auto';
        if (n >= 2) return prefix + '_burst';
        return prefix + '_single';
    },

    /**
     * その武器の**1発あたりの間隔(ms)**。鳴らすクリップの実測レートから引く。
     *
     * 銃口炎と着弾煙はこれを使って弾を並べる（phaser_vfx._roundSpacing）。
     * 「音の刻み」と「絵の刻み」を別々の定数で持つと必ずずれる — 実際、旧実装は
     * クラス固定値(MG34ms/SMG46ms/他72ms)で並べていて、SMGの30発掃射は閃光が
     * 1.38秒で終わるのに音は2.34秒鳴り続けていた（2026-08-04 ディレクター指摘）。
     * 連射テイクを持たない群（M1/Kar98K）は半自動の速射間隔を返す。
     *
     * @returns {number} 1発あたりのms
     */
    roundIntervalMs(weapon, rounds) {
        const family = this.familyOf(this.soundIdForWeapon(weapon, null, rounds));
        const rate = this.variantRate[family];
        if (rate) return 1000 / rate;
        return this.SEMI_REPEAT_MS;
    },

    /**
     * sim_battle / 本編の共通射撃音入口。
     * @param {number} [rounds] - このトリガーの実発射数。SHOT イベントの roundsFired を渡す。
     */
    playWeapon(weapon, fireMode, visibilityEpoch, rounds) {
        const id = this.soundIdForWeapon(weapon, fireMode, rounds);
        const family = this.familyOf(id);
        const hasVolumeTakes = !!this.variantRounds[family];

        // 単発テイクしか持たない群（M1 Garand / Kar98K）で2発以上撃った時。
        // 半自動小銃の速射は「1発の音」ではなく「単発が続けて鳴る」形にする
        // ——ここが無いと M1 は2発消費して1発ぶんしか鳴らない。
        if (Number.isFinite(rounds) && rounds >= 2 && !hasVolumeTakes && this.groupFor(id)) {
            const played = this.play(id, 'shot', visibilityEpoch);
            if (!played) return played;
            const count = Math.min(rounds, this.SEMI_REPEAT_MAX);
            let delay = 0;
            for (let i = 1; i < count; i++) {
                delay += this.SEMI_REPEAT_MS
                    + (Math.random() * 2 - 1) * this.SEMI_REPEAT_JITTER_MS;
                // 2発目以降は _playNow（スロットルを見ない内部入口）。同じ id を連続で
                // 鳴らすので、スロットルを通すと速射が1発に潰れる。
                this.schedule(() => this._playNow(id, 'shot', visibilityEpoch), delay);
            }
            return played;
        }

        // 弾倉の残りが尽きて auto を撃ち切れなかった時は、クリップも撃った分だけで切る。
        if (hasVolumeTakes && id.endsWith('_auto') && Number.isFinite(rounds)
            && rounds > 0 && rounds < this.variantRounds[family].auto) {
            const cut = this._playAutoCut(id, family, rounds, visibilityEpoch);
            if (cut) return cut;
            // 切って鳴らせなかった（シーン未準備等）。スロットルはまだ刻んでいないので
            // 通常再生へ落ちて構わない。
        }

        return this.play(id, 'shot', visibilityEpoch);
    },

    /**
     * auto クリップを実発射数ぶんの尺で鳴らして、末尾をフェードで畳む。
     * 鳴らせた場合だけ true を返す（呼び出し側はフォールバックの判断に使う）。
     * @private
     */
    _playAutoCut(id, family, rounds, visibilityEpoch) {
        const rate = this.variantRate[family];
        if (!rate) return false;
        if (!this._canPlay(visibilityEpoch)) return false;
        if (!this.init()) return false;

        // スロットルは**実際に鳴らす直前**に見る。先に刻むと、鳴らせなかった時の
        // 通常再生フォールバックが自分の刻んだ時刻で弾かれて無音になる。
        const throttle = this.throttles[id];
        if (throttle) {
            const now = Date.now();
            if (now - (this.lastPlayTime[id] || 0) < throttle) return true;  // 抑止も「処理済み」
        }

        const scene = this._soundScene();
        if (!scene || !scene.sound || !scene.sound.add) return false;
        const key = this.pickVariant(id);
        if (!key) return false;
        if (scene.cache && scene.cache.audio && !scene.cache.audio.exists(key)) return false;

        if (throttle) this.lastPlayTime[id] = Date.now();

        const snd = scene.sound.add(key);
        snd.play({ volume: 0.45 });

        const durMs = (rounds / rate) * 1000 + 250;   // 末尾250msは残響ぶん
        const full = (typeof snd.totalDuration === 'number') ? snd.totalDuration * 1000 : Infinity;
        const FADE_MS = 90;
        const stop = () => {
            try { snd.stop(); } catch (e) { }
            try { snd.destroy(); } catch (e) { }
        };
        if (durMs >= full) {
            // 切るまでもない。ただし add() したインスタンスは自分で片付けること —
            // 放っておくと鳴り終わった Sound が Phaser の音管理に溜まり続ける。
            if (snd.once) snd.once('complete', stop);
            else this.schedule(stop, full);
            return true;
        }

        this.schedule(() => {
            if (scene.tweens && scene.tweens.add) {
                scene.tweens.add({ targets: snd, volume: 0, duration: FADE_MS, onComplete: stop });
            } else {
                stop();
            }
        }, Math.max(0, durMs - FADE_MS));
        return true;
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
        // auto クリップは実測2.5秒。途中で別のautoに踏まれると掃射が細切れに聞こえる。
        'mg42_auto': 2600,
        'mg42_burst': 900,   // 5発0.4秒。旧1100は短連射に対して長すぎた
        'mg42_single': 180,
        'thompson_auto': 2600,
        'thompson_burst': 900,
        'thompson_single': 150,
        'stg44_auto': 2600,
        'stg44_burst': 900,
        'stg44_single': 150,
        'grenade_explosion_ps': 280,
        'm2_mortar_fire_ps': 450,
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
    /**
     * Final decisive shot only: a single, very quiet outdoor reflection.
     *
     * This deliberately is not a global reverb. The normal weapon take stays
     * dry (and keeps its recorded distance); only the sector-ending round gets
     * one 105 ms, low-passed return. It allocates three tiny Web Audio nodes
     * once per battle, never per ordinary shot.
     */
    finalShotAccent() {
        if (!this._canPlay() || !this.init()) return false;
        const ctx = this.ctx;
        if (!ctx || !ctx.createBuffer || !ctx.createBufferSource
            || !ctx.createBiquadFilter || !ctx.createDelay || !ctx.createGain) return false;
        try {
            const now = ctx.currentTime;
            const dur = 0.13;
            const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.18));
            }
            const source = this._trackNode(ctx.createBufferSource());
            const presence = ctx.createBiquadFilter();
            const delay = ctx.createDelay(0.25);
            const distance = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            source.buffer = buffer;
            presence.type = 'bandpass';
            presence.frequency.setValueAtTime(1750, now);
            presence.Q.setValueAtTime(0.7, now);
            delay.delayTime.setValueAtTime(0.105, now);
            distance.type = 'lowpass';
            distance.frequency.setValueAtTime(2400, now);
            gain.gain.setValueAtTime(0.075, now + 0.105);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
            source.connect(presence); presence.connect(delay); delay.connect(distance);
            distance.connect(gain); gain.connect(ctx.destination);
            source.start(now);
            return true;
        } catch (e) {
            // The accent is cosmetic. A Web Audio failure must never silence
            // the real shot or interfere with the result transition.
            return false;
        }
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

    /**
     * 通常の再生入口。スロットル判定を通してから _playNow へ渡す。
     *
     * **判定の順序を変えないこと。** hidden/世代切れの棄却をスロットルより先に
     * 置くのは、鳴らさなかった再生でスロットル時刻を刻まないため（刻むと復帰直後の
     * 1発が自分の刻んだ時刻で弾かれる）。
     */
    play(id, fallbackType = null, visibilityEpoch = null) {
        if (id === 'tank_reload') return;
        if (!this._canPlay(visibilityEpoch)) return;

        if (this.throttles[id]) {
            const now = Date.now();
            const last = this.lastPlayTime[id] || 0;
            if (now - last < this.throttles[id]) {
                return;
            }
            this.lastPlayTime[id] = now;
        }
        return this._playNow(id, fallbackType, visibilityEpoch);
    },

    /** スロットルを見ない内部入口。連続再生（半自動の速射）の2発目以降が通る。 @private */
    _playNow(id, fallbackType = null, visibilityEpoch = null) {
        if (id === 'tank_reload') return;
        // hidden中、復帰直後、または古いActionの世代なら再生予約そのものを作らない。
        if (!this._canPlay(visibilityEpoch)) return;
        if (!this.init()) return;

        if (window.gameLogic && window.gameLogic.isProcessingTurn) {
            const quiet = ['move', 'swap', 'click'];
            const ft = fallbackType || id;
            if (quiet.includes(id) || quiet.includes(ft)) return;
        }

        // 1a. ラウンドロビン群が登録されていれば、そこから1テイク引いて再生
        if (this.groupFor(id)) {
            const scene = this._soundScene();
            const key = scene && this.pickVariant(id);
            if (key && scene.sound && (!scene.cache || !scene.cache.audio || scene.cache.audio.exists(key))) {
                scene.sound.play(key, { volume: 0.45 });
                return true;
            }
        }

        // 1b. assetsに登録されたIDなら、WAVファイルを再生
        if (this.assets[id]) {
            const scene = this._soundScene();
            if (scene && scene.sound) {
                // ジングルは一度きりの節目なので銃声より前に出す
                const cached = !scene.cache || !scene.cache.audio || scene.cache.audio.exists(id);
                if (cached) try {
                    const vol = this.assetVolumes[id] != null ? this.assetVolumes[id]
                        : (id === 'tank_reload') ? 0.28
                        : (id === 'sector_clear' || id === 'sector_fail') ? 0.6 : 0.4;
                    scene.sound.play(id, { volume: vol });
                    return true;
                } catch (e) { /* Preserve the requested synth fallback below. */ }
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
        return true;
    }
};
window.Sfx = Sfx;
