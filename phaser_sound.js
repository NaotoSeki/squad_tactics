/** * PHASER SOUND ENGINE (Rich Metal Ricochet) */
const Sfx = {
    ctx: null,
    init() { 
        if(!this.ctx) this.ctx = new (window.AudioContext||window.webkitAudioContext)(); 
        if(this.ctx.state==='suspended') this.ctx.resume(); 
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
    // ★改良版: 複合金属音
    metalImpact() {
        if(!this.ctx) return;
        const t = this.ctx.currentTime;
        
        // 音1: 衝撃音（矩形波で鋭く）
        const o1 = this.ctx.createOscillator();
        o1.type = 'square';
        o1.frequency.setValueAtTime(800, t);
        o1.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        const g1 = this.ctx.createGain();
        g1.gain.setValueAtTime(0.1, t);
        g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        
        // 音2: 金属共鳴（サイン波でキィーンと響かせる）
        const o2 = this.ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(2000, t); // 高周波
        o2.frequency.linearRampToValueAtTime(1500, t + 0.3);
        const g2 = this.ctx.createGain();
        g2.gain.setValueAtTime(0.05, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3); // 少し長く残す

        o1.connect(g1); g1.connect(this.ctx.destination);
        o2.connect(g2); g2.connect(this.ctx.destination);
        
        o1.start(t); o1.stop(t + 0.15);
        o2.start(t); o2.stop(t + 0.3);
    },
    play(id) {
        this.init();
        if(id==='click') this.tone(1200, 'sine', 0.05, 0.05);
        else if(id==='move') this.noise(0.1, 300, 'lowpass', 0.1);
        else if(id==='swap') this.tone(600, 'square', 0.1, 0.05);
        else if(id==='shot') { this.noise(0.1, 2000, 'highpass', 0.2); this.noise(0.3, 500, 'lowpass', 0.3); }
        else if(id==='mg') this.noise(0.08, 1200, 'bandpass', 0.15);
        else if(id==='cannon') { this.noise(0.6, 100, 'lowpass', 0.6); this.noise(0.3, 400, 'lowpass', 0.4); }
        else if(id==='boom') { this.noise(1.2, 60, 'lowpass', 0.8); this.noise(0.5, 200, 'lowpass', 0.5); }
        else if(id==='rocket') { this.noise(1.5, 120, 'lowpass', 0.6); }
        else if(id==='ricochet') { this.metalImpact(); }
        else if(id==='death') { this.noise(0.5, 150, 'lowpass', 0.5); }
        else if(id==='win') { 
            setTimeout(()=>this.tone(440,'square',0.1),0);
            setTimeout(()=>this.tone(554,'square',0.1),150);
            setTimeout(()=>this.tone(659,'square',0.4),300);
        }
    }
};
window.Sfx = Sfx;
