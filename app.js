import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,setPersistence,browserLocalPersistence,browserSessionPersistence,onAuthStateChanged,signOut,EmailAuthProvider,reauthenticateWithCredential} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {getFirestore,doc,setDoc,getDoc,collection,addDoc,getDocs,deleteDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {cloudinaryConfig} from './cloudinary-config.js';
const $=id=>document.getElementById(id), show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
let auth,db,user=null,posts=[],profiles={},period='all',page='home',profileUid=null,cardInfo=null,creatingAccount=false,isAdmin=false,adminMode=false,profileSort='new';
const categories=['混合編成','リレーラッシュ編成','その他'];
const categoryLabel=cat=>cat==='混合編成'?'コンボ編成':cat;
const notify=(s)=>{const e=$('notice');e.textContent=s;show('notice');setTimeout(()=>show('notice',false),4500)};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateStr=d=>new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
const dateOf=p=>p.createdAt?.toDate?.()||new Date(0);
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const imageUrl=u=>u&&/^https:\/\//.test(u)?u:'';
// Avatar borders are based on the owner's completions in the current calendar month.
const monthlyFinishCount=uid=>uid?posts.filter(p=>p.uid===uid&&monthKey(dateOf(p))===monthKey(new Date())).length:0;
const avatar=(p,uid,big=false)=>{
 const count=monthlyFinishCount(uid);
 const tier=count>=30?'tier-30':count>=20?'tier-20':count>=10?'tier-10':'';
 const src=safe(imageUrl(p?.avatar)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%234a6590%22/%3E%3Ctext x=%2240%22 y=%2255%22 font-size=%2245%22 text-anchor=%22middle%22%3E👤%3C/text%3E%3C/svg%3E');
 return `<span class="avatar-frame ${big?'big':''} ${tier}"><img class="avatar ${big?'big':''}" src="${src}" alt="アイコン"></span>`;
};
function busy(btn,yes){btn.disabled=yes;}
async function compress(file,max=1400){const img=await createImageBitmap(file);const scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close();return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('画像変換に失敗')),'image/jpeg',.82));}
async function uploadImage(file,path){
  if(!file || !file.type.startsWith('image/'))throw Error('画像ファイルを選択してください');
  const {cloudName,uploadPreset}=cloudinaryConfig;
  if(!cloudName||!uploadPreset)throw Error('Cloudinaryの設定がありません');
  const blob=await compress(file);
  const data=new FormData();
  data.append('file',blob,'image.jpg');
  data.append('upload_preset',uploadPreset);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,{method:'POST',body:data});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.secure_url)throw Error(result.error?.message||`Cloudinaryへの画像アップロードに失敗しました (${response.status})`);
  if(!result.secure_url.startsWith(`https://res.cloudinary.com/${cloudName}/`))throw Error('画像URLが正しくありません');
  return result.secure_url;
}
const rememberedIdKey='pokeroad-ranking-account-id';
const rememberedId=()=>localStorage.getItem(rememberedIdKey)||'';
function refreshLoginId(){/* ID is internal; use saved account on this device. */}
const idEmail=id=>`${id.toLowerCase()}@ranking-account.invalid`;
function accountId(){return 'p'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('')}
async function persistence(){await setPersistence(auth,$('stay').checked?browserLocalPersistence:browserSessionPersistence)}
async function createAccount(){
 const b=$('createBtn'),name=$('newName').value.trim(),pass=$('newPassword').value,file=$('newAvatar').files[0];
 if(!name)return notify('名前を入力してください');
 if(!/^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z0-9]{8,}$/.test(pass))return notify('パスワードは英字と数字を含む8文字以上にしてください');
 busy(b,true);creatingAccount=true;
 try{
  await setPersistence(auth,browserSessionPersistence);
  const id=accountId();
  const cred=await createUserWithEmailAndPassword(auth,idEmail(id),pass);
  // Save the account mapping immediately so logout/login works even if the avatar upload fails.
  localStorage.setItem(rememberedIdKey,id);
  let url='';
  if(file){try{url=await uploadImage(file,`avatars/${cred.user.uid}/${Date.now()}.jpg`)}catch(e){notify('アイコンのアップロードに失敗しました。設定から後で変更できます')}}
  await setDoc(doc(db,'profiles',cred.user.uid),{name,avatar:url,accountId:id,createdAt:serverTimestamp()});
  profiles[cred.user.uid]={name,avatar:url,accountId:id};
  cardInfo={id,pass};
  $('cardPassword').textContent=pass;
  try{
    if(typeof QRCode!=='function')throw Error('QRコード作成ライブラリを読み込めませんでした。通信環境を確認して再読み込みしてください');
    const target=$('qrGenerator');target.innerHTML='';
    new QRCode(target,{text:JSON.stringify({type:'finish-ranking-login',id,pass}),width:300,height:300,correctLevel:QRCode.CorrectLevel.M});
    const qrCanvas=target.querySelector('canvas'),qrImg=target.querySelector('img');
    const dataUrl=qrCanvas?.toDataURL('image/png')||qrImg?.src;
    if(!dataUrl?.startsWith('data:image/'))throw Error('QRコードの画像生成に失敗しました');
    $('cardQr').src=dataUrl;show('cardQr',true);
  }catch(e){show('cardQr',false);notify('ログインカードのQRコード生成に失敗：'+errorText(e))}
  show('auth',false);show('app',false);show('nav',false);show('cardSection',true);
  await saveCard();
 }catch(e){notify('作成に失敗しました：'+errorText(e));creatingAccount=false}
 finally{busy(b,false)}
}
function errorText(e){return ({'auth/email-already-in-use':'アカウントIDが重複しました','auth/invalid-credential':'ログイン情報が違います','auth/weak-password':'パスワードが短すぎます','permission-denied':'Firebaseのアクセスルールを確認してください','storage/unauthorized':'Storageのアクセスルールを確認してください'})[e.code]||e.message||'不明なエラー'}
async function login(id,pass){
 if(!pass)return notify('パスワードを入力してください');
 const account=id||rememberedId();
 if(!account)return notify('この端末にアカウント情報がありません。初回は保存したログインカード画像からログインしてください');
 try{
  await persistence();
  const cred=await signInWithEmailAndPassword(auth,idEmail(account.trim()),pass);
  localStorage.setItem(rememberedIdKey,account.trim());
  user=cred.user;cardInfo=null;creatingAccount=false;
  show('cardSection',false);show('auth',false);show('app',true);show('nav',true);
  try{await load()}catch(e){notify('ログインしましたがデータ取得に失敗：'+errorText(e))}
  go('home');
 }catch(e){notify('ログインできません：'+errorText(e))}
}
async function loginFromImage(file){try{if(typeof jsQR!=='function')throw Error('QRコード読み取り機能を読み込めませんでした。再読み込みしてください');const bitmap=await createImageBitmap(file),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();const data=c.getContext('2d').getImageData(0,0,c.width,c.height),code=jsQR(data.data,c.width,c.height);if(!code)throw Error('QRコードが見つかりません。画像全体が写っているか確認してください');const obj=JSON.parse(code.data);if(obj.type!=='finish-ranking-login'||!obj.id||!obj.pass)throw Error('このサイトのログインカードではありません');await login(obj.id,obj.pass)}catch(e){notify('画像ログインに失敗：'+errorText(e))}}
async function saveCard(){
  try{
    if(!cardInfo)throw Error('ログインカードの情報がありません');
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=840;canvas.height=1020;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,840,1020);
    ctx.fillStyle='#152038';ctx.textAlign='center';
    ctx.font='bold 38px system-ui,sans-serif';ctx.fillText('ポケロードランキング',420,85);
    ctx.font='26px system-ui,sans-serif';ctx.fillText('ログインカード',420,133);
    ctx.font='20px system-ui,sans-serif';ctx.fillText('ログイン情報を含む大切なカードです',420,225);
    ctx.font='22px system-ui,sans-serif';ctx.fillText('パスワード',420,308);
    ctx.font='bold 28px monospace';ctx.fillText(cardInfo.pass,420,350);
    if(!$('cardQr').src.startsWith('data:image/')||$('cardQr').classList.contains('hidden'))throw Error('QRコードがありません。ページを再読み込みしてからカードを作成してください');
    {const qr=new Image();qr.src=$('cardQr').src;await qr.decode();ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,220,390,400,400);ctx.imageSmoothingEnabled=true;}
    ctx.font='20px system-ui,sans-serif';ctx.fillText('QRコードからログインできます',420,845);
    ctx.fillStyle='#b42336';ctx.font='bold 21px system-ui,sans-serif';ctx.fillText('このカードを他人に共有しないでください',420,915);
    const url=canvas.toDataURL('image/png');
    const wrap=document.createElement('div');wrap.className='saved-preview';
    const img=document.createElement('img');img.src=url;img.alt='ログインカード（スマホでは長押しで保存）';
    img.style.cssText='display:block;width:100%;max-width:340px;margin:14px auto;border-radius:12px';
    wrap.append(img);$('cardSection').querySelector('.saved-preview')?.remove();$('cardSection').append(wrap);
    notify('ログインカード画像を長押しして保存してください');
  }catch(e){notify('画像生成に失敗：'+errorText(e))}
}
async function load(){const [ps,us]=await Promise.all([getDocs(collection(db,'posts')),getDocs(collection(db,'profiles'))]);posts=ps.docs.map(d=>({id:d.id,...d.data()})).filter(p=>categories.includes(p.category)&&Number.isInteger(p.moves));profiles=Object.fromEntries(us.docs.map(d=>[d.id,d.data()]));render()}
function sorted(arr){return [...arr].sort((a,b)=>b.moves-a.moves||dateOf(a)-dateOf(b))}
function ranking(cat,month=null,bestOnly=false){
 const filtered=sorted(posts.filter(p=>(!cat||p.category===cat)&&(!month||monthKey(dateOf(p))===month)));
 if(!bestOnly)return filtered.slice(0,100);
 const seen=new Set();return filtered.filter(p=>{if(seen.has(p.uid))return false;seen.add(p.uid);return true}).slice(0,100);
}
// All-time rating: 80–100 points per post, best 100 posts only.
function ratingFor(uid){
 const mine=posts.filter(p=>p.uid===uid).sort((a,b)=>b.moves-a.moves).slice(0,100);
 return Math.round(mine.reduce((sum,p)=>sum+80+0.4*Math.min(50,Math.max(0,p.moves)),0)*10)/10;
}
// Always show exactly one decimal place, with Japanese thousands separators.
const formatRate=rate=>Number(rate).toLocaleString('ja-JP',{minimumFractionDigits:1,maximumFractionDigits:1});
// Visual rating tiers; ranking and score calculations are unchanged.
function rateColorClass(rate){
 if(rate>=9500)return 'rate-rainbow';
 if(rate>=8000)return 'rate-gradient';
 if(rate>=5000)return 'rate-gold';
 if(rate>=3000)return 'rate-bronze';
 if(rate>=1000)return 'rate-blue';
 return 'rate-default';
}
// Reconstruct the rate gain at the time of each submission (best 100 records).
function postRateGains(uid){
 const mine=posts.filter(p=>p.uid===uid).sort((a,b)=>dateOf(a)-dateOf(b)||a.id.localeCompare(b.id));
 const gains=new Map();let top=[],prior=0;
 for(const p of mine){
  top.push(p);top.sort((a,b)=>b.moves-a.moves);top=top.slice(0,100);
  const next=Math.round(top.reduce((sum,x)=>sum+80+0.4*Math.min(50,Math.max(0,x.moves)),0)*10)/10;
  gains.set(p.id,Math.max(0,Math.round((next-prior)*10)/10));prior=next;
 }
 return gains;
}
const rateTiers=[{threshold:1000,label:'青レート'},{threshold:3000,label:'銅レート'},{threshold:5000,label:'金レート'},{threshold:8000,label:'虹レート'},{threshold:9500,label:'極虹レート'}];
function renderNotifications(){
 const mine=posts.filter(p=>p.uid===user.uid).sort((a,b)=>dateOf(a)-dateOf(b)||a.id.localeCompare(b.id));
 let top=[],prior=0;const events=[];const monthCounts=new Map();
 for(const p of mine){
   top.push(p);top.sort((a,b)=>b.moves-a.moves);top=top.slice(0,100);
   const next=Math.round(top.reduce((sum,x)=>sum+80+0.4*Math.min(50,Math.max(0,x.moves)),0)*10)/10;
   const delta=Math.round((next-prior)*10)/10;
   if(delta>0){
     const time=dateStr(dateOf(p));
     events.push({time,sort:dateOf(p).getTime(),id:p.id,html:`<div class="notice-title notice-gain">投稿が反映されました：<strong>+${formatRate(delta)}pt</strong></div><span class="notice-time">${safe(time)}</span>`});
     for(const tier of rateTiers){
       if(prior<tier.threshold&&next>=tier.threshold){
         events.push({time,sort:dateOf(p).getTime(),id:p.id,html:`<div class="notice-title"><b>RATING UP!</b><div><span class="notice-rate rate-number ${rateColorClass(tier.threshold)}">${formatRate(tier.threshold)}</span><span class="notice-tier">${tier.label}到達！</span></div></div><span class="notice-time">${safe(time)}</span>`});
       }
     }
   }
   const month=monthKey(dateOf(p));
   const monthly=(monthCounts.get(month)||0)+1;
   monthCounts.set(month,monthly);
   if([10,20,30].includes(monthly)){
     const time=dateStr(dateOf(p));
     events.push({time,sort:dateOf(p).getTime(),id:p.id,html:`<div class="notice-title"><b>MONTHLY COMPLETE!</b><div>今月の完走回数が<strong>${monthly}回</strong>に達しました！アイコンのふちの色が変わります！</div></div><span class="notice-time">${safe(time)}</span>`});
   }
   prior=next;
 }
 $('notificationsList').innerHTML=events.length?events.reverse().map(e=>`<div class="notice-entry">${e.html}</div>`).join(''):'まだお知らせはありません。投稿によってレートが上がると表示されます。';
}
function renderRateRanking(){
 const ids=[...new Set(posts.map(p=>p.uid))];
 const rows=ids.map(uid=>({uid,rate:ratingFor(uid),count:posts.filter(p=>p.uid===uid).length}))
   .sort((a,b)=>b.rate-a.rate||b.count-a.count||a.uid.localeCompare(b.uid)).slice(0,100);
 $('rankingList').innerHTML=rows.length?rows.map((r,i)=>{
   const owner=profiles[r.uid]||{};
   return `<div class="item"><div class="rank ${rankClass(i+1)}">${i+1}位</div><button class="secondary mini person" data-uid="${safe(r.uid)}" aria-label="プロフィールを見る" style="padding:3px">${avatar(owner,r.uid)}</button><div class="grow"><b>${safe(owner.name||'ユーザー')}</b><div class="muted">${r.count} 投稿</div></div><div class="rate-score"><span class="small">レート </span><strong class="rate-number ${rateColorClass(r.rate)}">${formatRate(r.rate)}</strong><span class="small">pt</span></div></div>`;
 }).join(''):'まだ投稿がありません。';
}
function rankClass(rank){return rank===1?'rank-gold':rank===2?'rank-silver':rank===3?'rank-bronze':'rank-regular'}
function postHtml(p,rank=null,rateGain=null){const owner=profiles[p.uid]||{};const canDelete=user&&((isAdmin&&adminMode)||p.uid===user.uid);return `<div class="item">${rank!==null?`<div class="rank ${rankClass(rank)}">${rank}位</div>`:''}<button class="secondary mini person" data-uid="${safe(p.uid)}" aria-label="プロフィールを見る" style="padding:3px">${avatar(owner,p.uid)}</button><div class="grow"><b>${safe(owner.name||'ユーザー')}</b><div><span class="pill">残り ${p.moves} 手</span> <span class="small">${safe(categoryLabel(p.category))}</span></div><div class="muted">${dateStr(dateOf(p))}</div>${rateGain===null?'':`<div class="post-rate-gain">レート増加：<strong>+${formatRate(rateGain)}pt</strong></div>`}</div><button class="secondary mini viewphoto" data-url="${safe(imageUrl(p.image))}">画像を見る</button>${canDelete?`<button class="danger mini deletepost" data-id="${safe(p.id)}">削除</button>`:''}</div>`}
function renderRanking(){const isRate=period==='rate';show('rankCategoryWrap',!isRate&&period!=='best');$('rankingPage').classList.toggle('rate-mode',isRate);if(isRate){renderRateRanking();return;}const month=period==='month'?monthKey(new Date()):null;const bestOnly=period==='best';const arr=ranking(bestOnly?null:$('rankCategory').value,month,bestOnly);$('rankingList').innerHTML=arr.length?arr.map((p,i)=>postHtml(p,i+1)).join(''):'まだ投稿がありません。'}


