import soundfile as sf, numpy as np, glob, json
rows={}
for f in sorted(glob.glob('/home/user/sfx-src/all/*.ogg')):
    d,sr=sf.read(f)
    if d.ndim>1: d=d.mean(1)
    d=d.astype(np.float32)
    win=int(sr*0.01)
    if len(d)<win: continue
    env=np.array([np.sqrt(np.mean(d[i:i+win]**2)) for i in range(0,len(d)-win,win)])
    pk=env.max()
    idx=int(np.argmax(env>pk*0.15))
    onset=max(0.0, idx*0.01 - 0.02)
    thr=pk*0.1
    last=len(env)-1-int(np.argmax(env[::-1]>thr))
    end=min(len(d)/sr, last*0.01+0.05)
    rows[f.split('/')[-1][:-4]]={'dur':round(len(d)/sr,2),'onset':round(onset,2),'tail':round(end,2)}
json.dump(rows,open('/home/user/sfx-src/onset.json','w'),indent=1)
print(len(rows),'measured')
