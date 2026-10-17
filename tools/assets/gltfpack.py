"""Tiny glTF repacker for Hollow Stars.

Reads .gltf/.glb files from the Quaternius packs, copies the parts we use into a few
combined .glb files, shrinks textures to WebP, and slims animations (drops constant
tracks, removes redundant keys, stores rotations as normalized int16).

No third-party glTF tooling needed: just numpy and Pillow.
"""
import base64
import io
import json
import math
import os
import struct

import numpy as np
from PIL import Image

CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
CTYPE_OF = {np.dtype(v): k for k, v in CTYPE.items()}


class Src:
    """One source glTF document."""

    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        if path.endswith('.glb'):
            data = open(path, 'rb').read()
            off = 12
            self.bins = []
            while off < len(data):
                ln, typ = struct.unpack('<II', data[off:off + 8])
                chunk = data[off + 8:off + 8 + ln]
                if typ == 0x4E4F534A:
                    self.j = json.loads(chunk)
                else:
                    self.bins.append(chunk)
                off += 8 + ln
            self.buffers = []
            for i, b in enumerate(self.j.get('buffers', [])):
                self.buffers.append(self.bins[0] if 'uri' not in b else self._uri(b['uri']))
        else:
            self.j = json.load(open(path))
            self.buffers = [self._uri(b['uri']) for b in self.j.get('buffers', [])]

    def _uri(self, uri):
        if uri.startswith('data:'):
            return base64.b64decode(uri.split(',', 1)[1])
        return open(os.path.join(self.dir, uri.replace('%20', ' ')), 'rb').read()

    def view_bytes(self, vi):
        v = self.j['bufferViews'][vi]
        b = self.buffers[v['buffer']]
        o = v.get('byteOffset', 0)
        return b[o:o + v['byteLength']], v.get('byteStride')

    def accessor(self, ai):
        a = self.j['accessors'][ai]
        n = NCOMP[a['type']]
        dt = np.dtype(CTYPE[a['componentType']])
        count = a['count']
        if 'bufferView' not in a:
            arr = np.zeros((count, n), dtype=dt)
        else:
            raw, stride = self.view_bytes(a['bufferView'])
            off = a.get('byteOffset', 0)
            es = dt.itemsize * n
            if stride and stride != es:
                arr = np.ndarray((count, n), dtype=dt, buffer=raw, offset=off, strides=(stride, dt.itemsize)).copy()
            else:
                arr = np.frombuffer(raw, dtype=dt, count=count * n, offset=off).reshape(count, n).copy()
        if 'sparse' in a:
            raise ValueError('sparse accessors not supported')
        return arr, a

    def image(self, ii):
        im = self.j['images'][ii]
        if 'bufferView' in im:
            raw, _ = self.view_bytes(im['bufferView'])
            return bytes(raw), im.get('name') or f'img{ii}'
        uri = im['uri']
        if uri.startswith('data:'):
            return base64.b64decode(uri.split(',', 1)[1]), im.get('name') or uri[:20]
        p = os.path.join(self.dir, uri.replace('%20', ' '))
        if not os.path.exists(p):
            # some packs reference "_png.png" copies that only exist without the suffix, or vice versa
            alt = [p.replace('_png.png', '.png'), p.replace('.png', '_png.png')]
            for up in ('..', '../..', '../../..'):
                alt += [os.path.join(self.dir, up, 'Textures', os.path.basename(p)), os.path.join(self.dir, up, 'Textures', os.path.basename(p).replace('_png.png', '.png'))]
            p = next((q for q in alt if os.path.exists(q)), p)
        return open(p, 'rb').read(), os.path.abspath(p)