function socialLinks(owner){const links=Array.isArray(owner.snsLinks)?owner.snsLinks:[];return links.filter(u=>typeof u==='string'&&/^https:\/\//i.test(u)).slice(0,3).map(u=>{try{const url=new URL(u);const display=(url.hostname.replace(/^www\./,'')+url.pathname.replace(/\/$/,'')).slice(0,48);return `<a href="${safe(url.href)}" target="_blank" rel="noopener noreferrer" class="social-link">${safe(display)} ↗</a>`;}catch{return '';}}).join('');}
  
  
function renderProfile(){
 const uid=profileUid||user.uid,owner=profiles[uid]||{},mine=posts.filter(p=>p.uid===uid),best=sorted(mine)[0];
 const currentMonth=monthKey(new Date());
 const months=[...new Set(posts.map(p=>monthKey(dateOf(p))))].filter(m=>m<currentMonth).sort().reverse();
 const history=months.map(month=>{
  const rows=categories.map(cat=>{
   const pos=ranking(cat,month,true).findIndex(p=>p.uid===uid);
   return `<div class="monthly-row"><span>${safe(categoryLabel(cat))}</span><b>${pos<0?'／':`${pos+1}位`}</b></div>`;
  }).join('');
  return `<div class="monthly-group"><b>${safe(month)}</b>${rows}</div>`;
 });
 const rateGains=postRateGains(uid);
 const historyPosts=(profileSort==='new'?[...mine].sort((a,b)=>dateOf(b)-dateOf(a)):sorted(mine)).map(p=>postHtml(p,null,rateGains.get(p.id)??0)).join('')||'<p class="muted">まだ投稿がありません</p>';
 $('profileContent').innerHTML=`<div class="flex">${avatar(owner,uid,true)}<div><h2>${safe(owner.name||'ユーザー')}</h2><div class="profile-rating">レート <strong class="rate-number ${rateColorClass(ratingFor(uid))}">${formatRate(ratingFor(uid))}</strong>pt</div><div class="muted">${uid===user.uid?'自分のプロフィール':'ユーザープロフィール'}</div></div></div>${socialLinks(owner)?`<div class="social-links">${socialLinks(owner)}</div>`:''}<hr><div>投稿数（完走回数）</div><div class="stat">${mine.length} 回</div><h3>自己ベスト（最高残り手数）</h3>${best?postHtml(best):'<p class="muted">まだ記録がありません</p>'}<h3>月毎のランキング順位</h3>${history.join('')||'<p class="muted">ランキング履歴がありません</p>'}<h3>投稿履歴</h3><label for="profileSort">並び順</label><select id="profileSort" class="profile-sort"><option value="new" ${profileSort==='new'?'selected':''}>新しい順</option><option value="moves" ${profileSort==='moves'?'selected':''}>残り手数の多い順</option></select><div id="profilePosts">${historyPosts}</div>`;
}
function renderAdmin(){if(!isAdmin||!adminMode)return;const all=[...posts].sort((a,b)=>dateOf(b)-dateOf(a));$('adminList').innerHTML=all.length?all.map(p=>postHtml(p)).join(''):'投稿はありません';}
async function displayLoginCard(){
 if(!user)return;
 const pass=$('cardVerifyPassword').value;
 if(!pass)return notify('パスワードを入力してください');
 const id=profiles[user.uid]?.accountId||rememberedId();
 if(!id)return notify('アカウントIDが見つかりません。保存済みのログインカードを使用してください');
 const btn=$('generateLoginCard');busy(btn,true);
 try{
  await reauthenticateWithCredential(user,EmailAuthProvider.credential(idEmail(id),pass));
  if(typeof QRCode!=='function')throw Error('QRコード作成ライブラリが読み込まれていません');
  const target=$('qrGenerator');target.innerHTML='';
  new QRCode(target,{text:JSON.stringify({type:'finish-ranking-login',id,pass}),width:300,height:300,correctLevel:QRCode.CorrectLevel.M});
  const qrCanvas=target.querySelector('canvas'),qrImg=target.querySelector('img');
  const qrSrc=qrCanvas?.toDataURL('image/png')||qrImg?.src;
  if(!qrSrc)throw Error('QRコードの生成に失敗しました');
  const qr=new Image();qr.src=qrSrc;await qr.decode();
  const canvas=document.createElement('canvas');canvas.width=840;canvas.height=1020;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,840,1020);
  ctx.fillStyle='#152038';ctx.textAlign='center';
  ctx.font='bold 38px system-ui,sans-serif';ctx.fillText('ポケロードランキング',420,85);
  ctx.font='26px system-ui,sans-serif';ctx.fillText('ログインカード',420,133);
  ctx.font='20px system-ui,sans-serif';ctx.fillText('ログイン情報を含む大切なカードです',420,225);
  ctx.font='22px system-ui,sans-serif';ctx.fillText('パスワード',420,308);
  ctx.font='bold 28px monospace';ctx.fillText(pass,420,350);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,220,390,400,400);ctx.imageSmoothingEnabled=true;
  ctx.font='20px system-ui,sans-serif';ctx.fillText('QRコードからログインできます',420,845);
  ctx.fillStyle='#b42336';ctx.font='bold 21px system-ui,sans-serif';ctx.fillText('このカードを他人に共有しないでください',420,915);
  $('loginCardPreview').src=canvas.toDataURL('image/png');show('loginCardPreview');show('loginCardHelp');
  $('cardVerifyPassword').value='';target.innerHTML='';
 }catch(e){notify('カード表示に失敗：'+errorText(e))}finally{busy(btn,false)}
}
async function verifyDeletionCard(){
 const input=$('deleteCardImage');input.value='';
 const file=await new Promise((resolve,reject)=>{
  const dialog=$('deleteCardDialog');dialog.showModal();
  const cancel=()=>{cleanup();reject(Error('削除をキャンセルしました'))};
  const confirm=()=>{if(!input.files[0]){notify('ログインカード画像を選択してください');return}const f=input.files[0];cleanup();resolve(f)};
  const cleanup=()=>{dialog.close();$('confirmDeleteCard').removeEventListener('click',confirm);$('cancelDeleteCard').removeEventListener('click',cancel);dialog.removeEventListener('cancel',onCancel)};
  const onCancel=e=>{e.preventDefault();cancel()};
  $('confirmDeleteCard').addEventListener('click',confirm);$('cancelDeleteCard').addEventListener('click',cancel);dialog.addEventListener('cancel',onCancel);
 });
 if(typeof jsQR!=='function')throw Error('QRコード読み取り機能を読み込めませんでした');
 const bitmap=await createImageBitmap(file);let code;
 try{const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const d=ctx.getImageData(0,0,c.width,c.height);code=jsQR(d.data,c.width,c.height)}finally{bitmap.close()}
 if(!code)throw Error('ログインカードのQRコードを読み取れませんでした');
 let info;try{info=JSON.parse(code.data)}catch{throw Error('正しいログインカードではありません')}
 if(info.type!=='finish-ranking-login'||!info.id||!info.pass)throw Error('正しいログインカードではありません');
 const currentUid=user.uid;
 const currentAccountId=profiles[currentUid]?.accountId||rememberedId();
 if(info.id!==currentAccountId)throw Error('この投稿のアカウントのログインカードではありません');
 const credential=EmailAuthProvider.credential(idEmail(info.id),info.pass);
 await reauthenticateWithCredential(user,credential);
 if(auth.currentUser?.uid!==currentUid)throw Error('ログイン中のアカウントが変更されました。もう一度ログインしてください');
}
async function deletePost(id){if(!user)return;const p=posts.find(x=>x.id===id);if(!p||(!(isAdmin&&adminMode)&&p.uid!==user.uid))return;if(!confirm(`この投稿を削除しますか？\n${profiles[p.uid]?.name||'ユーザー'} / ${categoryLabel(p.category)} / 残り${p.moves}手\n削除すると元に戻せません。`))return;try{await verifyDeletionCard();await deleteDoc(doc(db,'posts',id));/* Cloudinary上の画像削除にはサーバー側の認証処理が必要です。Firestoreの投稿のみ削除します。 */await load();notify('投稿を削除しました')}catch(err){notify('削除に失敗：'+errorText(err))}}
function render(){if(!user)return;if(page==='ranking')renderRanking();if(page==='notifications')renderNotifications();if(page==='admin')renderAdmin();if(page==='profile')renderProfile();if(page==='settings'){const profile=profiles[user.uid]||{};$('editName').value=profile.name||'';for(let i=0;i<3;i++)$('social'+(i+1)).value=(profile.snsLinks||[])[i]||''}}
function go(next){if(next==='admin'&&!(isAdmin&&adminMode)){notify('運営管理を開くには運営モードに切り替えてください');return}page=next;show('siteHeader',next==='home');if(next==='profile'){const mine=(profileUid||user.uid)===user.uid;show('profileSettingsBtn',mine);show('showLoginCardBtn',mine);show('logout',mine);show('adminModeBtn',mine&&isAdmin);}for(const n of ['home','ranking','profile','notifications','settings','admin'])show(n+'Page',n===next);document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===next));render();scrollTo(0,0)}
function previousMonth(){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return monthKey(d)}
async function buildLastMonthImage(last,results){
 const c=document.createElement('canvas');c.width=900;c.height=1050;
 const ctx=c.getContext('2d');ctx.fillStyle='#101827';ctx.fillRect(0,0,900,1050);
 ctx.fillStyle='#1b2941';ctx.beginPath();ctx.roundRect(45,45,810,960,28);ctx.fill();
 ctx.textAlign='center';ctx.fillStyle='#eaf1ff';ctx.font='bold 46px system-ui,sans-serif';ctx.fillText('🏆 ポケロードランキング',450,145);
 ctx.font='bold 42px system-ui,sans-serif';ctx.fillText(`${last.replace('-','年')}月の最終順位`,450,235);
 ctx.fillStyle='#acbad1';ctx.font='26px system-ui,sans-serif';ctx.fillText('先月の各編成の最高順位',450,292);
 ctx.fillStyle='#fff';ctx.font='bold 32px system-ui,sans-serif';
 const name=profiles[user.uid]?.name||'ユーザー';
 const shortName=[...name].slice(0,18).join('');ctx.fillText(shortName,450,375);
 results.forEach((r,i)=>{
   const y=485+i*145;
   ctx.fillStyle='#30425e';ctx.fillRect(90,y+45,720,2);
   ctx.textAlign='left';ctx.fillStyle='#eaf1ff';ctx.font='bold 31px system-ui,sans-serif';ctx.fillText(categoryLabel(r.cat),100,y);
   ctx.textAlign='right';ctx.fillStyle=r.rank===null?'#acbad1':'#ffd970';ctx.font='bold 37px system-ui,sans-serif';ctx.fillText(r.rank===null?'ランク外':`${r.rank}位`,790,y);
 });
 ctx.textAlign='center';ctx.fillStyle='#acbad1';ctx.font='24px system-ui,sans-serif';ctx.fillText('ポケロードランキング',450,945);
 return c.toDataURL('image/png');
}
async function showLastMonthOnce(){
 const current=monthKey(new Date()),key=`finish-ranking-last-month-${user.uid}`;
 if(localStorage.getItem(key)===current)return;
 const last=previousMonth();
 const results=categories.map(cat=>{
   const arr=ranking(cat,last),index=arr.findIndex(p=>p.uid===user.uid);
   return {cat,rank:index<0?null:index+1};
 });
 $('lastMonthTitle').textContent=`${last.replace('-','年')}月の順位`;
 $('lastMonthContent').innerHTML=results.map(r=>`<div class="item"><div class="grow"><b>${safe(categoryLabel(r.cat))}</b></div><b>${r.rank===null?'ランク外':`${r.rank}位`}</b></div>`).join('');
 try{
   $('lastMonthImage').src=await buildLastMonthImage(last,results);
   $('lastMonthDialog').showModal();
   localStorage.setItem(key,current);
 }catch(e){console.warn('順位画像生成に失敗',e);notify('先月の順位画像を作成できませんでした');}
}

