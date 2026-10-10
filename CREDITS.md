# Third-party 3D models

The website's truck, trailer and shipping containers are built from these Sketchfab models. Each model is used under its Creative Commons licence. They were changed for this site: brand badges and the author's number plate were removed, the paint was recoloured to the Balar livery, the trailer mesh was simplified, and the models were rescaled and assembled. The prepared files are in `assets/models/`, and `blender/prep_models.py` holds the preparation steps.

| Used for | Model | Author | Licence |
|---|---|---|---|
| Tractor unit (cab) | [MAN TGX 2010 V8 – High-Detail Semi-Truck](https://sketchfab.com/3d-models/man-tgx-2010-v8-high-detail-semi-truck-34ce748d9a4b4de7b035cfe5cb97f5d1) | [DevPoly3D](https://sketchfab.com/DevPoly3D) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| Container trailer chassis | [Container Trailer Chassis](https://sketchfab.com/3d-models/container-trailer-chassis-4179e400ef464b958bcf8416e11f87df) | [fabio.ardito](https://sketchfab.com/fabio.ardito) | [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) |
| 40 ft shipping containers | [Container Pack](https://sketchfab.com/3d-models/container-pack-0d416a9bcfc14978aa50e80281dfe9a5) | [drcrazzie](https://sketchfab.com/drcrazzie) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

The changed trailer (part of `assets/models/truck.glb`) is shared under the same CC BY-SA 4.0 licence, as that licence requires. "MAN" is a trademark of its owner. The site shows no MAN branding, and Balar Overseas has no connection with that company.

## Reach stacker

The reach stacker is the [Reach Stacker](https://www.meshy.ai/3d-models/reach-stacker-01a03643-ad8b-7c05-908b-2c90547748a3) model by oguz.backovski on Meshy, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No credit is required; it is listed here for the record. For this site the maker's lettering was painted out of the texture and the paint recoloured (body teal-blue, boom charcoal; the texture's own shading is kept). The mesh was also rescaled, evenly simplified and cut into moving parts. The model's spreader is not used: the page draws a slim one of its own. `blender/prep_stacker.py` holds these steps, and the result is `assets/models/stacker.glb`.
