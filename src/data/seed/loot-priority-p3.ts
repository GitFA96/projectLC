/**
 * The guild's Phase 3 loot priority sheet, verbatim.
 *
 * Kept as the original markdown rather than pre-parsed rows so the file stays
 * something an officer can read, diff and replace by pasting a newer sheet —
 * the parser (lib/loot/priority-sheet) turns it into rules at load. Officer
 * edits made in the app are stored separately and layered on top; this is the
 * foundation, never the last word.
 */
export const LOOT_PRIORITY_SHEET_PHASE = 3;

export const LOOT_PRIORITY_SHEET_MD = String.raw`
# Oilers Phase 3 Loot Priority (TBC Classic — Mount Hyjal & Black Temple)

**Notation:** \`A > B\` = A has strictly higher priority than B. \`A = B\` = equal priority. \`MS > OS\` = main spec before off spec.

### Hyjal Trash

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Nethervoid Cloak | Warlock > Shadow > MS > OS | Back | Shadow-damage-only item. |
| Pepe's Shroud of Pacification | Feral Tank = Prot Warrior > MS > OS | Back |  |
| Choker of Serrated Blades | Hunter > MS > OS | Neck | Usually not BiS for most physical DPS. |
| Hellfire-Encased Pendant | MS > OS | Neck |  |
| Boots of the Divine Light | Holy Priest > Resto Druid > Resto Shaman | Cloth - Feet |  |
| Chestguard of Relentless Storms | MS > OS | Mail - Chest |  |
| Claw of Molten Fury | MS > OS | Main Hand Fist | Prefer completing the fist set when sensible. |
| Fist of Molten Fury | MS > OS | Off Hand Fist | Prefer completing the fist set when sensible. |
| Hammer of Judgment | Prot Paladin > MS > OS | Main Hand Mace |  |

### Rage Winterchill

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Bracers of Martyrdom | MS > OS | Cloth - Wrist |  |
| Cuffs of Devastation | Mage > MS > OS | Cloth - Wrist |  |
| Rejuvenating Bracers | MS > OS | Leather - Wrist |  |
| Deadly Cuffs | MS > OS | Leather - Wrist |  |
| Bracers of the Pathfinder | MS > OS | Mail - Wrist |  |
| Howling Wind Bracers | MS > OS | Mail - Wrist |  |
| Stillwater Boots | MS > OS | Mail - Feet |  |
| Blood-Stained Pauldrons | MS > OS | Plate - Shoulder |  |
| Blessed Adamantite Bracers | MS > OS | Plate - Wrist |  |
| Furious Shackles | MS > OS | Plate - Wrist |  |
| Chronicle of Dark Secrets | Warlock > Mage > MS > OS | Off-hand |  |
| Tracker's Blade | MS > OS | One-Hand Dagger |  |
| Time-Phased Phylactery | Quest Item | Quest | Quest item; distribute according to quest need. |

### Anetheron

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Anetheron's Noose | MS > OS | Cloth - Waist |  |
| Archbishop's Slippers | MS > OS | Cloth - Feet |  |
| Hatefury Mantle | MS > OS | Cloth - Shoulder |  |
| Enchanted Leather Sandals | MS > OS | Leather - Feet |  |
| Don Alejandro's Money Belt | Hunter > MS > OS | Leather - Waist |  |
| Quickstrider Moccasins | Hunter > MS > OS | Mail - Feet |  |
| Golden Links of Restoration | MS > OS | Mail - Chest |  |
| Glimmering Steel Mantle | MS > OS | Plate - Shoulder |  |
| Pillar of Ferocity | MS > OS | Two-Hand Staff |  |
| The Unbreakable Will | MS > OS | One-Hand Sword |  |
| Blade of Infamy | Rogue > MS > OS | One-Hand Sword |  |
| Bastion of Light | Resto Shaman > MS > OS | Shield |  |

### Kazrogal

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Blue Suede Shoes | MS > OS | Cloth - Feet |  |
| Leggings of Channeled Elements | Mage > MS > OS | Cloth - Legs |  |
| Angelista's Sash | Healing Priest > Resto Shaman > MS > OS | Cloth - Waist |  |
| Razorfury Mantle | MS > OS | Leather - Shoulder |  |
| Black Featherlight Boots | MS > OS | Leather - Feet |  |
| Belt of the Crescent Moon | Balance > MS > OS | Leather - Waist |  |
| Beast-Tamer's Shoulders | MS > OS | Mail - Shoulder |  |
| Sun-Touched Chain Leggings | MS > OS | Mail - Legs |  |
| Valestalker Girdle | MS > OS | Mail - Waist |  |
| Belt of Seething Fury | MS > OS | Plate - Waist |  |
| Hammer of Atonement | Holy Paladin > MS > OS | Main Hand Mace |  |
| Kaz'rogal's Hardened Heart | Prot Warrior > MS > OS | Shield |  |

### Azgalor

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Don Rodrigo's Poncho | MS > OS | Leather - Chest |  |
| Shady Dealer's Pantaloons | MS > OS | Leather - Legs |  |
| Bow-Stitched Leggings | Hunter > MS > OS | Mail - Legs |  |
| Girdle of Hope | MS > OS | Plate - Waist |  |
| Glory of the Defender | MS > OS | Plate - Chest |  |
| Boundless Agony | Hunter > MS > OS | Dagger |  |
| Gloves of the Forgotten Conqueror | Major 2pc/4pc completion > Prot Paladin > Warlock > Shadow > Healing Priest > Holy Paladin | Gloves |  |
| Gloves of the Forgotten Protector | Major 2pc/4pc completion > Resto Shaman = Elemental > Hunter > DPS Warrior > Prot Warrior | Gloves |  |
| Gloves of the Forgotten Vanquisher | Major 2pc/4pc completion > Feral Tank > Feral DPS = Rogue > Mage > Resto Druid > Balance | Gloves |  |

### Archimonde

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Robes of Rhonin | MS > OS | Cloth - Chest |  |
| Leggings of Eternity | MS > OS | Cloth - Legs |  |
| Midnight Chestguard | Enhancement > MS > OS | Leather - Chest |  |
| Mail of Fevered Pursuit | MS > OS | Mail - Chest |  |
| Legguards of Endless Rage | MS > OS | Plate - Legs |  |
| Savior's Grasp | MS > OS | Plate - Chest |  |
| Antonidas' Aegis of Rapt Concentration | Prot Paladin > Elemental | Shield |  |
| Apostle of Argus | MS > OS | Two-Hand Staff |  |
| Cataclysm's Edge | DPS Warrior > MS > OS | Two-Hand Sword |  |
| Tempest of Chaos | Prot Paladin > Warlock = Mage | Main Hand Sword |  |
| Bristleblitz Striker | Hunter > MS > OS | Bow |  |
| Scepter of Purification | Resto Druid > Healing Priest > MS > OS | Off-hand |  |
| Helm of the Forgotten Conqueror | Major 2pc/4pc completion > Prot Paladin > Shadow > Healing Priest > Holy Paladin > Warlock | Head |  |
| Helm of the Forgotten Protector | Major 2pc/4pc completion > Hunter > DPS Warrior > Prot Warrior > Elemental > Resto Shaman | Head |  |
| Helm of the Forgotten Vanquisher | Major 2pc/4pc completion > Feral Tank > Mage > Balance > Rogue > Resto Druid > Feral DPS | Head |  |

### Black Temple Trash

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Band of Devastation | MS > OS | Finger |  |
| Ring of Ancient Knowledge | Warlock > Mage > MS > OS | Finger |  |
| Blessed Band of Karabor | Resto Shaman = Healing Priest > Holy Paladin > Resto Druid | Finger |  |
| Swiftsteel Bludgeon | MS > OS | One-Hand Mace |  |
| Girdle of the Lightbearer | MS > OS | Plate - Waist |  |
| Pillager's Gauntlets | MS > OS | Plate - Hands |  |
| Treads of the Den Mother | Feral Tank | Leather - Feet |  |
| Illidari Runeshield | MS > OS | Shield |  |
| Shroud of the Final Stand | Holy Paladin > Resto Druid > MS > OS | Back |  |

### High Warlord Najentus

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Ring of Calming Waves | Holy Paladin > MS > OS | Finger |  |
| Ring of Captured Storms | Warlock > MS > OS | Finger |  |
| Slippers of the Seacaller | Warlock > Mage > MS > OS | Cloth - Feet |  |
| Guise of the Tidal Lurker | MS > OS | Leather - Head |  |
| Mantle of Darkness | MS > OS | Leather - Shoulder |  |
| Helm of Soothing Currents | MS > OS | Mail - Head |  |
| Fists of Mukoa | MS > OS | Mail - Hands |  |
| Boots of Oceanic Fury | MS > OS | Mail - Feet |  |
| Eternium Shell Bracers | Prot Warrior > Prot Paladin | Plate - Wrist |  |
| Pearl Inlaid Boots | MS > OS | Plate - Feet |  |
| Tide-Stomper's Greaves | Prot Warrior | Plate - Feet |  |
| Rising Tide | MS > OS | One-Hand Axe |  |
| The Maelstrom's Fury | MS > OS | Main Hand Dagger |  |
| Halberd of Desolation | MS > OS | Polearm |  |

### Supremus

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Band of the Abyssal Lord | Prot Warrior > Feral Tank > Prot Paladin | Finger |  |
| Choker of Endless Nightmares | DPS Warrior > Rogue > Enhancement > MS > OS | Neck |  |
| Idol of the White Stag | MS > OS | Idol |  |
| Waistwrap of Infinity | Shadow > MS > OS | Cloth - Waist |  |
| Nether Shadow Tunic | MS > OS | Leather - Chest |  |
| Naturalist's Preserving Cinch | Resto Shaman > Holy Paladin | Mail - Waist |  |
| Bands of the Coming Storm | MS > OS | Mail - Wrist |  |
| Wraps of Precise Flight | MS > OS | Mail - Wrist |  |
| Pauldrons of Abyssal Fury | MS > OS | Plate - Shoulder |  |
| The Brutalizer | MS > OS | One-Hand Axe |  |
| Syphon of the Nathrezim | Enhancement > MS > OS | One-Hand Mace |  |
| Legionkiller | Prot Warrior > MS > OS | Crossbow |  |
| Felstone Bulwark | Holy Paladin > MS > OS | Shield |  |

### Shade of Akama

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Ring of Deceitful Intent | MS > OS | Finger |  |
| Amice of Brilliant Light | MS > OS | Cloth - Shoulder |  |
| Focused Mana Bindings | MS > OS | Cloth - Wrist |  |
| Wristbands of Divine Influence | MS > OS | Cloth - Wrist |  |
| Kilt of Immortal Nature | MS > OS | Leather - Legs |  |
| Shadow-Walker's Cord | MS > OS | Leather - Waist |  |
| Shoulders of the Hidden Predator | MS > OS | Mail - Shoulder |  |
| Spiritwalker Gauntlets | MS > OS | Mail - Hands |  |
| Flashfire Girdle | Elemental > MS > OS | Mail - Waist |  |
| Myrmidon's Treads | Prot Warrior > Prot Paladin | Plate - Feet |  |
| Grips of Silent Justice | MS > OS | Plate - Hands |  |
| Praetorian's Legguards | Prot Warrior > Prot Paladin | Plate - Legs |  |
| The Seeker's Wristguards | Prot Paladin | Plate - Wrist |  |
| Blind-Seers Icon | MS > OS | Off-hand |  |

### Teron Gorefiend

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Shadowmoon Destroyer's Drape | DPS Warrior > Hunter > MS > OS | Back |  |
| Totem of Ancestral Guidance | MS > OS | Totem |  |
| Cowl of Benevolence | MS > OS | Cloth - Head |  |
| Robe of the Shadow Council | MS > OS | Cloth - Chest |  |
| Botanist's Gloves of Growth | Resto Shaman > Holy Paladin > MS > OS | Leather - Hands |  |
| Insidious Bands | Rogue > Hunter > MS > OS | Leather - Wrist |  |
| Softstep Boots of Tracking | MS > OS | Mail - Feet |  |
| Gauntlets of Enforcement | MS > OS | Plate - Hands |  |
| Girdle of Lordaeron's Fallen | MS > OS | Plate - Waist |  |
| Soul Cleaver | MS > OS | Two-Hand Axe |  |
| Rifle of the Stoic Guardian | MS > OS | Gun |  |
| Twisted Blades of Zarak | MS > OS | Thrown |  |

### Gurtogg Bloodboil

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Unstoppable Aggressor's Ring | Retribution > MS > OS | Finger |  |
| Shroud of Forgiveness | Resto Druid > Healing Priest > MS > OS | Back |  |
| Blood-Cursed Shoulderpads | MS > OS | Cloth - Shoulder |  |
| Garments of Temperance | MS > OS | Cloth - Chest |  |
| Belt of Primal Majesty | Resto Druid > MS > OS | Leather - Waist |  |
| Vest of Mounting Assault | MS > OS | Mail - Chest |  |
| Leggings of Divine Retribution | DPS Warrior > MS > OS | Plate - Legs |  |
| Girdle of Mighty Resolve | Prot Paladin | Plate - Waist |  |
| Girdle of Stability | Prot Warrior > Prot Paladin | Plate - Waist |  |
| Messenger of Fate | MS > OS | One-Hand Dagger |  |
| Staff of Immaculate Recovery | MS > OS | Two-Hand Staff |  |
| Wand of Prismatic Focus | MS > OS > Warlock | Wand | Warlock chain is for tanking off-spec. |
| Shadowmoon Insignia | Feral Tank > Prot Warrior > Prot Paladin > MS > OS | Trinket |  |

### Reliquary of Souls

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Translucent Spellthread Necklace | Warlock > MS > OS | Neck |  |
| Pendant of Titans | Prot Warrior = Feral Tank > Prot Paladin | Neck |  |
| Gloves of Unfailing Faith | MS > OS | Cloth - Hands |  |
| Elunite Empowered Bracers | MS > OS | Leather - Wrist |  |
| Grips of Damnation | MS > OS | Leather - Hands |  |
| Naturewarden's Treads | Balance > Elemental > MS > OS | Leather - Feet |  |
| Boneweave Girdle | MS > OS | Mail - Waist |  |
| The Wavemender's Mantle | MS > OS | Mail - Shoulder |  |
| Crown of Empowered Fate | MS > OS | Plate - Head |  |
| Dreadboots of the Legion | DPS Warrior > Retribution > MS > OS | Plate - Feet |  |
| Naaru-Blessed Life Rod | Healing Priest | Wand |  |
| Torch of the Damned | Retribution > MS > OS | Two-Hand Mace |  |
| Touch of Inspiration | MS > OS | Off-hand |  |

### Mother Shahraz

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Nadina's Pendant of Purity | Holy Paladin > Healing Priest = Resto Shaman > MS > OS | Neck |  |
| Tome of the Lightbringer | MS > OS | Libram |  |
| Leggings of Devastation | MS > OS | Cloth - Legs |  |
| Shadowmaster's Boots | Hunter > MS > OS | Leather - Feet |  |
| Heartshatter Breastplate | MS > OS | Plate - Chest |  |
| Blade of Savagery | Rogue > Prot Warrior > MS > OS | One-Hand Sword |  |
| Pauldrons of the Forgotten Conqueror | Major 2pc/4pc completion > Prot Paladin > Shadow > Healing Priest > Holy Paladin > Warlock | Shoulder |  |
| Pauldrons of the Forgotten Protector | Major 2pc/4pc completion > DPS Warrior > Prot Warrior > Elemental > Resto Shaman > Hunter | Shoulder |  |
| Pauldrons of the Forgotten Vanquisher | Major 2pc/4pc completion > Resto Druid > Feral Tank > Balance > Feral DPS > Rogue > Mage | Shoulder |  |

### The Illidari Council

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Cloak of the Illidari Council | Mage > MS > OS | Back |  |
| Madness of the Betrayer | Hunter > DPS Warrior > MS > OS | Trinket |  |
| Belt of Divine Guidance | MS > OS | Cloth - Waist |  |
| Veil of Turning Leaves | MS > OS | Leather - Shoulder |  |
| Forest Prowler's Helm | MS > OS | Mail - Head |  |
| Helm of the Illidari Shatterer | MS > OS | Plate - Head |  |
| Leggings of the Forgotten Conqueror | Major 2pc/4pc completion > Healing Priest > Holy Paladin > Warlock > Prot Paladin > Shadow | Legs |  |
| Leggings of the Forgotten Protector | Major 2pc/4pc completion > Prot Warrior > Elemental > Resto Shaman > Hunter > DPS Warrior | Legs |  |
| Leggings of the Forgotten Vanquisher | Major 2pc/4pc completion > Balance > Mage > Rogue > Resto Druid > Feral DPS > Feral Tank | Legs |  |

### Illidan Stormrage

| Item | Priority | Slot | Notes |
|---|---|---|---|
| Shroud of the Highborne | Healing Priest = Resto Shaman > Holy Paladin > MS > OS | Back |  |
| Stormrage Signet Ring | DPS Warrior > Hunter > MS > OS | Finger |  |
| Memento of Tyrande | Resto Druid > Healing Priest = Resto Shaman > MS > OS | Trinket |  |
| The Skull of Gul'dan | Warlock > Mage > MS > OS | Trinket |  |
| Cowl of the Illidari High Lord | MS > OS | Cloth - Head |  |
| Cursed Vision of Sargeras | Rogue > DPS Warrior > Enhancement > MS > OS | Leather - Head |  |
| Faceplate of the Impenetrable | Prot Paladin > Prot Warrior | Plate - Head |  |
| Shard of Azzinoth | MS > OS | One-Hand Dagger |  |
| Crystal Spire of Karabor | Healing Priest = Resto Shaman > Resto Druid > MS > OS | Main Hand Mace |  |
| Zhar'doom, Greatstaff of the Devourer | Mage = Warlock > Shadow > MS > OS | Two-Hand Staff |  |
| Warglaive of Azzinoth (Main Hand) | Set completion > DPS Warrior > Rogue | Main Hand Sword | Complete the 2-piece set before normal priority. |
| Warglaive of Azzinoth (Off Hand) | Set completion > Rogue > DPS Warrior | Off Hand Sword | Complete the 2-piece set before normal priority. |
| Black Bow of the Betrayer | Hunter > MS > OS | Bow |  |
| Bulwark of Azzinoth | Prot Paladin > Prot Warrior | Shield |  |
| Chestguard of the Forgotten Conqueror | Major 2pc/4pc completion > Holy Paladin > Warlock > Prot Paladin > Shadow > Healing Priest | Chest |  |
| Chestguard of the Forgotten Protector | Major 2pc/4pc completion > Prot Warrior > Elemental > Resto Shaman > Hunter > DPS Warrior | Chest |  |
| Chestguard of the Forgotten Vanquisher | Major 2pc/4pc completion > Feral Tank > Feral DPS > Rogue > Mage > Balance > Resto Druid | Chest |  |
`;