async function verifyFinishImage(file){
  if(!file || !file.type.startsWith('image/'))throw Error('画像を選択してください');
  if(file.size>12*1024*1024)throw Error('画像は12MB以下にしてください');
  if(typeof Tesseract==='undefined')throw Error('文字認識ライブラリを読み込めません。通信環境を確認して再読み込みしてください');

  // A small edit-distance allowance helps with OCR errors, but avoids matching unrelated words.
  function editDistance(a,b){
    const prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      let diagonal=prev[0];prev[0]=i;
      for(let j=1;j<=b.length;j++){
        const old=prev[j];
        prev[j]=Math.min(prev[j]+1,prev[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));
        diagonal=old;
      }
    }
    return prev[b.length];
  }
  function recognized(text,type){
    const compact=String(text||'').normalize('NFKC').replace(/[\s　・.,，。:：\-ー_]/g,'').toUpperCase();
    if(type==='pr'){
      // PR60 / PR6O / PR６０ and one-character OCR mistakes.
      const latin=compact.replace(/[^A-Z0-9]/g,'');
      for(let i=0;i+4<=latin.length;i++){
        const token=latin.slice(i,i+4).replace(/O/g,'0').replace(/I/g,'1');
        if(editDistance(token,'PR60')<=1 && token.slice(0,2)!=='00')return true;
      }
      return false;
    }
    const japanese=compact.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,'');
    const target='メガレックウザ';
    if(japanese.includes(target))return true;
    // Require a near-complete word: allow at most one substitution/omission.
    for(const size of [target.length-1,target.length,target.length+1]){
      for(let i=0;i+size<=japanese.length;i++){
        if(editDistance(japanese.slice(i,i+size),target)<=1)return true;
      }
    }
    return false;
  }

  const bitmap=await createImageBitmap(file);
  try{
    const w=bitmap.width,h=bitmap.height;
    if(w<250||h<400)throw Error('画像の解像度が低すぎます');
    // Relative coordinates work with different phone and tablet resolutions.
    const regions=[
      {x:0,y:.045,w:.31,h:.13,lang:'eng',type:'pr'},
      {x:0,y:0,w:.55,h:.25,lang:'eng',type:'pr'},
      {x:.56,y:.37,w:.44,h:.15,lang:'jpn',type:'mega'},
      {x:.30,y:.10,w:.70,h:.68,lang:'jpn',type:'mega'}
    ];
    for(const r of regions){
      const x=Math.round(w*r.x),y=Math.round(h*r.y);
      const rw=Math.min(w-x,Math.round(w*r.w)),rh=Math.min(h-y,Math.round(h*r.h));
      const scale=Math.min(2.5,1600/rw,1600/rh);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(rw*scale));
      canvas.height=Math.max(1,Math.round(rh*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('画像を処理できませんでした');
      ctx.drawImage(bitmap,x,y,rw,rh,0,0,canvas.width,canvas.height);
      const original=ctx.getImageData(0,0,canvas.width,canvas.height);
      for(const mode of ['normal','brighten','contrast']){
        if(mode!=='normal'){
          // Restore the source before each preprocessing pass.
          ctx.putImageData(original,0,0);
          const pixels=new Uint8ClampedArray(original.data);
          for(let i=0;i<pixels.length;i+=4){
            const gray=.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2];
            if(mode==='brighten'){
              // Gamma brightening reveals lettering under translucent dark overlays.
              for(let c=0;c<3;c++)pixels[i+c]=Math.min(255,255*Math.pow(pixels[i+c]/255,.48));
            }else{
              const adjusted=Math.max(0,Math.min(255,(gray-128)*1.7+128));
              pixels[i]=pixels[i+1]=pixels[i+2]=adjusted;
            }
          }
          ctx.putImageData(new ImageData(pixels,canvas.width,canvas.height),0,0);
        }
        const result=await Tesseract.recognize(canvas,r.lang,{logger:()=>{}});
        if(recognized(result.data?.text,r.type))return true;
      }
    }
    throw Error('画像から「PR60」または「メガレックウザ」を確認できませんでした。文字が見える完走画像を選択してください');
  }finally{bitmap.close()}
}

