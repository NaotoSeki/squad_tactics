/** PHASER UNIT: Soldier & Tank Renderer (HP Bar Position Fix) */

class Unit extends Phaser.GameObjects.Container {
    constructor(scene, data) {
        super(scene, 0, 0);
        scene.add.existing(this);
        this.dataRaw = data;
        this.setDepth(100);

        this.shadow = scene.add.ellipse(0, 5, 40, 20, 0x000000, 0.4);
        this.add(this.shadow);

        this.sprite = scene.add.container(0, 0);
        this.add(this.sprite);

        if (data.def.isTank) {
            this.drawTank(scene, data.team);
        } else {
            this.drawSoldier(scene, data.team, data.def.role);
        }

        // HP Bar
        this.hpBar = scene.add.graphics();
        this.add(this.hpBar);
        
        // Selection indicator
        this.selectionCircle = scene.add.graphics();
        this.selectionCircle.lineStyle(2, 0xffff00, 0.8);
        this.selectionCircle.strokeCircle(0, 0, 30);
        this.selectionCircle.visible = false;
        this.add(this.selectionCircle);

        // Interaction
        this.sprite.setInteractive(new Phaser.Geom.Rectangle(-30, -60, 60, 70), Phaser.Geom.Rectangle.Contains);
        this.sprite.on('pointerdown', () => {
            if (window.gameLogic && data.hp > 0) window.gameLogic.onUnitClick(this.dataRaw);
        });
        // Right click handling
        this.sprite.on('pointerup', (pointer) => {
             if (pointer.rightButtonDown() && window.gameLogic) {
                 window.gameLogic.showContext(pointer.event.clientX, pointer.event.clientY);
             }
        });

        this.update(data);
    }

    drawSoldier(scene, team, role) {
        const color = team === 'player' ? 0x5588ff : 0xff5555;
        const skinColor = 0xffccaa;

        // Body
        const body = scene.add.rectangle(0, -25, 16, 24, color);
        // Head
        const head = scene.add.circle(0, -45, 10, skinColor);
        // Helmet
        const helmet = scene.add.arc(0, -47, 11, 180, 360, false, 0x334433);
        
        this.sprite.add([body, head, helmet]);

        // Role Specific Attachments
        if (role === 'scout') {
            // Binoculars
            this.sprite.add(scene.add.rectangle(5, -43, 6, 4, 0x111111));
        } else if (role === 'gunner') {
            // Machine Gun
            this.sprite.add(scene.add.rectangle(8, -25, 20, 6, 0x222222));
        } else if (role === 'sniper') {
             // Ghillie suit effect
             const ghillie = scene.add.graphics();
             ghillie.fillStyle(0x224411, 0.8);
             for(let i=0; i<5; i++) ghillie.fillCircle((Math.random()-0.5)*15, -30 + Math.random()*20, 5);
             this.sprite.add(ghillie);
             // Rifle
             this.sprite.add(scene.add.rectangle(5, -28, 25, 3, 0x111111));
        } else {
            // Rifleman weapon
            this.sprite.add(scene.add.rectangle(8, -25, 18, 4, 0x222222));
        }
    }

    drawTank(scene, team) {
        const color = team === 'player' ? 0x4466cc : 0xcc4444;
        const hull = scene.add.rectangle(0, -15, 50, 30, color);
        const turret = scene.add.rectangle(0, -30, 30, 20, color);
        const barrel = scene.add.rectangle(25, -30, 20, 6, 0x222222);
        const tracks = scene.add.rectangle(0, -5, 55, 40, 0x222222);
        this.sprite.add([tracks, hull, turret, barrel]);
        this.shadow.setScale(1.5);
    }

    update(data) {
        this.dataRaw = data;
        if (data.q !== -999) {
            const pos = Renderer.hexToPx(data.q, data.r);
            this.setPosition(pos.x, pos.y);
            this.visible = true;
        } else {
            this.visible = false;
        }

        if (data.hp <= 0) {
            this.sprite.setRotation(Math.PI / 2);
            this.sprite.setAlpha(0.5);
            this.hpBar.visible = false;
            this.shadow.visible = false;
        } else {
            this.sprite.setRotation(0);
            this.sprite.setAlpha(1.0);
            this.hpBar.visible = true;
            this.shadow.visible = true;
        }
        
        if(window.gameLogic && window.gameLogic.selectedUnit === data) {
             this.selectionCircle.visible = true;
        } else {
             this.selectionCircle.visible = false;
        }

        this.draw(data);
    }

    draw(data) {
        this.hpBar.clear();
        if (data.hp <= 0) return;

        const healthRatio = data.hp / data.maxHp;
        const x = 0;
        // ★修正: HPバーの位置を頭上へ (y - 60), 高さを細く (2)
        const y = -60; 
        const width = 24;
        const height = 2;

        // Background
        this.hpBar.fillStyle(0x000000, 0.6);
        this.hpBar.fillRect(x - width/2, y, width, height);

        // Fill
        if (healthRatio > 0.5) this.hpBar.fillStyle(0x44ff44, 1.0);
        else if (healthRatio > 0.25) this.hpBar.fillStyle(0xffff44, 1.0);
        else this.hpBar.fillStyle(0xff4444, 1.0);

        this.hpBar.fillRect(x - width/2, y, Math.max(0, width * healthRatio), height);
    }
}
