import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,setPersistence,browserLocalPersistence,browserSessionPersistence,onAuthStateChanged,signOut,EmailAuthProvider,reauthenticateWithCredential} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {getFirestore,doc,setDoc,getDoc,collection,addDoc,getDocs,deleteDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {cloudinaryConfig} from './cloudinary-config.js';
const $=id=>document.getElementById(id), show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
let auth,db,user=null,posts=[],profiles={},period='all',page='home',profileUid=null,cardInfo=null,creatingAccount=false,isAdmin=false;
const categories=['混合編成','リレーラッシュ編成','その他'];
const notify=(s)=>{const e=$('notice');e.textContent=s;show('notice');setTimeout(()=>show('notice',false),4500)};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateStr=d=>new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
const dateOf=p=>p.createdAt?.toDate?.()||new Date(0);
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const imageUrl=u=>u&&/^https:\/\//.test(u)?u:'';
const avatar=(p,big=false)=>`<img class="avatar ${big?'big':''}" src="${safe(imageUrl(p?.avatar)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%234a6590%22/%3E%3Ctext x=%2240%22 y=%2255%22 font-size=%2245%22 text-anchor=%22middle%22%3E👤%3C/text%3E%3C/svg%3E')}" alt="アイコン">`;
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
function rankClass(rank){return rank===1?'rank-gold':rank===2?'rank-silver':rank===3?'rank-bronze':'rank-regular'}
function postHtml(p,rank=null){const owner=profiles[p.uid]||{};const canDelete=user&&(isAdmin||p.uid===user.uid);return `<div class="item">${rank!==null?`<div class="rank ${rankClass(rank)}">${rank}位</div>`:''}<button class="secondary mini person" data-uid="${safe(p.uid)}" aria-label="プロフィールを見る" style="padding:3px">${avatar(owner)}</button><div class="grow"><b>${safe(owner.name||'ユーザー')}</b><div><span class="pill">残り ${p.moves} 手</span> <span class="small">${safe(p.category)}</span></div><div class="muted">${dateStr(dateOf(p))}</div></div><button class="secondary mini viewphoto" data-url="${safe(imageUrl(p.image))}">画像を見る</button>${canDelete?`<button class="danger mini deletepost" data-id="${safe(p.id)}">削除</button>`:''}</div>`}
function renderRanking(){const month=period==='month'?monthKey(new Date()):null;const bestOnly=period==='best';show('rankCategoryWrap',!bestOnly);const arr=ranking(bestOnly?null:$('rankCategory').value,month,bestOnly);$('rankingList').innerHTML=arr.length?arr.map((p,i)=>postHtml(p,i+1)).join(''):'まだ投稿がありません。'}


function socialLinks(owner){const links=Array.isArray(owner.snsLinks)?owner.snsLinks:[];return links.filter(u=>typeof u==='string'&&/^https:\/\//i.test(u)).slice(0,3).map(u=>{try{const url=new URL(u);const display=(url.hostname.replace(/^www\./,'')+url.pathname.replace(/\/$/,'')).slice(0,48);return `<a href="${safe(url.href)}" target="_blank" rel="noopener noreferrer" class="social-link">${safe(display)} ↗</a>`;}catch{return '';}}).join('');}
  
  
function renderProfile(){const uid=profileUid||user.uid,owner=profiles[uid]||{},mine=posts.filter(p=>p.uid===uid),best=sorted(mine)[0];const currentMonth=monthKey(new Date());
 const months=[...new Set(posts.map(p=>monthKey(dateOf(p))))].filter(m=>m<currentMonth).sort().reverse();
 const history=months.map(month=>`<div class="monthly-group"><b>${safe(month)}</b>${categories.map(cat=>{const pos=ranking(cat,month,true).findIndex(p=>p.uid===uid);return `<div class="monthly-row"><span>${safe(cat)}</span><b>${pos<0?'／':`${pos+1}位`}</b></div>`}).join('')}</div>`);
 $('profileContent').innerHTML=`<div class="flex">${avatar(owner,true)}<div><h2>${safe(owner.name||'ユーザー')}</h2><div class="muted">${uid===user.uid?'自分のプロフィール':'ユーザープロフィール'}</div></div></div>${socialLinks(owner)?`<div class="social-links">${socialLinks(owner)}</div>`:''}<hr><div>投稿数（完走回数）</div><div class="stat">${mine.length} 回</div><h3>自己ベスト（最高残り手数）</h3>${best?postHtml(best):'<p class="muted">まだ記録がありません</p>'}<h3>月毎のランキング順位</h3>${history.join('')||'<p class="muted">ランキング履歴がありません</p>'}<h3>投稿履歴</h3>${sorted(mine).map(p=>postHtml(p)).join('')||'<p class="muted">まだ投稿がありません</p>'}`}
function renderAdmin(){if(!isAdmin)return;const all=[...posts].sort((a,b)=>dateOf(b)-dateOf(a));$('adminList').innerHTML=all.length?all.map(p=>postHtml(p)).join(''):'投稿はありません';}
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
async function deletePost(id){if(!user)return;const p=posts.find(x=>x.id===id);if(!p||(!isAdmin&&p.uid!==user.uid))return;if(!confirm(`この投稿を削除しますか？\n${profiles[p.uid]?.name||'ユーザー'} / ${p.category} / 残り${p.moves}手\n削除すると元に戻せません。`))return;try{if(!isAdmin)await verifyDeletionCard();await deleteDoc(doc(db,'posts',id));/* Cloudinary上の画像削除にはサーバー側の認証処理が必要です。Firestoreの投稿のみ削除します。 */await load();notify('投稿を削除しました')}catch(err){notify('削除に失敗：'+errorText(err))}}
function render(){if(!user)return;if(page==='ranking')renderRanking();if(page==='admin')renderAdmin();if(page==='profile')renderProfile();if(page==='settings'){const profile=profiles[user.uid]||{};$('editName').value=profile.name||'';for(let i=0;i<3;i++)$('social'+(i+1)).value=(profile.snsLinks||[])[i]||''}}
function go(next){page=next;for(const n of ['home','ranking','profile','settings','admin'])show(n+'Page',n===next);document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===next));render();scrollTo(0,0)}
function previousMonth(){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return monthKey(d)}
function showLastMonthOnce(){
  const current=monthKey(new Date()),key=`finish-ranking-last-month-${user.uid}`;
  if(localStorage.getItem(key)===current)return;
  localStorage.setItem(key,current);
  const last=previousMonth();
  const lines=categories.map(cat=>{
    const arr=ranking(cat,last),index=arr.findIndex(p=>p.uid===user.uid);
    return `<div class="item"><div class="grow"><b>${safe(cat)}</b></div><b>${index<0?'ランク外':`${index+1}位`}</b></div>`;
  }).join('');
  $('lastMonthTitle').textContent=`${last.replace('-','年')}月の順位`;
  $('lastMonthContent').innerHTML=lines;
  $('lastMonthDialog').showModal();
}
async function verifyFinishImage(file){
 if(!file || !file.type.startsWith('image/'))throw Error('画像を選択してください');
 if(file.size>12*1024*1024)throw Error('画像は12MB以下にしてください');
 if(typeof Tesseract==='undefined')throw Error('文字認識ライブラリを読み込めません。通信環境を確認して再読み込みしてください');
 const bitmap=await createImageBitmap(file);
 try{
  const w=bitmap.width,h=bitmap.height;
  if(w<250||h<400)throw Error('画像の解像度が低すぎます');
  // Detect PR60 near the top left, or メガレックウザ near the right side.
 
const regions = [
  {x:0, y:0, w:0.65, h:0.35, lang:'eng', type:'pr'},
  {x:0.25, y:0.08, w:0.75, h:0.75, lang:'jpn', type:'mega'}
];

function similar(a,b) {
  const dp = Array.from({length:a.length+1},()=>[]);
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      dp[i][j]=Math.min(
        dp[i-1][j]+1,
        dp[i][j-1]+1,
        dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1)
      );
    }
  }
  return dp[a.length][b.length];
}

