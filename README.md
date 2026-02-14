# SQUAD TACTICS - Heroic Update

A turn-based tactical strategy game set in WWII, built with HTML5, JavaScript (ES6+), and the Phaser 3 engine. The game features hex-grid combat, squad management, and combined arms warfare (Infantry, Tanks, and Artillery support).

## 🎮 Game Features

* **Tactical Combat**: Turn-based engagement on a hexagonal grid system.
* **Combined Arms**: Command Riflemen, Scouts, Machine Gunners, Snipers, and Tanks (Panzer IV/Tiger).
* **Action Point (AP) System**: Manage unit AP for movement, attacking, reloading, and stance changes.
* **Stance System**: Stand, Crouch, or Prone to balance mobility vs. accuracy and cover.
* **Inventory & Loadout**: Manage weapons, ammo, and equipment (Grenades, Mortars) via the side panel.
* **Support System**: Request aerial bombardment and other tactical supports using cards.
* **Campaign Mode**: Progress through sectors, recruiting new units and managing survivors.

## 🛠 Tech Stack & Architecture

* **Engine**: [Phaser 3](https://phaser.io/) (Rendering, Input, Physics for UI cards)
* **Language**: Vanilla JavaScript (ES6 Modules structure)
* **State Management**: Custom `BattleLogic` class decoupled from the view.

### File Structure

* **Entry Point**:
    * `index.html`: Main DOM structure, UI overlays, and script loading order.
* **Logic Core** (Pure JS):
    * `logic_game.js`: Main battle loop, turn processing, and combat calculations.
    * `logic_map.js`: Hex grid generation, A* pathfinding, and line-of-sight calculations.
    * `logic_ai.js`: Enemy behavior tree (Patrol, Engage, Chase).
    * `logic_campaign.js`: Meta-game management (Sector progression, Unit factory).
    * `logic_ui.js`: Bridge between game logic and HTML DOM UI (Sidebar).
    * `data.js`: Configuration for Units, Weapons, Terrain, and Skills.
* **Rendering** (Phaser):
    * `phaser_bridge.js`: Main bridge integrating Phaser scenes with Game Logic. Handles Input and Card UI.
    * `phaser_unit.js`: Unit sprites, animations, and health bar rendering.
    * `phaser_vfx.js`: Particle effects (Explosions, Smoke, Projectile trails) and Environment (Grass/Trees).
    * `phaser_sound.js`: Audio management.

## 🚀 How to Run

No build step is required. Since the project uses ES6 features and fetches local assets:

1.  **Clone the repository**.
2.  **Start a local server** (Required to avoid CORS issues with Phaser textures).
    * VS Code: Use "Live Server" extension.
    * Python: `python -m http.server`
    * Node: `npx http-server`
3.  Open `index.html` in your browser.

## 🕹 Controls

* **Left Click**: Select Unit / Move / Attack / Use Card.
* **Right Click**: Deselect / Open Context Menu (Unit Info).
* **Drag & Drop**: Use Support Cards from the hand to the battlefield.
* **UI Panel**: Click on the right sidebar to manage inventory (Reload, Swap weapons).

## 📝 Developer Notes

* **Renderer Global**: The `Renderer` object in `phaser_bridge.js` is exposed globally to allow `BattleLogic` to trigger visual events (Animations, Camera movement).
* **AI Pathfinding**: Uses A* algorithm located in `logic_map.js`.
* **Map Generation**: Currently procedural based on sector difficulty.

---
*Development status: v1.0 Heroic Update (Active)*
