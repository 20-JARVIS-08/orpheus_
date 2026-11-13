import numpy as np, potrace, json
from PIL import Image
im=Image.open('lyre-source.png').convert('L')
a=np.array(im)<128
# work only in the central region (the picture has thin artifacts on its outer edge)
X0,X1,Y0,Y1=120,860,100,920
a2=np.zeros_like(a);a2[Y0:Y1,X0:X1]=a[Y0:Y1,X0:X1];a=a2
ys,xs=np.where(a);bx0,bx1,by0,by1=xs.min(),xs.max(),ys.min(),ys.max();print('lyre bbox',bx0,bx1,by0,by1)
strings=[(410,436),(478,503),(545,570)]
# body top edge just beside each string, then straight-line across the string -> removes the strings from the body
def top_at(x): 
    col=np.where(a[400:,x])[0];return 400+col[0]
prof={}
bounds=[(405,439),(474,508),(541,575)]
for (l,r) in bounds:
    yl,yr=top_at(l),top_at(r)
    for x in range(l+1,r):
        prof[x]=round(yl+(yr-yl)*(x-l)/(r-l))
    print('profile',l,yl,r,yr)
body=a.copy()
for x,yp in prof.items(): body[230:yp,x]=False
# string geometry (centre x, top y, where it enters the body)
info=[]
for (l,r) in strings:
    cx=(l+r+1)/2;top=int(np.where(a[:,int(cx)])[0][0]);ent=prof[int(cx)]
    info.append(dict(x=float(cx),top=int(top),bot=int(ent+14),w=int(r-l+1)));print(info[-1])
# smooth trace: 3x upscale before thresholding gives clean curves
S=3
big=Image.fromarray((body*255).astype(np.uint8)).resize((body.shape[1]*S,body.shape[0]*S),Image.LANCZOS).filter(__import__('PIL.ImageFilter',fromlist=['x']).GaussianBlur(4))
bb=np.array(big)>127
bm=potrace.Bitmap(~bb)
pl=bm.trace(turdsize=3000,turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,alphamax=1.1,opticurve=True,opttolerance=4.0)
PAD=10;ox,oy=int(bx0)-PAD,int(by0)-PAD
def P(p):return f"{(p.x/S-ox):.1f} {(p.y/S-oy):.1f}"
d=[]
for c in pl:
    d.append("M"+P(c.start_point))
    for s in c.segments:
        if s.is_corner:d.append("L"+P(s.c)+"L"+P(s.end_point))
        else:d.append("C"+P(s.c1)+" "+P(s.c2)+" "+P(s.end_point))
    d.append("Z")
D="".join(d);print('paths',len(pl),'d length',len(D))
for i in info:i['x']-=ox;i['top']-=oy;i['bot']-=oy
out=dict(w=int(bx1-bx0+1+2*PAD),h=int(by1-by0+1+2*PAD),d=D,strings=info)
json.dump(out,open('lyre.json','w'));print(out['w'],out['h'])
# preview
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {out["w"]} {out["h"]}" width="{out["w"]}" height="{out["h"]}"><rect width="100%" height="100%" fill="#fff"/><path d="{D}"/>'+''.join(f'<line x1="{i["x"]}" x2="{i["x"]}" y1="{i["top"]}" y2="{i["bot"]}" stroke="#d00" stroke-width="{i["w"]}" stroke-opacity=".5"/>' for i in info)+'</svg>'
open('preview.svg','w').write(svg)