for(const r of regions){
  const canvas=document.createElement('canvas');
  const x=Math.round(w*r.x),y=Math.round(h*r.y);
  const rw=Math.min(w-x,Math.round(w*r.w));
  const rh=Math.min(h-y,Math.round(h*r.h));
  const scale=Math.min(3,1800/rw);
  canvas.width=Math.round(rw*scale);
  canvas.height=Math.round(rh*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});

  for(const filter of ['none','grayscale(1) contrast(1.8)']){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.filter=filter;
    ctx.drawImage(bitmap,x,y,rw,rh,0,0,canvas.width,canvas.height);

    const result=await Tesseract.recognize(canvas,r.lang,{logger:()=>{}});
    const raw=(result.data?.text||'').toUpperCase();
    const text=raw.replace(/[\s　・.,。、]/g,'');

    if(r.type==='pr'){
      const normalized=text.replace(/O/g,'0').replace(/[IL|]/g,'1');
      if(/PR6[0-9]/.test(normalized)||normalized.includes('PR60')) return true;
    }else{
      const target='メガレックウザ';
      for(let i=0;i<text.length;i++){
        for(let n=target.length-1;n<=target.length+1;n++){
          const part=text.slice(i,i+n);
          if(part.length>=target.length-1&&similar(part,target)<=1){
            return true;
          }
        }
      }
    }
  }


  throw Error('画像から「PR60」または「メガレックウザ」を確認できませんでした。文字が鮮明な完走画像を選択してください');
 }finally{bitmap.close()}
}
async function submitPost(){const b=$('submitPost'),file=$('postImage').files[0],num=Number($('moves').value),cat=$('category').value;if(!file)return notify('完走した瞬間の画像を選んでください');if($('moves').value.trim()===''||!Number.isInteger(num)||num<0||num>9999)return notify('残り手数を0〜9999の整数で入力してください');if(!categories.includes(cat))return;busy(b,true);notify('投稿画像の文字を確認しています…');try{await verifyFinishImage(file);const image=await uploadImage(file,`posts/${user.uid}/${crypto.randomUUID()}.jpg`);await addDoc(collection(db,'posts'),{uid:user.uid,image,moves:num,category:cat,createdAt:serverTimestamp()});$('postImage').value='';$('moves').value='';show('postPreview',false);await load();notify('投稿しました！');go('ranking')}catch(e){notify('投稿に失敗：'+errorText(e))}finally{busy(b,false)}}
async function saveProfile(){const b=$('saveProfile'),name=$('editName').value.trim(),file=$('editAvatar').files[0];if(!name)return notify('名前を入力してください');const links=[];for(let i=1;i<=3;i++){const raw=$('social'+i).value.trim();if(!raw)continue;try{const url=new URL(raw);if(url.protocol!=='https:'||!url.hostname.includes('.'))throw Error();if(raw.length>500)throw Error();links.push(url.href)}catch{return notify('SNSリンク '+i+' は https:// から始まる正しいURLを入力してください')}}busy(b,true);try{const old=profiles[user.uid]||{};let avatarUrl=old.avatar||'';if(file)avatarUrl=await uploadImage(file,`avatars/${user.uid}/${Date.now()}.jpg`);await setDoc(doc(db,'profiles',user.uid),{name,avatar:avatarUrl,snsLinks:links},{merge:true});await load();notify('設定を保存しました')}catch(e){notify('保存に失敗：'+errorText(e))}finally{busy(b,false)}}
function wire(){ $('toCreate').onclick=()=>{show('createView');show('loginView',false);$('toCreate').classList.add('active');$('toLogin').classList.remove('active')};$('toLogin').onclick=()=>{show('createView',false);show('loginView');$('toLogin').classList.add('active');$('toCreate').classList.remove('active')};$('createBtn').onclick=createAccount;$('loginBtn').onclick=()=>login('', $('loginPassword').value);$('loginImage').onchange=e=>{if(e.target.files[0])loginFromImage(e.target.files[0])};$('finishCard').onclick=async()=>{cardInfo=null;creatingAccount=false;$('cardPassword').textContent='';show('cardSection',false);show('app');show('nav');try{await load();profileUid=user.uid;go('home')}catch(e){notify('プロフィール読み込みに失敗：'+errorText(e))}};$('logout').onclick=()=>signOut(auth);$('submitPost').onclick=submitPost;$('saveProfile').onclick=saveProfile;$('postImage').onchange=e=>{const f=e.target.files[0];if(!f){show('postPreview',false);return} $('postPreview').src=URL.createObjectURL(f);show('postPreview')};$('rankCategory').onchange=renderRanking;document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));renderRanking()});document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(b.dataset.page==='profile')profileUid=user.uid;go(b.dataset.page)});document.body.addEventListener('click',e=>{const person=e.target.closest('.person');if(person){profileUid=person.dataset.uid;go('profile')}const del=e.target.closest('.deletepost');if(del)deletePost(del.dataset.id);const photo=e.target.closest('.viewphoto');if(photo){$('largePhoto').src=photo.dataset.url;$('photoDialog').showModal()}});$('closePhoto').onclick=()=>$('photoDialog').close();$('closeLastMonth').onclick=()=>$('lastMonthDialog').close()}
wire();refreshLoginId();if(firebaseConfig.apiKey==='YOUR_API_KEY'){show('setup')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,async u=>{user=u;isAdmin=false;show('adminTab',false);show('adminBadge',false);show('logout',!!u);if(!u){show('auth');show('app',false);show('nav',false);show('cardSection',false);return}if(cardInfo||creatingAccount)return;try{const token=await u.getIdTokenResult(true);isAdmin=token.claims.admin===true}catch(err){console.warn(err)}show('adminTab',isAdmin);show('adminBadge',isAdmin);show('auth',false);show('app');show('nav');try{await load();go(page);showLastMonthOnce()}catch(e){notify('データ読み込みに失敗：'+errorText(e))}})}catch(e){show('setup');notify(errorText(e))}}


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
