function isCarWash() {
  return document.getElementById("projectLink")?.value?.includes("/templates/carwash/");
}

function roundRect(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();}
function cover(ctx,img,x,y,w,h){const ir=img.width/img.height,br=w/h;let sx=0,sy=0,sw=img.width,sh=img.height;if(ir>br){sw=img.height*br;sx=(img.width-sw)/2;}else{sh=img.width/br;sy=(img.height-sh)/2;}ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);}

function activateCarWashVisual() {
  if (!isCarWash()) return;
  const oldCanvas=document.getElementById("marketingCanvas"); if(!oldCanvas)return;
  const canvas=oldCanvas.cloneNode(true); oldCanvas.replaceWith(canvas); const ctx=canvas.getContext("2d");
  const format=document.getElementById("creativeFormat"), headline=document.getElementById("creativeHeadline"), offer=document.getElementById("creativeOffer"), cta=document.getElementById("creativeCta"), imageInput=document.getElementById("creativeImage"), status=document.getElementById("creativeStatus");
  let image=null;
  const business=()=>document.getElementById("businessName")?.value?.trim()||document.getElementById("userName")?.innerText?.trim()||"مزود الخدمة";
  headline.value="سيارتك نظيفة من غير ما تتحرك من مكانك";

  function draw(){const story=format.value==="story",w=1080,h=story?1920:1080;canvas.width=w;canvas.height=h;const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,"#eff6ff");g.addColorStop(1,"#dbeafe");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);const p=story?82:68;ctx.direction="rtl";ctx.textAlign="right";roundRect(ctx,p,story?90:55,w-p*2,story?130:105,30,"#ffffff");ctx.fillStyle="#0f2942";ctx.font=`900 ${story?47:38}px Tahoma,Arial`;ctx.fillText(business(),w-p-34,story?168:120);ctx.fillStyle="#526575";ctx.font=`600 ${story?25:20}px Tahoma,Arial`;ctx.fillText("غسيل سيارات خارجي",w-p-34,story?202:148);
  ctx.fillStyle="#0f2942";ctx.font=`900 ${story?70:56}px Tahoma,Arial`;ctx.textAlign="center";const title=headline.value.trim()||"سيارتك نظيفة من غير ما تتحرك من مكانك";ctx.fillText(title,w/2,story?360:255);
  if(offer.value.trim()){roundRect(ctx,w*.18,story?410:300,w*.64,story?72:58,22,"#2563eb");ctx.fillStyle="#fff";ctx.font=`800 ${story?36:29}px Tahoma,Arial`;ctx.fillText(offer.value.trim(),w/2,story?460:340);}
  const x=story?140:230,y=story?610:410,iw=story?800:620,ih=story?650:390;ctx.save();ctx.shadowColor="rgba(15,23,42,.18)";ctx.shadowBlur=30;roundRect(ctx,x-18,y-18,iw+36,ih+36,48,"#fff");ctx.restore();if(image){ctx.save();ctx.beginPath();ctx.roundRect(x,y,iw,ih,34);ctx.clip();cover(ctx,image,x,y,iw,ih);ctx.restore();}else{roundRect(ctx,x,y,iw,ih,34,"#f8fafc");ctx.fillStyle="#64748b";ctx.font=`700 ${story?30:24}px Tahoma,Arial`;ctx.fillText("ارفع صورة السيارة أو الخدمة",w/2,y+ih/2);}
  const by=y+ih+(story?70:45);["غسيل خارجي","في مكان سيارتك","مواعيد مرنة"].forEach((t,i)=>{const cw=story?260:245,gap=18,total=cw*3+gap*2,sx=(w-total)/2,cx=sx+i*(cw+gap);roundRect(ctx,cx,by,cw,story?90:76,24,"#fff");ctx.fillStyle="#0f2942";ctx.font=`700 ${story?25:21}px Tahoma,Arial`;ctx.fillText(t,cx+cw/2,by+(story?56:48));});
  const cy=h-(story?270:135),cw=story?700:620,ch=story?118:86;roundRect(ctx,(w-cw)/2,cy,cw,ch,999,"#2563eb");ctx.fillStyle="#fff";ctx.font=`900 ${story?44:35}px Tahoma,Arial`;ctx.fillText(cta.value.trim()||"احجز الآن",w/2,cy+(story?75:56));ctx.fillStyle="#526575";ctx.font=`700 ${story?23:18}px Tahoma,Arial`;ctx.fillText("اضغط على رابط الحجز المرفق مع الإعلان",w/2,cy+ch+(story?46:34));status.innerText="تم تحديث تصميم غسيل السيارات ✅";}

  imageInput.addEventListener("change",()=>{const f=imageInput.files?.[0];if(!f){image=null;draw();return;}const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{image=im;draw();};im.src=r.result;};r.readAsDataURL(f);});
  [format,headline,offer,cta].forEach(el=>{el.addEventListener("change",draw);el.addEventListener("input",draw);});document.getElementById("renderCreativeBtn")?.addEventListener("click",draw);draw();
}

setTimeout(activateCarWashVisual, 1600);
