"""Tractor unit + 40ft skeletal container trailer (Balar livery).

Built along local X with the cab at +X; local -Y is the camera side. The trailer deck
centre sits at the origin so a container dropped at (0, 0, DECK) lands centred.
Proportions follow the reference side view: high-roof dark cab-over on a two-axle
tractor, plain straight-rail chassis trailer with the tri-axle bogie set forward of the
rear overhang, chrome side guard between the landing legs and the bogie, spare wheel and
toolbox behind the bogie. No lettering below the deck.
Returns (root, wheels) where wheels is a list of (wheel_root, radius) for spinning.
"""
import math
from lib import box, cylinder, profile, arc, mat, wheel, empty, text, hazard

DECK = 1.5          # top of the twistlocks = container bottom
TRAILER_AXLES = (-3.3, -2.0, -0.7)
DRIVE_X, STEER_X = 4.2, 7.7


def build_truck(name='truck', loc=(0, 0, 0), parent=None, cab_color='#1a1c21'):
    root = empty(name, loc, parent)
    cab_paint = mat('cab_paint', cab_color, metal=0.5, rough=0.3, coat=0.6, coat_rough=0.1)
    dark = mat('truck_dark', '#16181c', metal=0.4, rough=0.45, coat=0.3)
    grey = mat('truck_grey', '#8d939b', metal=0.6, rough=0.35)
    steel = mat('truck_steel', '#d4d8de', metal=1.0, rough=0.18)
    glass = mat('truck_glass', '#0e151d', rough=0.02, coat=1.0)
    lamp = mat('truck_lamp', '#ffffff', emit='#fff4dc', emit_strength=5)
    tail = mat('truck_tail', '#ff2a1a', emit='#ff2010', emit_strength=3)
    amber = mat('truck_amber', '#ffb020', emit='#ff9000', emit_strength=3)
    white_txt = mat('truck_txt', '#e9ebef', rough=0.4)
    wheels = []

    # ------------------------------------------------------------------ tractor
    for y in (-0.48, 0.48):
        box('t_rail', (5.8, 0.18, 0.32), (6.2, y, 0.98), dark, bevel=0.02, parent=root)
    cylinder('fifth_wheel', 0.75, 0.16, (4.5, 0, 1.22), dark, axis='Z', parent=root)
    # high-roof cab-over: flat front, rounded roof edge, one piece up to the roof
    cab = [(6.6, 1.1), (9.05, 1.1), (9.2, 1.45), (9.22, 3.25)] + arc(8.72, 3.45, 0.5, 0, 90, 8)[1:] + [(6.6, 3.95)]
    profile('cab', cab, 2.5, cab_paint, bevel=0.1, segments=5, parent=root)
    profile('windscreen', [(9.15, 2.55), (9.24, 2.55), (9.2, 3.45), (9.1, 3.45)], 2.2, glass, bevel=0.03, parent=root)
    profile('visor', [(9.05, 3.5), (9.3, 3.52), (9.3, 3.6), (9.0, 3.62)], 2.3, dark, bevel=0.02, parent=root)
    for y in (-1.255, 1.255):
        profile(f'side_window{y}', [(8.25, 2.6), (9.0, 2.6), (8.98, 3.4), (8.25, 3.4)], 0.02, glass, y=y, bevel=0.01, parent=root)
        box('door_line', (0.02, 0.02, 1.9), (8.15, y * 1.003, 2.2), dark, bevel=0, parent=root)
        box('cab_crease', (2.3, 0.02, 0.03), (7.85, y * 1.003, 2.35), dark, bevel=0, parent=root)
        box('mirror_arm', (0.06, 0.35, 0.06), (9.2, y * 1.1, 3.25), dark, parent=root)
        box('mirror', (0.08, 0.16, 0.7), (9.25, y * 1.24, 2.95), dark, bevel=0.02, parent=root)
        # front wheel arch cut-out look + side fairing between the axles (fuel tank cover)
        profile(f'f_arch{y}', arc(STEER_X, 0.55, 0.72, 0, 180, 14) + arc(STEER_X, 0.55, 0.62, 180, 0, 14), 0.06, dark, y=y * 1.0, bevel=0.01, parent=root)
        box('side_fairing', (2.05, 0.06, 0.62), (5.85, y * 0.98, 0.82), cab_paint, bevel=0.03, parent=root)
        box('step_panel', (0.55, 0.07, 0.5), (6.6, y * 0.99, 0.78), grey, bevel=0.02, parent=root)
    for i in range(4):
        box(f'grille{i}', (0.05, 1.4, 0.07), (9.22, 0, 1.75 + i * 0.16), dark, bevel=0.01, parent=root)
    box('bumper', (0.3, 2.5, 0.5), (9.15, 0, 1.0), dark, bevel=0.05, parent=root)
    for y in (-0.95, 0.95):
        box('headlight', (0.06, 0.45, 0.16), (9.28, y, 1.42), lamp, bevel=0.02, parent=root)
        box('indicator', (0.06, 0.14, 0.12), (9.28, y * 1.2, 1.42), amber, bevel=0.01, parent=root)
    text('cab_logo', 'BALAR', 0.3, (7.0, -1.27, 2.65), white_txt, parent=root)
    cylinder('exhaust', 0.09, 1.8, (6.5, 1.05, 4.0), steel, axis='Z', parent=root)
    # rear mudguard over the drive axle
    profile('guard', arc(DRIVE_X, 0.52, 0.68, 175, 5, 12) + arc(DRIVE_X, 0.52, 0.6, 5, 175, 12), 2.5, dark, bevel=0.01, parent=root)
    for y in (-1.05, 1.05):
        wheels.append((wheel('w_steer', 0.52, 0.32, '#c9ced6', (STEER_X, y, 0.52), parent=root, studs=8), 0.52))
    for y in (-1.08, -0.74, 0.74, 1.08):
        wheels.append((wheel('w_drive', 0.52, 0.3, '#c9ced6', (DRIVE_X, y, 0.52), parent=root, studs=8), 0.52))

    # ------------------------------------------------------------------ trailer (skeletal 40ft)
    L = 12.6
    for y in (-0.52, 0.52):
        box('tr_rail', (L, 0.2, 0.36), (0, y, 1.18), dark, bevel=0.02, parent=root)
    for i in range(9):
        box(f'tr_cross{i}', (0.16, 2.44, 0.14), (-L / 2 + 0.4 + i * (L - 0.8) / 8, 0, 1.3), dark, bevel=0.01, parent=root)
    for y in (-1.2, 1.2):
        box('tr_side', (L, 0.08, 0.16), (0, y, 1.3), dark, bevel=0.01, parent=root)
    for x in (-L / 2 + 0.25, L / 2 - 0.25):
        for y in (-1.1, 1.1):
            box('twistlock', (0.25, 0.2, 0.14), (x, y, 1.43), steel, bevel=0.01, parent=root)
    # landing legs + crank
    for y in (-0.85, 0.85):
        box('leg', (0.16, 0.16, 0.95), (2.7, y, 0.62), dark, parent=root)
        box('foot', (0.3, 0.3, 0.06), (2.7, y, 0.15), dark, parent=root)
    cylinder('crank', 0.04, 0.4, (2.7, -1.05, 0.95), steel, axis='Y', parent=root)
    # chrome side guard between the landing legs and the bogie (two rails on brackets)
    g0, g1 = TRAILER_AXLES[-1] + 0.75, 2.35
    for y in (-1.18, 1.18):
        for z in (0.72, 0.98):
            box('guard_rail', (g1 - g0, 0.05, 0.1), ((g0 + g1) / 2, y, z), steel, bevel=0.015, parent=root)
        for x in (g0 + 0.1, (g0 + g1) / 2, g1 - 0.1):
            box('guard_post', (0.07, 0.05, 0.42), (x, y * 0.99, 0.95), dark, parent=root)
    # behind the bogie: spare wheel in its cradle, toolbox, mudflaps, rear bumper and lights
    sx = -5.15
    cylinder('spare', 0.5, 0.28, (sx, 0, 0.82), mat('spare_rubber', '#15161a', rough=0.9), axis='Z', parent=root)
    cylinder('spare_rim', 0.3, 0.3, (sx, 0, 0.82), steel, axis='Z', parent=root)
    for y in (-0.62, 0.62):
        box('cradle', (1.2, 0.05, 0.08), (sx, y, 0.62), dark, parent=root)
    box('toolbox', (0.7, 0.5, 0.48), (-4.3, -0.9, 0.86), dark, bevel=0.03, parent=root)
    box('toolbox_lid', (0.62, 0.02, 0.06), (-4.3, -1.16, 1.0), grey, parent=root)
    for y in (-0.95, 0.95):
        box('mudflap', (0.03, 0.6, 0.55), (TRAILER_AXLES[0] - 0.65, y, 0.42), dark, parent=root)
        box('tail', (0.06, 0.38, 0.16), (-L / 2 - 0.15, y, 0.85), tail, bevel=0.01, parent=root)
        box('light_bracket', (0.3, 0.06, 0.4), (-L / 2 - 0.02, y * 1.15, 0.95), dark, parent=root)
    box('rear_bumper', (0.18, 2.3, 0.2), (-L / 2 - 0.05, 0, 0.6), hazard('tr_hazard'), bevel=0.02, parent=root)
    for x in TRAILER_AXLES:
        box('axle', (0.12, 2.2, 0.12), (x, 0, 0.5), dark, parent=root)
        box('hanger', (0.3, 0.12, 0.6), (x, -0.6, 0.85), dark, parent=root)
        box('hanger', (0.3, 0.12, 0.6), (x, 0.6, 0.85), dark, parent=root)
        for y in (-1.08, -0.74, 0.74, 1.08):
            wheels.append((wheel('w_trailer', 0.5, 0.3, '#c9ced6', (x, y, 0.5), parent=root, studs=8), 0.5))
    return root, wheels