async function submitPost(){const b=$('submitPost'),file=$('postImage').files[0],num=Number($('moves').value),cat=$('category').value;if(!file)return notify('完走した瞬間の画像を選んでください');if($('moves').value.trim()===''||!Number.isInteger(num)||num<0||num>9999)return notify('残り手数を0〜9999の整数で入力してください');if(!categories.includes(cat))return;busy(b,true);notify('投稿画像の文字を確認しています…');try{await verifyFinishImage(file);const image=await uploadImage(file,`posts/${user.uid}/${crypto.randomUUID()}.jpg`);await addDoc(collection(db,'posts'),{uid:user.uid,image,moves:num,category:cat,createdAt:serverTimestamp()});$('postImage').value='';$('moves').value='';show('postPreview',false);await load();notify('投稿しました！');go('ranking')}catch(e){notify('投稿に失敗：'+errorText(e))}finally{busy(b,false)}}
async function saveProfile(){const b=$('saveProfile'),name=$('editName').value.trim(),file=$('editAvatar').files[0];if(!name)return notify('名前を入力してください');const links=[];for(let i=1;i<=3;i++){const raw=$('social'+i).value.trim();if(!raw)continue;try{const url=new URL(raw);if(url.protocol!=='https:'||!url.hostname.includes('.'))throw Error();if(raw.length>500)throw Error();links.push(url.href)}catch{return notify('SNSリンク '+i+' は https:// から始まる正しいURLを入力してください')}}busy(b,true);try{const old=profiles[user.uid]||{};let avatarUrl=old.avatar||'';if(file)avatarUrl=await uploadImage(file,`avatars/${user.uid}/${Date.now()}.jpg`);await setDoc(doc(db,'profiles',user.uid),{name,avatar:avatarUrl,snsLinks:links},{merge:true});await load();notify('設定を保存しました')}catch(e){notify('保存に失敗：'+errorText(e))}finally{busy(b,false)}}
function wire(){ const helpOverlay=$('rankingHelpOverlay');const closeHelp=()=>{helpOverlay.classList.add('hidden');document.body.style.overflow='';$('openRankingHelp').focus()};$('openRankingHelp').onclick=()=>{helpOverlay.classList.remove('hidden');document.body.style.overflow='hidden';$('rankingHelpDialog').scrollTop=0;$('closeRankingHelp').focus()};$('closeRankingHelp').onclick=closeHelp;$('closeRankingHelpBottom').onclick=closeHelp;helpOverlay.addEventListener('click',e=>{if(e.target===helpOverlay)closeHelp()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!helpOverlay.classList.contains('hidden'))closeHelp()}); $('toCreate').onclick=()=>{show('createView');show('loginView',false);$('toCreate').classList.add('active');$('toLogin').classList.remove('active')};$('toLogin').onclick=()=>{show('createView',false);show('loginView');$('toLogin').classList.add('active');$('toCreate').classList.remove('active')};$('createBtn').onclick=createAccount;$('loginBtn').onclick=()=>login('', $('loginPassword').value);$('loginImage').onchange=e=>{if(e.target.files[0])loginFromImage(e.target.files[0])};$('finishCard').onclick=async()=>{cardInfo=null;creatingAccount=false;$('cardPassword').textContent='';show('cardSection',false);show('app');show('nav');try{await load();profileUid=user.uid;go('home')}catch(e){notify('プロフィール読み込みに失敗：'+errorText(e))}};$('logout').onclick=()=>signOut(auth);$('showLoginCardBtn').onclick=()=>{$('cardVerifyPassword').value='';$('loginCardPreview').removeAttribute('src');show('loginCardPreview',false);show('loginCardHelp',false);$('loginCardDialog').showModal()};$('generateLoginCard').onclick=displayLoginCard;$('closeLoginCard').onclick=()=>$('loginCardDialog').close();$('profileSettingsBtn').onclick=()=>go('settings');$('adminModeBtn').onclick=()=>{if(!isAdmin||!user)return;adminMode=!adminMode;$('adminModeBtn').textContent=adminMode?'運営モード':'通常モード';$('adminModeBtn').classList.toggle('mode-on',adminMode);$('adminModeBtn').setAttribute('aria-pressed',String(adminMode));show('adminTab',adminMode);show('adminBadge',adminMode);if(!adminMode&&page==='admin'){profileUid=user.uid;go('profile')}else render();notify(adminMode?'運営モードに切り替えました':'通常モードに切り替えました')};$('submitPost').onclick=submitPost;$('saveProfile').onclick=saveProfile;$('postImage').onchange=e=>{const f=e.target.files[0];if(!f){show('postPreview',false);return} $('postPreview').src=URL.createObjectURL(f);show('postPreview')};$('rankCategory').onchange=renderRanking;document.body.addEventListener('change',e=>{if(e.target.id==='profileSort'){profileSort=e.target.value;renderProfile()}});document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));renderRanking()});document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(b.dataset.page==='profile')profileUid=user.uid;go(b.dataset.page)});document.body.addEventListener('click',e=>{const person=e.target.closest('.person');if(person){profileUid=person.dataset.uid;go('profile')}const del=e.target.closest('.deletepost');if(del)deletePost(del.dataset.id);const photo=e.target.closest('.viewphoto');if(photo){$('largePhoto').src=photo.dataset.url;$('photoDialog').showModal()}});$('closePhoto').onclick=()=>$('photoDialog').close();$('closeLastMonth').onclick=()=>$('lastMonthDialog').close()}
wire();refreshLoginId();if(firebaseConfig.apiKey==='YOUR_API_KEY'){show('setup')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,async u=>{user=u;isAdmin=false;adminMode=false;show('adminTab',false);show('adminBadge',false);show('logout',false);$('adminModeBtn').textContent='通常モード';$('adminModeBtn').classList.remove('mode-on');$('adminModeBtn').setAttribute('aria-pressed','false');if(!u){show('siteHeader',false);show('auth');show('app',false);show('nav',false);show('cardSection',false);return}if(cardInfo||creatingAccount)return;try{const token=await u.getIdTokenResult(true);isAdmin=token.claims.admin===true}catch(err){console.warn(err)}show('adminTab',isAdmin&&adminMode);show('adminBadge',isAdmin&&adminMode);show('auth',false);show('app');show('nav');try{await load();go(page);await showLastMonthOnce()}catch(e){notify('データ読み込みに失敗：'+errorText(e))}})}catch(e){show('setup');notify(errorText(e))}}


async function refreshRanking() {
  const btn = document.getElementById('refreshRankingBtn');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = '更新中…';

  try {
    await load();
    notify('ランキングを更新しました！');
  } catch (e) {
    notify('更新に失敗しました：' + errorText(e));
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 更新';
  }
}

document.getElementById('refreshRankingBtn')
  ?.addEventListener('click', refreshRanking);
