import soundfile as sf, numpy as np, os
SR=44100
def load(n):
    d,_=sf.read(f'/home/user/sfx-src/wav/{n}.wav',dtype='float32'); return d
groups={
 '_combat':['swing','hit','crit','miss','bossHit','slam','bossSlam','boom','crate'],
 '_creatures':['enemyHurt','enemyDie','bite','hurt','playerHurt','necroCast','summon','charge','phase','telegraph','heartbeat'],
 '_magic':['magic','magicHit','reveal','levelup'],
 '_loot':['gold','loot','chest','bounty','comboUp','buy','sell','potion'],
 '_ui':['ui','error','door','locked','unlock','stairs','dodge'],
}
os.makedirs('/home/user/sfx',exist_ok=True)
for g,names in groups.items():
    out=[np.zeros(int(SR*0.25),dtype=np.float32)]
    for n in names:
        d=load(n); out.append(d); out.append(np.zeros(int(SR*0.35),dtype=np.float32))
    x=np.concatenate(out)
    sf.write(f'/home/user/sfx/{g}.wav',x,SR,subtype='PCM_16')
    print(f'{g:11s} {len(names):2d} effects {len(x)/SR:6.1f}s')
allx=[np.zeros(int(SR*0.2),dtype=np.float32)]
for n in ['hit','crit','enemyDie','magic','levelup','gold','door','ui','bossSlam','bite']:
    allx.append(load(n)); allx.append(np.zeros(int(SR*0.3),dtype=np.float32))
sf.write('/home/user/sfx/_showcase.wav',np.concatenate(allx),SR,subtype='PCM_16')
print('showcase', len(np.concatenate(allx))/SR,'s')
