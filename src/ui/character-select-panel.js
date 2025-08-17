// Professional Character Selection Panel JavaScript
class CharacterSelectManager {
    constructor() {
        this.selectedCharacter = null;
        this.characters = []; // Will be populated from game data
        this.currentTab = 'preview';
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Action buttons
        document.getElementById('backButton')?.addEventListener('click', () => {
            this.onBack();
        });

        document.getElementById('selectButton')?.addEventListener('click', () => {
            this.onSelectCharacter();
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.style.display = 'none';
        });
        
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.style.display = 'block';
            this.currentTab = tabName;
            
            // Refresh content for the selected tab
            if (this.selectedCharacter) {
                this.refreshTabContent(tabName);
            }
        }
    }

    refreshTabContent(tabName) {
        if (!this.selectedCharacter) return;

        switch (tabName) {
            case 'stats':
                this.renderStats();
                break;
            case 'weapons':
                this.renderWeapons();
                break;
            case 'lore':
                this.renderLore();
                break;
            case 'preview':
                this.renderPreview();
                break;
        }
    }

    renderCharacterGrid(characters) {
        this.characters = characters;
        const grid = document.getElementById('characterGrid');
        if (!grid) return;

        grid.innerHTML = '';
        
        characters.forEach((character, index) => {
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.characterId = character.id;
            
            card.innerHTML = `
                <div class="character-portrait">
                    <img src="${character.icon}" alt="${character.name}" onerror="this.style.display='none'">
                </div>
                <div class="character-name">${character.name}</div>
                <div class="character-class">${character.playstyle || 'Balanced'}</div>
            `;

            card.addEventListener('click', () => {
                this.selectCharacter(character, card);
            });

            grid.appendChild(card);
        });
    }

    selectCharacter(character, cardElement) {
        // Update selection UI
        document.querySelectorAll('.character-card').forEach(card => {
            card.classList.remove('selected');
        });
        cardElement.classList.add('selected');

        this.selectedCharacter = character;
        this.updateCharacterInfo();
    }

    updateCharacterInfo() {
        const character = this.selectedCharacter;
        if (!character) return;

        // Update header
        document.getElementById('selectedCharacterName').textContent = character.name;
        document.getElementById('selectedCharacterSubtitle').textContent = character.description;
        
        // Update playstyle badge
        const badge = document.getElementById('playstyleBadge');
        if (badge && character.playstyle) {
            badge.textContent = character.playstyle;
            badge.className = `playstyle-badge playstyle-${character.playstyle.toLowerCase()}`;
            badge.style.display = 'inline-block';
        }

        // Update special ability
        const abilitySection = document.getElementById('specialAbility');
        const abilityTitle = document.getElementById('abilityTitle');
        const abilityDescription = document.getElementById('abilityDescription');
        
        if (character.specialAbility && abilitySection && abilityTitle && abilityDescription) {
            abilityTitle.textContent = character.specialAbility.split(' - ')[0];
            abilityDescription.textContent = character.specialAbility.split(' - ')[1] || character.specialAbility;
            abilitySection.style.display = 'block';
        }

        // Update portrait
        const portrait = document.getElementById('previewPortrait');
        if (portrait && character.icon) {
            portrait.src = character.icon;
            portrait.style.display = 'block';
        }

        // Refresh current tab content
        this.refreshTabContent(this.currentTab);
    }

    renderStats() {
        const statsGrid = document.getElementById('statsGrid');
        if (!statsGrid || !this.selectedCharacter) return;

        const stats = this.selectedCharacter.stats;
        const maxValues = {
            hp: 200,
            speed: 12,
            damage: 40,
            strength: 10,
            intelligence: 10,
            agility: 10,
            luck: 10,
            defense: 10
        };

        statsGrid.innerHTML = '';

        Object.entries(stats).forEach(([key, value]) => {
            if (typeof value !== 'number') return;
            
            const statItem = document.createElement('div');
            statItem.className = 'stat-item';
            
            const percentage = Math.min((value / (maxValues[key] || 10)) * 100, 100);
            
            statItem.innerHTML = `
                <div class="stat-label">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
                <div class="stat-value">${value}</div>
                <div class="stat-bar">
                    <div class="stat-fill" style="width: ${percentage}%"></div>
                </div>
            `;
            
            statsGrid.appendChild(statItem);
        });
    }

    renderWeapons() {
        const weaponsGrid = document.getElementById('weaponsGrid');
        if (!weaponsGrid || !this.selectedCharacter) return;

        const weapons = this.selectedCharacter.weaponTypes || [];
        const weaponNames = {
            0: 'Pistol',
            1: 'Shotgun',
            2: 'Tri-Shot',
            10: 'Runner Gun',
            11: 'Warrior Cannon',
            12: 'Sorcerer Orb',
            13: 'Shadow Dagger',
            14: 'Bio Toxin',
            15: 'Hacker Virus',
            16: 'Gunner Minigun',
            17: 'Psionic Wave',
            18: 'Scavenger Sling',
            19: 'Nomad Neural',
            20: 'Ghost Sniper',
            21: 'Mech Mortar'
        };

        weaponsGrid.innerHTML = '';

        weapons.forEach(weaponType => {
            const weaponItem = document.createElement('div');
            weaponItem.className = 'weapon-item';
            
            const weaponName = weaponNames[weaponType] || `Weapon ${weaponType}`;
            
            weaponItem.innerHTML = `
                <div class="weapon-name">${weaponName}</div>
                <div class="weapon-description">Available weapon type for this character</div>
            `;
            
            weaponsGrid.appendChild(weaponItem);
        });

        if (weapons.length === 0) {
            weaponsGrid.innerHTML = '<div class="weapon-item"><div class="weapon-name">No specific weapons</div><div class="weapon-description">This character can use any available weapon</div></div>';
        }
    }

    renderLore() {
        const loreText = document.getElementById('loreText');
        if (!loreText || !this.selectedCharacter) return;

        loreText.textContent = this.selectedCharacter.lore || 'No backstory available for this character.';
    }

    renderPreview() {
        const previewDescription = document.getElementById('previewDescription');
        if (!previewDescription || !this.selectedCharacter) return;

        previewDescription.textContent = this.selectedCharacter.description || 'No description available.';
    }

    onBack() {
        // This would be handled by the game's navigation system
        console.log('Back button clicked');
        if (window.gameInstance && window.gameInstance.showMainMenu) {
            window.gameInstance.showMainMenu();
        }
    }

    onSelectCharacter() {
        if (!this.selectedCharacter) {
            alert('Please select a character first!');
            return;
        }
        
        console.log('Character selected:', this.selectedCharacter);
        
        // This would be handled by the game's character selection system
        if (window.gameInstance && window.gameInstance.selectCharacter) {
            window.gameInstance.selectCharacter(this.selectedCharacter);
        }
    }
}

// Initialize the character select manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.characterSelectManager = new CharacterSelectManager();
});

// Export for use by the game
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CharacterSelectManager;
}