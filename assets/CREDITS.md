# Asset credits

All models, textures and animations in this folder come from packs by **Quaternius** (https://quaternius.com),
**Kenney** (https://kenney.nl) and **Kay Lousberg** (KayKit, https://kaylousberg.com), all released under **CC0 1.0** (public domain). No attribution is required; this list is a thank-you and a record of what came from where.

| File | Source pack | Used for |
| --- | --- | --- |
| people.glb, skin_*.webp | Universal Base Characters (Standard) | Every person: crew, guards, officers, townsfolk, plus hair and brows |
| anims.glb | Universal Animation Library (Standard) | Locomotion, aiming, melee, hits, deaths, driving, sitting, working |
| weapons.glb | Sci-Fi Essentials Kit, Sci-Fi Gun Pack | Crew guns, trooper rifles, officer and hunter weapons |
| props.glb | Sci-Fi Essentials Kit, Ultimate Space Kit (items) | Crates, barrels, lockers, shelves, desks, dishes, grenades, mines, pickups, eye-drone cameras, droids |
| megakit.glb | Modular Sci-Fi MegaKit (Standard) | Garrison and vault props, columns, decals, the specimens in Cryo-Vault Sigma |
| space.glb | Ultimate Space Kit (March 2023) | Colony prefabs, alien trees, rocks, sky planets, rovers, trader ships, colonists, loader mechs |
| kits.glb | Ultimate Textured Building Pack (Quaternius, recoloured to adobe), KayKit Space Base Bits (Kay Lousberg), Space Kit (Kenney) | Khet's outer houses, Rime Hold's base modules, Korrun's space trucks, spaceport hangars and machinery |
| ships.glb | Ultimate Spaceships Pack (Quaternius) | The Wayfarer (the Challenger hull) |

The files were slimmed by `tools/assets/build_assets.py` (WebP textures, quantized meshes, reduced keyframes).
The glTF loader in `client/vendor/GLTFLoader.js` is from three.js r169 (MIT License, Copyright 2010-2024 three.js authors).
