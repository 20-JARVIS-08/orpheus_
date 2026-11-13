#!/usr/bin/env python3
"""Builds the Android project for ORPHEUS (everything except the final gradle step).

Needs: Node, and `npm install --no-save @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7`.
Run from the repo root:  python scripts/android-prepare.py
Then:  cd android && ./gradlew assembleDebug   (APK: android/app/build/outputs/apk/debug/)
"""
import glob, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
WIN = os.name == 'nt'


def run(*a):
    subprocess.run(list(a), check=True, shell=WIN)


# 0) AI vocal removal files (models + onnxruntime-web engine, ~120 MB): downloaded once, then bundled into the APK
AI_NEEDED = ['models/vocal.onnx', 'models/vocal-fast.onnx', 'vendor/ort/ort.min.js',
             'vendor/ort/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort/ort-wasm-simd-threaded.jsep.wasm']
if not all(os.path.exists(f) for f in AI_NEEDED):
    run('node', 'setup-ai.js')

# 1) web files -> www/ (no service worker or Windows-only files in the app)
shutil.rmtree('www', ignore_errors=True)
os.makedirs('www')
for f in ('index.html', 'manifest.webmanifest', 'vocal-worklet.js', 'sep-worker.js', 'live.js'):
    shutil.copy(f, 'www')
for d in ('fonts', 'icons', 'lib', 'vendor', 'models'):
    shutil.copytree(d, os.path.join('www', d))

# 2) android project
if not os.path.isdir('android'):
    run('npx', 'cap', 'add', 'android')
run('npx', 'cap', 'sync', 'android')

# 3) native plugin + MainActivity
java_dir = os.path.join('android', 'app', 'src', 'main', 'java', 'com', 'orpheus', 'audio')
os.makedirs(java_dir, exist_ok=True)
for f in glob.glob('android/app/src/main/java/**/MainActivity.java', recursive=True):
    if os.path.abspath(os.path.dirname(f)) != os.path.abspath(java_dir):
        os.remove(f)
for f in ('MediaLibraryPlugin.java', 'MainActivity.java'):
    shutil.copy(os.path.join('android-overlay', f), java_dir)

# 4) permissions
mf = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')
x = open(mf, encoding='utf-8').read()
perms = [
    '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
]
add = ''.join('    ' + p + '\n' for p in perms if p.split('"')[1] not in x)
if add:
    x = x.replace('</manifest>', add + '</manifest>')
    open(mf, 'w', encoding='utf-8').write(x)

# 4b) more memory for Gradle: the AI models make the APK big
gp = os.path.join('android', 'gradle.properties')
if os.path.exists(gp):
    g = open(gp, encoding='utf-8').read()
    g2 = re.sub(r'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8', g)
    if g2 == g and 'org.gradle.jvmargs' not in g:
        g2 = g.rstrip('\n') + '\norg.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8\n'
    open(gp, 'w', encoding='utf-8').write(g2)

# 5) launcher icons (adaptive: maskable icon on its own background colour)
try:
    from PIL import Image
    res = os.path.join('android', 'app', 'src', 'main', 'res')
    mask = Image.open('icons/icon-maskable-512.png').convert('RGBA')
    full = Image.open('icons/icon-512.png').convert('RGBA')
    bg = mask.getpixel((2, 2))
    sizes = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
    for d, (leg, fg) in sizes.items():
        p = os.path.join(res, 'mipmap-' + d)
        os.makedirs(p, exist_ok=True)
        full.resize((leg, leg), Image.LANCZOS).save(os.path.join(p, 'ic_launcher.png'))
        full.resize((leg, leg), Image.LANCZOS).save(os.path.join(p, 'ic_launcher_round.png'))
        mask.resize((fg, fg), Image.LANCZOS).save(os.path.join(p, 'ic_launcher_foreground.png'))
    os.makedirs(os.path.join(res, 'values'), exist_ok=True)
    open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w').write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % bg[:3])
except Exception as e:
    print('icon step skipped:', e, file=sys.stderr)

print('\nAndroid project ready. Build the APK with:\n  cd android && ./gradlew assembleDebug')
