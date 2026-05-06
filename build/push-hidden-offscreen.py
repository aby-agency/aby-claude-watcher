#!/usr/bin/env python3
"""
Move hidden files inside a DMG off-screen.

electron-builder doesn't expose icon-position controls for files it manages
internally (.background.tiff, .VolumeIcon.icns, .fseventsd, .DS_Store, etc.).
When a user toggles "show hidden files" (Cmd+Shift+.) in Finder, these files
end up rendered on top of the visible layout. This script edits the DMG's
.DS_Store to push them to coordinates outside the visible window.

Flow: DMG (read-only) → UDRW copy → mount → edit .DS_Store → unmount →
re-compress to UDZO → replace original.

Usage: python3 push-hidden-offscreen.py path/to/file.dmg
"""

import os
import shutil
import subprocess
import sys
import tempfile

from ds_store import DSStore

HIDDEN_FILES = [
    '.background.tiff',
    '.VolumeIcon.icns',
    '.fseventsd',
    '.Trashes',
]
OFFSCREEN_POS = (2000, 2000)


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def find_mount(attach_output):
    for line in attach_output.splitlines():
        if '/Volumes/' in line:
            return line.split('\t')[-1].strip()
    return None


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: push-hidden-offscreen.py <dmg>")

    dmg = os.path.abspath(sys.argv[1])
    if not os.path.isfile(dmg):
        sys.exit(f"not found: {dmg}")

    tmpdir = tempfile.mkdtemp(prefix='dmg-rehide-')
    rw = os.path.join(tmpdir, 'rw.dmg')
    mount = None

    try:
        print(f"  → converting to read-write")
        run(['hdiutil', 'convert', dmg, '-format', 'UDRW', '-ov', '-o', rw])

        print(f"  → mounting")
        out = run(['hdiutil', 'attach', '-nobrowse', '-noautoopen', rw])
        mount = find_mount(out)
        if not mount or not os.path.isdir(mount):
            sys.exit("could not determine mount point")

        ds_store_path = os.path.join(mount, '.DS_Store')
        print(f"  → editing .DS_Store at {ds_store_path}")
        with DSStore.open(ds_store_path, 'r+') as d:
            for f in HIDDEN_FILES:
                d[f]['Iloc'] = OFFSCREEN_POS

        print(f"  → unmounting")
        run(['hdiutil', 'detach', mount, '-force'])
        mount = None

        # hdiutil convert appends .dmg automatically when -o lacks it,
        # so we point it at a path inside tmpdir and move it back ourselves.
        out_dmg = os.path.join(tmpdir, 'repack.dmg')
        print(f"  → recompressing to UDZO")
        run(['hdiutil', 'convert', rw, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', '-o', out_dmg])

        os.replace(out_dmg, dmg)
        print(f"  ✓ {os.path.basename(dmg)}")

    finally:
        if mount:
            subprocess.run(['hdiutil', 'detach', mount, '-force'], capture_output=True)
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == '__main__':
    main()
