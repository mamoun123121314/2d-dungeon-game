import soundfile as sf, numpy as np, json, os
SRC='/home/user/sfx-src/all/'; OUT='/home/user/sfx-src/wav/'; os.makedirs(OUT,exist_ok=True)
OS=json.load(open('/home/user/sfx-src/onset.json'))
SR=44100
_cache={}
def load(name):
    if name in _cache: return _cache[name]
    d,sr=sf.read(SRC+name+'.ogg')
    if d.ndim>1: d=d.mean(1)
    d=d.astype(np.float64)
    if sr!=SR:
        n=int(len(d)*SR/sr); x=np.arange(n)*sr/SR
        i=np.floor(x).astype(int); f=x-i; i2=np.minimum(i+1,len(d)-1)
        d=d[i]*(1-f)+d[i2]*f
    m=OS.get(name)
    if m: d=d[int(m['onset']*SR):int(m['tail']*SR)]
    _cache[name]=d
    return d
def resample_len(d,n):
    if len(d)==n: return d
    x=np.linspace(0,1,n); xi=np.linspace(0,1,len(d))
    return np.interp(x,xi,d)
def pitch(d,f):
    if abs(f-1)<1e-6: return d
    return resample_len(d,max(8,int(len(d)/f)))
def at(dur,name,off=0,f=1.0,g=1.0,decay=None):
    y=np.zeros(int(dur*SR))
    s=pitch(load(name),f)
    if decay:
        t=np.arange(len(s))/SR; s=s*np.exp(-t/decay)
    i=int(off*SR)
    if i>=len(y): return y
    n=min(len(s),len(y)-i); y[i:i+n]+=s[:n]*g
    return y
def filt(x,parts):
    N=513; n=len(x); nfft=1
    while nfft < n+512: nfft*=2
    X=np.fft.rfft(x,nfft)
    w=np.linspace(0,np.pi,nfft//2+1); f=w/(2*np.pi)*SR
    H=np.ones_like(f)
    for kind,freq,db,q in parts:
        A=10**(db/20)
        if kind=='lp':   H=H*(1/np.sqrt(1+(f/max(freq,1))**(2*max(q,0.5)*2)))
        elif kind=='hp': H=H*(1/np.sqrt(1+(max(freq,1)/np.maximum(f,1))**(2*max(q,0.5)*2)))
        elif kind=='pk':
            c=np.log2(np.maximum(f,20)/max(freq,1)); H=H*(1+(A-1)*np.exp(-0.5*(c/0.55)**2))
    return np.fft.irfft(X*H,nfft)[:n]
def room(x,tail=0.5,wet=0.28):
    n=int(tail*SR); t=np.arange(n)/SR
    rng=np.random.default_rng(7); ir=rng.normal(0,1,n)*np.exp(-t/(tail*0.34))
    L=len(x)+n; nfft=1
    while nfft<L: nfft*=2
    w=np.fft.rfft(ir,nfft); X=np.fft.rfft(x,nfft)
    rev=np.fft.irfft(X*w,nfft)[:L]
    rev/=(np.max(np.abs(rev))+1e-9)
    out=np.zeros(L); out[:len(x)]=x*(1-wet*0.5); out+=rev*wet*0.5
    return out
def fade(x,ms=6):
    n=int(SR*ms/1000)
    if n*2<len(x):
        x[:n]*=np.linspace(0,1,n); x[-n:]*=np.linspace(1,0,n)
    return x
def norm(x,peak=0.86):
    """Loudness-normalise, then guard the peak.
    Peak-only normalisation made quiet effects (a key turning in a lock) far
    softer than a sword hit, so the mix felt lopsided. Short transients read as
    loud roughly by RMS with the peak kept inside a ceiling, so aim the RMS at a
    target and pull the gain back only if the peak would clip."""
    m=np.max(np.abs(x))
    if m<=0: return x
    x=x/m*peak
    rms=np.sqrt(np.mean(x**2))
    target=0.105
    if rms>1e-6:
        g=target/rms
        g=min(g, 0.94/np.max(np.abs(x)))
        x=x*g
    return x
