"""Builds client/assets/*.glb from the Quaternius, Kenney and KayKit packs (all CC0).

    python3 tools/assets/build_assets.py /path/to/unzipped/packs

The packs themselves aren't in the repo (several hundred MB); the slimmed .glb files are.
See client/assets/CREDITS.md for what came from where.
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gltfpack import Pack, add_obj  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/assets-src'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'client', 'assets')
os.makedirs(OUT, exist_ok=True)


def find(pattern):
    hits = sorted(glob.glob(os.path.join(SRC, '**', pattern), recursive=True))
    if not hits:
        raise SystemExit(f'missing source file: {pattern}')
    return hits[0]


def done(pack, name):
    n = pack.write(os.path.join(OUT, name))
    print(f'{name:16s} {n / 1024:8.0f} KB')


# ---------------------------------------------------------------- people: base bodies and hair
p = Pack()
for body in ('Superhero_Male_FullBody', 'Superhero_Female_FullBody'):
    p.add_model(find(f'Godot - UE/{body}.gltf'), body, tex_size=1024, keep_tex=('base', 'normal'))
for hair in ('Hair_Beard', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted', 'Eyebrows_Female', 'Eyebrows_Regular'):
    p.add_model(find(f'Rigged to Head Bone/glTF*/{hair}.gltf'), hair, tex_size=512, keep_tex=('base', 'normal'))
done(p, 'people.glb')

# ---------------------------------------------------------------- the Universal Animation Library (no mesh)
KEEP = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
        'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Shoot', 'Pistol_Reload',
        'Sword_Idle', 'Sword_Attack', 'Punch_Jab', 'Punch_Cross', 'Roll', 'Death01', 'Hit_Chest', 'Hit_Head',
        'Driving_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Interact', 'Fixing_Kneeling', 'PickUp_Table',
        'Spell_Simple_Shoot', 'Spell_Simple_Idle_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Idle_Talking_Loop',
        'Walk_Formal_Loop', 'Dance_Loop', 'Push_Loop', 'A_TPose']
p = Pack()
p.add_model(find('Unreal-Godot/UAL1_Standard.glb'), 'UAL', with_mesh=False, anims=KEEP, retarget=True)
done(p, 'anims.glb')

# ---------------------------------------------------------------- weapons
p = Pack()
for g in ('Gun_Pistol', 'Gun_Revolver', 'Gun_Rifle', 'Gun_Sniper'):
    p.add_model(find(f'Sci-Fi_Essentials*/glTF/{g}.gltf'), g, tex_size=512)
for g in ('Lightning Gun', 'LongPistol', 'LongPistol_small', 'Pistol', 'Ray Gun', 'Rifle', 'Sniper rifle'):
    add_obj(p, find(f'Sci-Fi Gun Pack*/OBJ/{g}.obj'), 'GP_' + g.replace(' ', '_'))
done(p, 'weapons.glb')

# ---------------------------------------------------------------- props, drones and droids (Sci-Fi Essentials + Space Kit pickups)
p = Pack()
for g in ('Prop_Ammo', 'Prop_Ammo_Closed', 'Prop_Ammo_Small', 'Prop_Barrel1', 'Prop_Barrel2_Closed', 'Prop_Barrel2_Open', 'Prop_Chair',
          'Prop_Chest', 'Prop_Crate', 'Prop_Crate_Large', 'Prop_Crate_Tarp', 'Prop_Crate_Tarp_Large', 'Prop_Desk_L', 'Prop_Desk_Medium',
          'Prop_Desk_Small', 'Prop_Grenade', 'Prop_HealthPack', 'Prop_HealthPack_Tube', 'Prop_KeyCard', 'Prop_Locker', 'Prop_Mine',
          'Prop_Mug', 'Prop_SatelliteDish', 'Prop_Shelves_ThinShort', 'Prop_Shelves_ThinTall', 'Prop_Shelves_WideShort', 'Prop_Shelves_WideTall', 'Prop_Syringe'):
    p.add_model(find(f'Sci-Fi_Essentials*/glTF/{g}.gltf'), g, tex_size=512)
for g, clips in (('Enemy_EyeDrone', ['Idle', 'Look', 'Attack', 'Hit']), ('Enemy_QuadShell', ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'TurnOff', 'Look']), ('Enemy_Trilobite', ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'TurnOff', 'Look'])):
    p.add_model(find(f'Sci-Fi_Essentials*/glTF/{g}.gltf'), g, tex_size=512, anims=clips, anim_prefix=g + '|')
for g in ('Pickup_KeyCard', 'Pickup_Sphere', 'Pickup_Health', 'Pickup_Crate'):
    p.add_model(find(f'Items/GLTF/{g}.gltf'), g, tex_size=256)
done(p, 'props.glb')

# ---------------------------------------------------------------- Modular Sci-Fi MegaKit: garrison and vault dressing
p = Pack()
MK = 'Modular SciFi MegaKit*/glTF'
for g in ('Prop_AccessPoint', 'Prop_Barrel_Large', 'Prop_Chest', 'Prop_Computer', 'Prop_Crate3', 'Prop_Crate4', 'Prop_Fan_Small', 'Prop_ItemHolder',
          'Prop_Light_Floor', 'Prop_Light_Wide', 'Prop_PipeHolder', 'Prop_Vent_Big', 'Prop_Vent_Wide', 'Prop_Cable_1'):
    p.add_model(find(f'{MK}/Props/{g}.gltf'), 'MK_' + g, tex_size=512, keep_tex=('base', 'normal', 'emissive'))
for g in ('Column_Astra', 'Column_Pipes', 'Column_MetalSupport', 'Column_Round'):
    p.add_model(find(f'{MK}/Columns/{g}.gltf'), 'MK_' + g, tex_size=512, keep_tex=('base', 'normal', 'emissive'))
for g in ('Platform_Metal', 'Platform_DarkPlates', 'Platform_Simple', 'Platform_Stairs_2', 'Door_Frame_Square', 'Door_Metal'):
    p.add_model(find(f'{MK}/Platforms/{g}.gltf'), 'MK_' + g, tex_size=512, keep_tex=('base', 'normal', 'emissive'))
for g in ('ShortWall_MetalPlates_Straight', 'ShortWall_DarkMetal2_Straight', 'ShortWall_AccentStrip_Straight', 'TopCables_Straight'):
    p.add_model(find(f'{MK}/Walls/{g}.gltf'), 'MK_' + g, tex_size=512, keep_tex=('base', 'normal', 'emissive'))
for g in ('Decal_Logo', 'Decal_XSign', 'Decal_Sign'):
    p.add_model(find(f'{MK}/Decals/{g}.gltf'), 'MK_' + g, tex_size=512, keep_tex=('base',))
for g in ('Alien_Cyclop', 'Alien_Oculichrysalis', 'Alien_Scolitex'):
    p.add_model(find(f'{MK}/Aliens/{g}.gltf'), 'MK_' + g, tex_size=512, anims=['Alien_Idle'], anim_prefix='MK_' + g + '|')
done(p, 'megakit.glb')

# ---------------------------------------------------------------- Ultimate Space Kit: colony buildings, alien flora, ships, rovers, colonists
p = Pack()
SK = 'Ultimate Space Kit - March 2023'
for g in ('Base_Large', 'Building_L', 'House_Cylinder', 'House_Long', 'House_Open', 'House_Single', 'House_Single_Support', 'GeodesicDome',
          'Connector', 'Roof_Antenna', 'Roof_Radar', 'Roof_VentL', 'SolarPanel_Ground', 'SolarPanel_Structure', 'MetalSupport', 'Stairs',
          'Rock_Large_1', 'Rock_Large_2', 'Rock_Large_3', 'Rock_1', 'Rock_2',
          'Tree_Blob_1', 'Tree_Blob_2', 'Tree_Blob_3', 'Tree_Spiral_1', 'Tree_Spiral_2', 'Tree_Light_1', 'Tree_Light_2', 'Tree_Spikes_1',
          'Tree_Swirl_1', 'Tree_Floating_1', 'Tree_Lava_1', 'Plant_1', 'Plant_2', 'Plant_3', 'Bush_1', 'Bush_2',
          'Planet_1', 'Planet_6', 'Planet_9'):
    p.add_model(find(f'{SK}/Environment/GLTF/{g}.gltf'), 'SK_' + g, tex_size=256)
for g in ('Rover_1', 'Rover_2', 'Rover_Round', 'Spaceship_BarbaraTheBee', 'Spaceship_FernandoTheFlamingo', 'Spaceship_FinnTheFrog', 'Spaceship_RaeTheRedPanda'):
    p.add_model(find(f'{SK}/Vehicles/GLTF/{g}.gltf'), 'SK_' + g, tex_size=256)
for g in ('Astronaut_FinnTheFrog', 'Astronaut_RaeTheRedPanda', 'Astronaut_BarbaraTheBee', 'Astronaut_FernandoTheFlamingo'):
    p.add_model(find(f'{SK}/Characters/GLTF/{g}.gltf'), 'SK_' + g, tex_size=256, anims=['Idle', 'Walk', 'Run', 'Death', 'Wave', 'Yes', 'No', 'HitReact', 'Duck'], anim_prefix='SK_' + g + '|')
for g in ('Mech_FinnTheFrog', 'Mech_BarbaraTheBee'):
    p.add_model(find(f'{SK}/Characters/GLTF/{g}.gltf'), 'SK_' + g, tex_size=256, anims=['Idle', 'Walk', 'Pickup', 'Hello', 'Death'], anim_prefix='SK_' + g + '|')
done(p, 'space.glb')

# ---------------------------------------------------------------- town and colony kits: Kenney Space Kit, KayKit Space Base Bits,
# Quaternius Ultimate Textured Building Pack (recoloured to Dusk Varo's adobe)
p = Pack()
for g in ('hangar_largeA', 'hangar_roundA', 'machine_generatorLarge', 'satelliteDish_large'):
    p.add_model(find(f'kenney/Models/GLTF format/{g}.glb'), 'KN_' + g, tex_size=256)
for g in ('basemodule_A', 'basemodule_B', 'basemodule_C', 'basemodule_D', 'basemodule_E', 'basemodule_garage',
          'cargodepot_A', 'cargodepot_B', 'containers_A', 'containers_B', 'containers_C', 'containers_D', 'drill_structure',
          'spacetruck_large', 'windturbine_low', 'windturbine_tall'):
    p.add_model(find(f'KayKit_Space_Base_Bits*/Assets/gltf/{g}.gltf'), 'KK_' + g, tex_size=256)
# the building pack's light palette, mapped onto sun-baked adobe: walls, ledges, roofs, stonework, trim, clay footings
ADOBE = {(165, 165, 165): (201, 154, 106), (146, 135, 127): (168, 119, 79), (184, 178, 176): (186, 140, 96), (201, 201, 201): (218, 180, 136),
         (212, 212, 212): (230, 204, 164), (136, 129, 118): (150, 98, 64), (89, 91, 109): (66, 46, 36), (116, 138, 155): (58, 86, 96),
         (73, 73, 73): (80, 60, 48), (0, 0, 0): (30, 22, 18), (237, 28, 36): (168, 72, 48)}
def adobe(c):
    k = tuple(int(round(x * 255)) for x in c)
    return tuple(x / 255 for x in ADOBE.get(k, k))
UB = 'Ultimate Textured Building Pack*/Textured Models'
for g in ('1Story', '1Story_RoundRoof', '2Story', '2Story_Balcony', '2Story_Columns', '2Story_Stairs', '3Story_Small'):
    add_obj(p, find(f'{UB}/Finished Textured Buildings/OBJ/{g}.obj'), 'UBA_' + g, palette=find(f'{UB}/Textures/Texture_Light.png'), recolor=adobe)
done(p, 'kits.glb')

# ---------------------------------------------------------------- the Wayfarer: Challenger from the Ultimate Spaceships Pack (glTF folder)
p = Pack()
p.add_model(find('glTF/Challenger.gltf'), 'SHIP_Challenger', tex_size=1024)
done(p, 'ships.glb')
