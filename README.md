# SQUAD TACTICS - HEROIC EDITION

A high-fidelity turn-based tactical strategy game built with **Phaser 3.60**.
Experience squad-level combat with organic environmental simulation and deep weapon mechanics.

## 🌟 Key Features

### 🎨 High-End Environmental Simulation
* **Procedural Vegetation**: 
    * 60FPS smooth vector-morphed grass with wind propagation waves.
    * Two distinct grass variants (Tall & Wild) for organic terrain texturing.
* **Dynamic Forestry**:
    * Multi-layered fir trees with independent branch inertia simulation.
    * Trees react to wind gusts and sway naturally with "whipping" motion.
* **Atmosphere**:
    * Particle-based weather effects (Wind lines, debris).
    * Dynamic lighting/glow effects on unit selection.

### ⚔️ Deep Tactical Gameplay
* **Hex-Grid Combat**: Classic turn-based movement and combat on a procedurally generated map.
* **Advanced Ballistics & Ammo**:
    * **Infantry**: Magazine management system (Reload consumes AP).
    * **Tanks**: "Just-In-Time" shell loading system with Auto/Manual reload toggle.
    * Visual bullet gauges showing exact remaining rounds.
* **Unit Classes**:
    * **Infantry**: Rifleman, Scout, Gunner, Sniper (with specific loadouts).
    * **Armor**: Panzer IV, Tiger I (Heavy armor, limited AP, devastating firepower).
* **RPG Elements**: Unit promotions, skill acquisition (Hero, CQC, Mechanic), and sector progression.

### 💻 Technical Highlights
* **Tech Stack**: HTML5, JavaScript (ES6+), Phaser 3.60.
* **Responsive UI**: Collapsible sidebar with CSS transitions and DOM-based overlay menus.
* **Performance**: Optimized particle pooling and vector graphics rendering.

## 🎮 Controls

* **Left Click**: Select Unit / Move / Attack
* **Right Click**: Context Menu (Unit Info / End Turn)
* **Drag & Drop**: Deploy units from cards / Swap equipment in loadout
* **UI Toggles**:
    * **Sidebar**: Toggle unit dossier panel.
    * **Auto Reload**: Toggle automatic shell loading for tanks (1AP cost).

## 🚀 How to Run

1.  Clone the repository.
2.  Open `index.html` in a modern web browser.
    * *Note: Due to local file security policies in some browsers, it is recommended to run a local server (e.g., VS Code Live Server).*

## 📜 Recent Updates (Heroic Update)

* **Visual Overhaul**: Implemented "Fluffy" tree rendering algorithm and grounded shadows.
* **UI Update**: Moved HP bars to overhead position (slim design) and added glow selection effects.
* **Logic Fixes**: 
    * Implemented JIT (Just-In-Time) reloading logic to prevent soft-locks.
    * Instant victory condition check upon last enemy elimination.
    * Fixed sidebar coordinate desync issues.

---
*Developed by Naoto Seki & Gemini AI*