class Pack:
    """The output .glb being assembled."""

    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'hollow-stars gltfpack'}, 'scene': 0, 'scenes': [{'nodes': []}],
                  'nodes': [], 'meshes': [], 'materials': [], 'textures': [], 'images': [], 'samplers': [], 'skins': [],
                  'animations': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
        self.bin = bytearray()
        self.img_cache = {}
        self.mat_cache = {}
        self.uses_webp = False
        self.quantize = True
        self.quantized = False

    # ------------------------------------------------------------ raw data
    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, typ, normalized=False, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        ct = CTYPE_OF[arr.dtype]
        count = arr.shape[0]
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': ct, 'count': int(count), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            flat = arr.reshape(count, -1)
            a['min'] = [float(x) for x in flat.min(axis=0)]
            a['max'] = [float(x) for x in flat.max(axis=0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def copy_accessor(self, src, ai, target=None):
        arr, a = src.accessor(ai)
        arr = arr.reshape(a['count'], NCOMP[a['type']])
        return self.accessor(arr, a['type'], a.get('normalized', False), target, minmax=('min' in a))

    # ------------------------------------------------------------ textures
    def image(self, src, ii, role, max_size):
        raw, key = src.image(ii)
        ck = (key, role, max_size)
        if ck in self.img_cache:
            return self.img_cache[ck]
        im = Image.open(io.BytesIO(raw))
        alpha = im.mode in ('RGBA', 'LA') and role == 'base' and np.asarray(im.convert('RGBA'))[:, :, 3].min() < 250
        im = im.convert('RGBA' if alpha else 'RGB')
        if max(im.size) > max_size:
            s = max_size / max(im.size)
            im = im.resize((max(4, round(im.size[0] * s)), max(4, round(im.size[1] * s))), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=82 if role != 'normal' else 88, method=5)
        self.uses_webp = True
        bv = self.view(out.getvalue())
        self.j['images'].append({'bufferView': bv, 'mimeType': 'image/webp', 'name': os.path.basename(str(key))})
        idx = len(self.j['images']) - 1
        self.j['textures'].append({'sampler': self.sampler(), 'source': idx, 'extensions': {'EXT_texture_webp': {'source': idx}}})
        t = len(self.j['textures']) - 1
        self.img_cache[ck] = t
        return t

    def sampler(self):
        if not self.j['samplers']:
            self.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
        return 0

    def material(self, src, mi, tex_size, keep=('base', 'normal', 'orm', 'emissive')):
        ck = (src.path, mi, tex_size)
        if ck in self.mat_cache:
            return self.mat_cache[ck]
        m = json.loads(json.dumps(src.j['materials'][mi]))
        pbr = m.get('pbrMetallicRoughness', {})

        def tex(info, role):
            if role not in keep:
                return None
            ti = info['index']
            img = src.j['textures'][ti].get('source')
            if img is None:
                img = src.j['textures'][ti].get('extensions', {}).get('EXT_texture_webp', {}).get('source')
            size = tex_size if role in ('base', 'emissive') else max(64, tex_size // 2)
            info = dict(info)
            info['index'] = self.image(src, img, role, size)
            info.pop('texCoord', None) if info.get('texCoord') == 0 else None
            return info

        if 'baseColorTexture' in pbr:
            t = tex(pbr['baseColorTexture'], 'base')
            if t: pbr['baseColorTexture'] = t
            else: pbr.pop('baseColorTexture')
        if 'metallicRoughnessTexture' in pbr:
            t = tex(pbr['metallicRoughnessTexture'], 'orm')
            if t: pbr['metallicRoughnessTexture'] = t
            else: pbr.pop('metallicRoughnessTexture')
        for k, role in (('normalTexture', 'normal'), ('occlusionTexture', 'orm'), ('emissiveTexture', 'emissive')):
            if k in m:
                t = tex(m[k], role)
                if t: m[k] = t
                else: m.pop(k)
        if pbr:
            m['pbrMetallicRoughness'] = pbr
        m.pop('extensions', None)
        self.j['materials'].append(m)
        self.mat_cache[ck] = len(self.j['materials']) - 1
        return self.mat_cache[ck]

    # ------------------------------------------------------------ meshes, nodes, skins
    def mesh(self, src, mi, tex_size, cache, keep_tex):
        if mi in cache['mesh']:
            return cache['mesh'][mi]
        m = src.j['meshes'][mi]
        raw = []
        for p in m['primitives']:
            attrs = {}
            for k, ai in p['attributes'].items():
                if (k.startswith('TEXCOORD_') and k != 'TEXCOORD_0') or (k.startswith('COLOR_') and k != 'COLOR_0') or k == 'TANGENT':
                    continue
                arr, a = src.accessor(ai)
                if a.get('normalized') or arr.dtype != np.float32 and k not in ('JOINTS_0',):
                    arr = arr.astype(np.float32) / (float(np.iinfo(arr.dtype).max) if arr.dtype.kind in 'iu' and a.get('normalized') else 1.0)
                attrs[k] = (arr, a['type'])
            idx = None
            if 'indices' in p:
                idx = src.accessor(p['indices'])[0].reshape(-1)
            mat = self.material(src, p['material'], tex_size, keep_tex) if 'material' in p else None
            raw.append((attrs, idx, mat, p.get('mode', 4)))
        prims, q = self.encode_prims(raw)
        self.j['meshes'].append({'name': m.get('name', ''), 'primitives': prims})
        cache['mesh'][mi] = (len(self.j['meshes']) - 1, q)
        return cache['mesh'][mi]

    def encode_prims(self, raw):
        """Quantize vertex data (KHR_mesh_quantization). Static meshes get int16 positions with a
        dequantizing node transform; skinned meshes keep float positions."""
        skinned = any('JOINTS_0' in a for a, _, _, _ in raw)
        q = None
        if not skinned and self.quantize:
            allp = np.concatenate([a['POSITION'][0] for a, _, _, _ in raw])
            lo, hi = allp.min(axis=0), allp.max(axis=0)
            ext = float(max((hi - lo).max(), 1e-6))
            q = {'offset': ((lo + hi) / 2).tolist(), 'scale': ext / 2}
        prims = []
        for attrs, idx, mat, mode in raw:
            out = {'attributes': {}, 'mode': mode}
            for k, (arr, typ) in attrs.items():
                if k == 'POSITION' and q:
                    v = (arr - np.array(q['offset'], np.float32)) / q['scale']
                    out['attributes'][k] = self.accessor(np.clip(np.round(v * 32767), -32767, 32767).astype(np.int16), 'VEC3', normalized=True, target=34962, minmax=True)
                elif k == 'NORMAL' and self.quantize:
                    n = arr / np.maximum(np.linalg.norm(arr, axis=1, keepdims=True), 1e-8)
                    out['attributes'][k] = self.accessor(np.round(n * 127).astype(np.int8), 'VEC3', normalized=True, target=34962)
                elif k == 'TEXCOORD_0' and self.quantize and arr.min() >= 0 and arr.max() <= 1:
                    out['attributes'][k] = self.accessor(np.round(arr * 65535).astype(np.uint16), 'VEC2', normalized=True, target=34962)
                elif k == 'WEIGHTS_0' and self.quantize:
                    w = arr / np.maximum(arr.sum(axis=1, keepdims=True), 1e-8)
                    wq = np.round(w * 255).astype(np.int32)
                    wq[np.arange(len(wq)), wq.argmax(axis=1)] += 255 - wq.sum(axis=1)
                    out['attributes'][k] = self.accessor(wq.astype(np.uint8), 'VEC4', normalized=True, target=34962)
                elif k == 'JOINTS_0':
                    out['attributes'][k] = self.accessor(arr.astype(np.uint8 if arr.max() < 256 else np.uint16), 'VEC4', target=34962)
                elif k == 'COLOR_0' and self.quantize:
                    out['attributes'][k] = self.accessor(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), typ, normalized=True, target=34962)
                else:
                    out['attributes'][k] = self.accessor(arr.astype(np.float32), typ, target=34962, minmax=(k == 'POSITION'))
            if idx is not None:
                out['indices'] = self.accessor(idx.astype(np.uint16 if idx.max() < 65535 else np.uint32).reshape(-1, 1), 'SCALAR', target=34963)
            if mat is not None:
                out['material'] = mat
            prims.append(out)
        if self.quantize:
            self.quantized = True
        return prims, q

    def node(self, src, ni, cache, tex_size, keep_tex, with_mesh=True):
        if ni in cache['node']:
            return cache['node'][ni]
        n = src.j['nodes'][ni]
        out = {k: n[k] for k in ('name', 'translation', 'rotation', 'scale', 'matrix') if k in n}
        idx = len(self.j['nodes'])
        self.j['nodes'].append(out)
        cache['node'][ni] = idx
        if 'children' in n:
            out['children'] = [self.node(src, c, cache, tex_size, keep_tex, with_mesh) for c in n['children']]
        if with_mesh and 'mesh' in n:
            mi, q = self.mesh(src, n['mesh'], tex_size, cache, keep_tex)
            if q:
                # the mesh sits in a child node whose transform undoes the quantization
                self.j['nodes'].append({'name': out.get('name', '') + '_q', 'mesh': mi, 'translation': q['offset'], 'scale': [q['scale']] * 3})
                out.setdefault('children', []).append(len(self.j['nodes']) - 1)
            else:
                out['mesh'] = mi
        if with_mesh and 'skin' in n:
            cache['pending_skin'].append((idx, n['skin']))
        return idx

    def finish_skins(self, src, cache):
        for idx, si in cache['pending_skin']:
            if si not in cache['skin']:
                s = src.j['skins'][si]
                o = {'joints': [cache['node'][j] for j in s['joints']]}
                if 'inverseBindMatrices' in s:
                    o['inverseBindMatrices'] = self.copy_accessor(src, s['inverseBindMatrices'])
                if 'skeleton' in s and s['skeleton'] in cache['node']:
                    o['skeleton'] = cache['node'][s['skeleton']]
                self.j['skins'].append(o)
                cache['skin'][si] = len(self.j['skins']) - 1
            self.j['nodes'][idx]['skin'] = cache['skin'][si]
        cache['pending_skin'] = []

    def add_model(self, path, name, tex_size=512, keep_tex=('base', 'normal', 'orm', 'emissive'), anims=None, anim_prefix='', with_mesh=True, optimize=True, retarget=False):
        """Add a whole scene from a source file under one named root node."""
        src = Src(path)
        cache = {'node': {}, 'mesh': {}, 'skin': {}, 'pending_skin': []}
        scene = src.j['scenes'][src.j.get('scene', 0)]
        kids = [self.node(src, r, cache, tex_size, keep_tex, with_mesh) for r in scene['nodes']]
        root = {'name': name, 'children': kids}
        self.j['nodes'].append(root)
        self.j['scene' + 's'][0]['nodes'].append(len(self.j['nodes']) - 1)
        self.finish_skins(src, cache)
        if anims is not None:
            self.add_anims(src, cache, anims, anim_prefix, optimize, retarget=retarget)
        return len(self.j['nodes']) - 1

    # ------------------------------------------------------------ animation
    def add_anims(self, src, cache, keep, prefix, optimize, drop_nodes=(), retarget=False):
        for a in src.j.get('animations', []):
            nm = a.get('name', '')
            if keep != '*' and nm not in keep:
                continue
            rename = keep[nm] if isinstance(keep, dict) else nm
            chans, samps = [], []
            for c in a['channels']:
                t = c['target']
                if t.get('node') not in cache['node']:
                    continue
                node = src.j['nodes'][t['node']]
                if any(d in node.get('name', '') for d in drop_nodes):
                    continue
                s = a['samplers'][c['sampler']]
                times, _ = src.accessor(s['input'])
                vals, va = src.accessor(s['output'])
                times = times.reshape(-1).astype(np.float32)
                if va.get('normalized'):
                    vals = vals.astype(np.float32) / float(np.iinfo(vals.dtype).max)
                vals = vals.astype(np.float32)
                interp = s.get('interpolation', 'LINEAR')
                path = t['path']
                if path == 'weights' or interp == 'CUBICSPLINE':
                    continue
                if optimize:
                    rest = node.get({'translation': 'translation', 'rotation': 'rotation', 'scale': 'scale'}[path])
                    rest = np.array(rest if rest else ([0, 0, 0] if path == 'translation' else [0, 0, 0, 1] if path == 'rotation' else [1, 1, 1]), np.float32)
                    if path == 'rotation':
                        # keep quaternions in one hemisphere so interpolation and comparison work
                        for i in range(1, len(vals)):
                            if np.dot(vals[i], vals[i - 1]) < 0:
                                vals[i] = -vals[i]
                    span = np.abs(vals - vals[0]).max() if len(vals) else 0
                    tol = 0.0015 if path == 'rotation' else 0.002
                    if retarget:
                        # clips shared across skeletons: rotations always play (the target's bind pose can
                        # differ from this file's rest pose); only the hips move, so bodies keep their proportions
                        if path == 'scale':
                            continue
                        if path == 'translation' and node.get('name') not in ('pelvis', 'root'):
                            continue
                        if span < tol:
                            times, vals = times[:1], vals[:1]
                        else:
                            times, vals = reduce_keys(times, vals, tol)
                    elif span < tol:
                        same_as_rest = np.abs(vals[0] - rest).max() < tol or (path == 'rotation' and np.abs(vals[0] + rest).max() < tol)
                        if same_as_rest:
                            continue  # the bind pose already has this value
                        times, vals = times[:1], vals[:1]
                    elif not retarget:
                        times, vals = reduce_keys(times, vals, tol)
                ti = self.accessor(times.reshape(-1, 1), 'SCALAR', minmax=True)
                if path == 'rotation' and optimize:
                    q = np.clip(np.round(vals * 32767), -32767, 32767).astype(np.int16)
                    vi = self.accessor(q, 'VEC4', normalized=True)
                else:
                    vi = self.accessor(vals, {'translation': 'VEC3', 'rotation': 'VEC4', 'scale': 'VEC3'}[path])
                samps.append({'input': ti, 'output': vi, 'interpolation': 'STEP' if len(times) == 1 else interp})
                chans.append({'sampler': len(samps) - 1, 'target': {'node': cache['node'][t['node']], 'path': path}})
            if chans:
                self.j['animations'].append({'name': prefix + rename, 'channels': chans, 'samplers': samps})

    # ------------------------------------------------------------ output
    def write(self, path):
        j = self.j
        for k in ('meshes', 'materials', 'textures', 'images', 'samplers', 'skins', 'animations'):
            if not j[k]:
                j.pop(k)
        used = []
        if self.uses_webp:
            used.append('EXT_texture_webp')
        if self.quantized:
            used.append('KHR_mesh_quantization')
            j['extensionsRequired'] = ['KHR_mesh_quantization']
        if used:
            j['extensionsUsed'] = used
        while len(self.bin) % 4:
            self.bin.append(0)
        j['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942))
            f.write(self.bin)
        return total


def reduce_keys(times, vals, tol):
    """Drop keys that linear interpolation between their neighbours reproduces within tol."""
    n = len(times)
    if n <= 2:
        return times, vals
    keep = [0]
    i = 0
    while i < n - 1:
        j = i + 2
        # extend the segment as long as every skipped key stays within tolerance
        while j < n:
            t0, t1 = times[i], times[j]
            ok = True
            for k in range(i + 1, j):
                f = (times[k] - t0) / (t1 - t0) if t1 > t0 else 0
                v = vals[i] + (vals[j] - vals[i]) * f
                if np.abs(v - vals[k]).max() > tol:
                    ok = False
                    break
            if not ok:
                break
            j += 1
        keep.append(j - 1)
        i = j - 1
    keep = sorted(set(keep))
    return times[keep], vals[keep]


# ------------------------------------------------------------ OBJ + MTL -> pack
def add_obj(pack, obj_path, name, scale=1.0):
    """Flat-coloured OBJ models (the Sci-Fi Gun Pack): one primitive per material."""
    d = os.path.dirname(obj_path)
    mats, cur = {}, None
    V, N, faces = [], [], {}
    mtl_file = None
    for line in open(obj_path, encoding='utf-8', errors='ignore'):
        p = line.split()
        if not p:
            continue
        if p[0] == 'mtllib':
            mtl_file = os.path.join(d, line.split(None, 1)[1].strip())
        elif p[0] == 'v':
            V.append([float(x) for x in p[1:4]])
        elif p[0] == 'vn':
            N.append([float(x) for x in p[1:4]])
        elif p[0] == 'usemtl':
            cur = p[1]
        elif p[0] == 'f':
            idx = []
            for c in p[1:]:
                s = c.split('/')
                vi = int(s[0]); ni = int(s[2]) if len(s) > 2 and s[2] else 0
                idx.append((vi - 1 if vi > 0 else len(V) + vi, (ni - 1 if ni > 0 else len(N) + ni) if ni else -1))
            for k in range(1, len(idx) - 1):
                faces.setdefault(cur, []).append((idx[0], idx[k], idx[k + 1]))
    if mtl_file and os.path.exists(mtl_file):
        m = None
        for line in open(mtl_file, encoding='utf-8', errors='ignore'):
            p = line.split()
            if not p:
                continue
            if p[0] == 'newmtl':
                m = p[1]; mats[m] = {'Kd': [0.8, 0.8, 0.8], 'Ke': [0, 0, 0]}
            elif p[0] in ('Kd', 'Ke') and m:
                mats[m][p[0]] = [float(x) for x in p[1:4]]
    V = np.array(V, np.float32) * scale
    N = np.array(N, np.float32) if N else None
    raw = []
    for mname, tris in faces.items():
        verts, lookup, idx = [], {}, []
        for tri in tris:
            a, b, c = (V[t[0]] for t in tri)
            fn = np.cross(b - a, c - a); l = np.linalg.norm(fn) or 1; fn = fn / l
            for t in tri:
                nv = N[t[1]] if (N is not None and t[1] >= 0) else fn
                key = (t[0], tuple(np.round(nv, 3)))
                if key not in lookup:
                    lookup[key] = len(verts); verts.append((V[t[0]], nv))
                idx.append(lookup[key])
        pos = np.array([v[0] for v in verts], np.float32); nor = np.array([v[1] for v in verts], np.float32)
        mt = mats.get(mname, {'Kd': [0.8, 0.8, 0.8], 'Ke': [0, 0, 0]})
        col = [srgb_to_lin(x) for x in mt['Kd']]
        mat = {'name': mname, 'pbrMetallicRoughness': {'baseColorFactor': col + [1], 'metallicFactor': 0.25, 'roughnessFactor': 0.55}}
        if max(mt['Ke']) > 0.01:
            mat['emissiveFactor'] = [min(1, x) for x in mt['Ke']]
        pack.j['materials'].append(mat)
        raw.append(({'POSITION': (pos, 'VEC3'), 'NORMAL': (nor, 'VEC3')}, np.array(idx), len(pack.j['materials']) - 1, 4))
    prims, q = pack.encode_prims(raw)
    pack.j['meshes'].append({'name': name, 'primitives': prims})
    node = {'name': name, 'children': []}
    pack.j['nodes'].append({'name': name + '_q', 'mesh': len(pack.j['meshes']) - 1, 'translation': q['offset'], 'scale': [q['scale']] * 3} if q else {'name': name + '_q', 'mesh': len(pack.j['meshes']) - 1})
    node['children'].append(len(pack.j['nodes']) - 1)
    pack.j['nodes'].append(node)
    pack.j['scenes'][0]['nodes'].append(len(pack.j['nodes']) - 1)


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
