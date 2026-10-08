"""Tractor unit + 40ft skeletal container trailer (Balar livery).

Built along local X with the cab at +X; local -Y is the logo side. The trailer deck
centre sits at the origin so a container dropped at (0, 0, DECK) lands centred.
Returns (root, wheels) where wheels is a list of (wheel_root, radius) for spinning.
"""
import math
from lib import box, cylinder, profile, arc, mat, wheel, empty, text, hazard

DECK = 1.5          # top of the twistlocks = container bottom


def build_truck(name='truck', loc=(0, 0, 0), parent=None):
    root = empty(name, loc, parent)
    cab_paint = mat('cab_white', '#eef0f3', metal=0.2, rough=0.28, coat=1.0, coat_rough=0.05)
    accent = mat('balar_indigo', '#3b2cff', metal=0.3, rough=0.3, coat=1.0, coat_rough=0.05)
    orange = mat('balar_orange', '#ff8a3d', metal=0.2, rough=0.35, coat=0.8)
    dark = mat('truck_dark', '#1d2127', metal=0.4, rough=0.45, coat=0.3)
    steel = mat('truck_steel', '#c9ced6', metal=1.0, rough=0.2)
    glass = mat('truck_glass', '#121c26', rough=0.02, coat=1.0)
    lamp = mat('truck_lamp', '#ffffff', emit='#fff4dc', emit_strength=5)
    tail = mat('truck_tail', '#ff2a1a', emit='#ff2010', emit_strength=3)
    amber = mat('truck_amber', '#ffb020', emit='#ff9000', emit_strength=3)
    white_txt = mat('truck_txt', '#ffffff', rough=0.4)
    wheels = []

    # ------------------------------------------------------------------ tractor
    # frame rails, fifth wheel, fuel tank, steps
    for y in (-0.48, 0.48):
        box('t_rail', (6.3, 0.18, 0.32), (5.75, y, 0.98), dark, bevel=0.02, parent=root)
    cylinder('fifth_wheel', 0.75, 0.16, (4.9, 0, 1.22), dark, axis='Z', parent=root)
    cylinder('fuel_tank', 0.33, 1.3, (6.85, -0.95, 0.85), steel, axis='X', parent=root, bevel=0.06)
    box('battery', (0.8, 0.55, 0.55), (6.85, 0.95, 0.85), dark, bevel=0.03, parent=root)
    # cab: sculpted outline (flat cab-over front with a slight rake), roof fairing, sun visor
    cab = [(6.55, 1.15), (8.82, 1.15), (8.95, 1.55), (8.95, 2.55), (8.82, 3.7), (8.6, 3.95), (6.55, 3.95)]
    profile('cab', cab, 2.48, cab_paint, bevel=0.1, segments=5, parent=root)
    profile('fairing', [(6.7, 3.92), (8.35, 3.92), (8.1, 4.12), (7.2, 4.65), (6.7, 4.65)], 2.36, cab_paint, bevel=0.12, segments=5, parent=root)
    profile('visor', [(8.5, 3.82), (8.98, 3.86), (8.98, 3.95), (8.5, 3.97)], 2.3, dark, bevel=0.02, parent=root)
    # windscreen + side windows
    profile('windscreen', [(8.9, 2.62), (8.99, 2.62), (8.86, 3.72), (8.77, 3.72)], 2.2, glass, bevel=0.03, parent=root)
    for y in (-1.245, 1.245):
        box('side_window', (0.95, 0.02, 0.85), (8.25, y, 3.2), glass, bevel=0.01, parent=root)
        box('mirror_arm', (0.06, 0.35, 0.06), (8.95, y * 1.1, 3.35), dark, parent=root)
        box('mirror', (0.08, 0.16, 0.62), (8.98, y * 1.24, 3.05), dark, bevel=0.02, parent=root)
    # indigo lower band + orange pinstripe along the cab side, grille, bumper, lights
    box('cab_band', (2.3, 2.52, 0.55), (7.69, 0, 1.55), accent, bevel=0.06, parent=root)
    box('cab_stripe', (2.3, 2.53, 0.07), (7.69, 0, 1.88), orange, bevel=0.01, parent=root)
    for i in range(5):
        box(f'grille{i}', (0.05, 1.5, 0.08), (8.97, 0, 2.0 + i * 0.13), dark, bevel=0.01, parent=root)
    box('bumper', (0.3, 2.5, 0.45), (8.95, 0, 1.05), dark, bevel=0.05, parent=root)
    for y in (-0.95, 0.95):
        box('headlight', (0.06, 0.42, 0.18), (9.0, y, 1.6), lamp, bevel=0.02, parent=root)
        box('indicator', (0.06, 0.14, 0.12), (9.0, y * 1.2, 1.6), amber, bevel=0.01, parent=root)
    for i, y in enumerate((-0.6, -0.2, 0.2, 0.6)):
        box(f'roof_lamp{i}', (0.08, 0.14, 0.08), (8.4, y, 4.02), amber, parent=root)
    text('cab_logo', 'BALAR', 0.34, (7.0, -1.25, 2.55), accent, parent=root)
    for i, z in enumerate((0.75, 1.1)):
        box(f'cab_step{i}', (0.55, 0.3, 0.06), (8.2, -1.25, z), steel, parent=root)
    cylinder('exhaust', 0.1, 2.3, (6.45, 1.0, 3.6), steel, axis='Z', parent=root)
    # mudguards over the drive axles
    for x in (4.3, 5.6):
        profile('guard', arc(x, 0.52, 0.66, 170, 10) + arc(x, 0.52, 0.6, 10, 170), 2.5, dark, bevel=0.01, parent=root)
    # wheels: steer axle singles, twin drive axles
    for y in (-1.05, 1.05):
        wheels.append((wheel('w_steer', 0.52, 0.32, '#c9ced6', (7.8, y, 0.52), parent=root, studs=8), 0.52))
    for x in (4.3, 5.6):
        for y in (-1.08, -0.74, 0.74, 1.08):
            wheels.append((wheel('w_drive', 0.52, 0.3, '#c9ced6', (x, y, 0.52), parent=root, studs=8), 0.52))

    # ------------------------------------------------------------------ trailer (skeletal 40ft)
    L = 12.6
    for y in (-0.52, 0.52):
        box('tr_rail', (L, 0.2, 0.36), (0, y, 1.18), dark, bevel=0.02, parent=root)
    for i in range(9):
        box(f'tr_cross{i}', (0.16, 2.44, 0.14), (-L / 2 + 0.4 + i * (L - 0.8) / 8, 0, 1.3), dark, bevel=0.01, parent=root)
    for x in (-L / 2 + 0.25, L / 2 - 0.25):
        for y in (-1.1, 1.1):
            box('twistlock', (0.25, 0.2, 0.14), (x, y, 1.43), steel, bevel=0.01, parent=root)
    # gooseneck front end raised over the fifth wheel
    box('gooseneck', (2.2, 1.3, 0.3), (5.2, 0, 1.33), dark, bevel=0.03, parent=root)
    # landing legs
    for y in (-0.85, 0.85):
        box('leg', (0.14, 0.14, 0.95), (2.8, y, 0.62), dark, parent=root)
        box('foot', (0.3, 0.3, 0.06), (2.8, y, 0.15), dark, parent=root)
    cylinder('crank', 0.04, 0.4, (2.8, -1.05, 0.95), steel, axis='Y', parent=root)
    # side skirts in Balar indigo with the brand line
    for y in (-1.2, 1.2):
        box('skirt', (6.0, 0.04, 0.62), (-0.3, y, 0.88), accent, bevel=0.015, parent=root)
        box('skirt_line', (6.0, 0.05, 0.05), (-0.3, y, 1.1), orange, parent=root)
    text('skirt_logo', 'BALAR OVERSEAS', 0.3, (-2.9, -1.23, 0.72), white_txt, parent=root)
    # rear: bumper with hazard stripes, tail lights, mudflaps
    box('rear_bumper', (0.18, 2.3, 0.22), (-L / 2 - 0.05, 0, 0.62), hazard('tr_hazard'), bevel=0.02, parent=root)
    for y in (-0.95, 0.95):
        box('tail', (0.06, 0.38, 0.16), (-L / 2 - 0.15, y, 0.82), tail, bevel=0.01, parent=root)
        box('mudflap', (0.03, 0.6, 0.55), (-5.95, y, 0.45), dark, parent=root)
    # tri-axle bogie
    for x in (-2.7, -4.0, -5.3):
        box('axle', (0.12, 2.2, 0.12), (x, 0, 0.5), dark, parent=root)
        for y in (-1.08, -0.74, 0.74, 1.08):
            wheels.append((wheel('w_trailer', 0.5, 0.3, '#c9ced6', (x, y, 0.5), parent=root, studs=8), 0.5))
    return root, wheels
