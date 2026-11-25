"use strict";
/* ---------- Config ---------- */
const POST_COST = 3;
const PHOTO_COST = 8;
const costOf = kind => kind==="image" ? PHOTO_COST : POST_COST;
const SIGNUP_BONUS = 100;
const CONTACT_EMAIL = "teamgetopinion@gmail.com";
const INSTAGRAM = "teamgetopinion"; // e.g. "getopinion.app" once the Instagram page exists
const MADE_BY = "";   // optional, e.g. "Shaurya" to show who builds Get Opinion // add an email address here so people can reach you about their data
const CATS = [
  {id:"design",  name:"Creative & Design",       e:"🎨"},
  {id:"style",   name:"Style & Grooming",         e:"💇"},
  {id:"dating",  name:"Dating & Relationships",   e:"💬"},
  {id:"everyday",name:"Everyday Dilemmas",        e:"🤔"},
  {id:"fun",     name:"Sports & Fun",             e:"🏆"},
  {id:"debate",  name:"Settle a Debate",          e:"⚖️"},
  {id:"random",  name:"Random",                   e:"🎲"}
];
const catOf = id => CATS.find(c=>c.id===id) || CATS[3];

/* ---------- Helpers ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n>=1000 ? (n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,"")+"k" : String(n);
const ago = ts => { const m=Math.max(1,Math.round((Date.now()-ts)/60000)); return m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
const left = ms => { const m=Math.max(1,Math.ceil((ms-Date.now())/60000)); if(m<60) return m+"m"; const h=Math.floor(m/60); if(h<24) return h+"h "+(m%60)+"m"; return Math.floor(h/24)+"d "+(h%24)+"h"; };
const isOpenTimed = p => !!(p.endsAt && !p.closed && p.endsAt>Date.now());
const isClosed = p => !!(p.closed || (p.endsAt && p.endsAt<=Date.now()));
const isSettled = p => !!(isClosed(p) || p.groupDone);
function verdictOf(p){
  const A=p.ca||0, B=p.cb||0, T=A+B;
  const label=s=>(s==="a"?p.a:p.b)||(s==="a"?"Photo A":"Photo B");
  if(!T) return {kind:"none",T,emoji:"🗳️",headline:"Voting closed with no votes",line:"Nobody voted this time."};
  const pa=Math.round(A*100/T), w=A>=B?"a":"b", pct=Math.max(pa,100-pa);
  const low=!p.roster&&T<5, note=low?`Based on only ${T} ${T===1?"vote":"votes"}.`:"";
  if(A===B||pct<55) return {kind:"close",T,pct,low,note,emoji:"🤝",headline:"Too close to call",line:`${pa}% to ${100-pa}%. The crowd is split.`};
  if(p.cat==="debate"&&p.an&&p.bn) return {kind:"win",side:w,pct,T,low,note,emoji:"⚖️",headline:`It’s settled! ${w==="a"?p.an:p.bn} wins`,line:`${label(w)}. ${pct}% agree.`};
  return {kind:"win",side:w,pct,T,low,note,emoji:"✅",headline:p.by?`It’s settled for ${p.by}`:"It’s settled",line:`${label(w)} wins. ${pct}% agree.`};
}
const todayKey = () => new Date().toISOString().slice(0,10);
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
let toastT;
function toast(msg){ let t=$(".toast"); if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.appendChild(t)} t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2800); }
async function copyText(txt){
  try{ await navigator.clipboard.writeText(txt); return true }catch{}
  try{ const ta=document.createElement("textarea"); ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select(); const ok=document.execCommand("copy"); ta.remove(); return ok }catch{ return false }
}
async function api(path,opts={}){
  const r=await fetch(path,{method:opts.method||"GET",headers:opts.body?{"Content-Type":"application/json"}:{},body:opts.body?JSON.stringify(opts.body):undefined,credentials:"same-origin"});
  let j={}; try{ j=await r.json(); }catch{}
  if(!r.ok){ const e=new Error(j.error||"Something went wrong. Try again."); Object.assign(e,j,{status:r.status}); throw e; }
  return j;
}

/* ---------- Prompt templates ---------- */
const TEMPLATES = {
  design:[["Which logo feels more premium?","Serif wordmark","Geometric monogram"],["Which thumbnail would you click?","","",true],["Book cover: illustrated or typographic?","Illustrated","Typographic"],["Brand color: bold or muted?","Bold","Muted"],["Presentation: fewer slides or more detail?","Fewer slides","More detail"]],
  style:[["Which haircut suits me better?","","",true],["Interview outfit: suit or smart casual?","Suit","Smart casual"],["Which outfit for the wedding?","","",true],["Watch or no watch?","Watch","No watch"],["Short nails or long nails?","Short","Long"]],
  dating:[["Which opener gets a reply?","Hey, how’s your week?","Settle a debate: is cereal soup?"],["Which profile photo should go first?","","",true],["Text back now or wait an hour?","Now","Wait an hour"],["Say ‘I like you’ first or wait?","Say it","Wait"],["Plan a surprise or ask what they want?","Surprise","Ask"]],
  everyday:[["Which paint color for the room?","","",true],["Take the higher-paying job or the one I enjoy?","Higher pay","Enjoyment"],["Get a dog or a cat?","Dog","Cat"],["Buy a car or keep using cabs?","Buy a car","Keep using cabs"],["Weekend: rest or socialise?","Rest","Socialise"]],
  fun:[["Who’s the greatest of all time?","",""],["Marvel or DC?","Marvel","DC"],["Which jersey for game day?","","",true],["Biryani or pizza for the watch party?","Biryani","Pizza"],["Early bird or night owl?","Early bird","Night owl"]],
  random:[["Window seat or aisle seat?","Window","Aisle"],["Call or text?","Call","Text"],["Sweet or savoury breakfast?","Sweet","Savoury"],["Time machine: past or future?","Past","Future"],["Cats or dogs?","Cats","Dogs"]],
  debate:[["Who’s right about the AC temperature?","22°C is perfect","26°C saves the planet"],["Who should pick the movie tonight?","The one who picked last time? No.","Whoever lost the toss"],["Is it cheating to watch ahead on a shared show?","Yes, betrayal","No, it’s my time"],["Who owes who an apology?","",""],["Is a 5-minute late arrival actually late?","Yes, time is time","No, that’s on time"]]
};

/* ---------- Client-side text check (server checks again) ---------- */
const BLOCK_WORDS = ["kill yourself","kys","go die","retard","slut","whore","faggot","nigger","rape","nude","nudes","naked","porn","onlyfans","xxx","sex tape","dick pic"];
function screenText(...parts){
  const t = parts.filter(Boolean).join(" ").toLowerCase();
  for(const w of BLOCK_WORDS){ if(new RegExp("(^|\\W)"+w.replace(/ /g,"\\s+")+"($|\\W)").test(t)) return "That wording breaks our community rules. Keep it kind and safe for everyone."; }
  if(/[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /(\+?\d[\d\s-]{8,}\d)/.test(t)) return "Remove phone numbers or email addresses. Polls stay anonymous.";
  if(/https?:\/\//.test(t)) return "Links aren’t allowed inside polls.";
  return null;
}
function skinRatio(ctx,w,h){
  const d = ctx.getImageData(0,0,w,h).data; let skin=0,n=0;
  for(let i=0;i<d.length;i+=16){ const r=d[i],g=d[i+1],b=d[i+2]; n++;
    if(r>95&&g>40&&b>20&&Math.max(r,g,b)-Math.min(r,g,b)>15&&Math.abs(r-g)>15&&r>g&&r>b) skin++; }
  return skin/n;
}

/* ---------- Referral tag from a shared link ---------- */
(function(){ try{ const u=new URL(location.href); const r=(u.searchParams.get("r")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);
  if(r){ lsSet("go-ref",r); u.searchParams.delete("r"); history.replaceState(null,"",u.pathname+(u.search||"")+u.hash); } }catch{} })();

/* ---------- Local stats (per device) ---------- */
const DEFAULT_ME = {votes:0,matches:0,days:[],today:{d:"",n:0},onboarded:false,skipped:[]};
let ME = Object.assign({},DEFAULT_ME,lsGet("go-me",{}));
const saveMe = () => lsSet("go-me",ME);
function streak(){
  const set = new Set(ME.days); let s=0; const d=new Date();
  if(!set.has(d.toISOString().slice(0,10))) d.setDate(d.getDate()-1);
  while(set.has(d.toISOString().slice(0,10))){ s++; d.setDate(d.getDate()-1); }
  return s;
}

/* ---------- State ---------- */
const S = { me:{loggedIn:false,credits:0}, polls:[], cat:"all", current:null, view:"vote", status:"", loaded:false, devCodes:false, extra:{} };
const getPoll = id => S.polls.find(p=>p.id===id) || S.extra[id];
const tally = p => { if(p.sealed) return {a:0,b:0,t:p.total||0,pa:50,pb:50,sealed:true}; const a=p.ca||0,b=p.cb||0,t=a+b; const pa=t?Math.round(a*100/t):50; return {a,b,t,pa,pb:t?100-pa:50}; };
const isHidden = p => !!p.hidden;
const myPick = p => p.pick || null;
const isOwner = p => !!p.mine;
function upsert(p){ if(!p) return; const i=S.polls.findIndex(x=>x.id===p.id); if(i>=0) S.polls[i]=p; else if(p.vis==="public"||p.mine) S.polls.unshift(p); if(S.extra[p.id]) S.extra[p.id]=p; }

async function refresh(){
  try{
    const j=await api("/api/state");
    S.me=j.me; S.polls=j.polls; S.devCodes=j.devCodes; S.status=""; S.loaded=true;
  }catch(e){ S.status="Can’t reach the server. Check your connection."; }
  softRender();
}
setInterval(()=>{ if(document.visibilityState==="visible"&&!S.revealing&&S.view!=="ask"&&!$("#scrim").classList.contains("open")) refresh(); },20000);

let renderQueued=false;
function softRender(){
  if(S.view==="ask"||(S.view==="vote"&&S.revealing)){ updateChrome(); return; }
  if(renderQueued) return; renderQueued=true; requestAnimationFrame(()=>{renderQueued=false; render();});
}

/* ---------- Chrome ---------- */
function updateChrome(){
  const cp=$("#creditPill");
  cp.textContent = S.me.loggedIn ? S.me.credits+(S.me.credits===1?" credit":" credits") : "Log in";
  cp.style.cursor = S.me.loggedIn ? "default" : "pointer";
  cp.onclick = S.me.loggedIn ? null : ()=>openLogin();
  $("#streakPill").textContent = "🔥 "+streak();
  document.querySelectorAll(".nav a").forEach(a=>{ if(a.dataset.v===S.view) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
}

/* ---------- Routing ---------- */
function route(){
  const h=(location.hash||"").slice(1);
  if(h.startsWith("poll-")){ S.view="poll"; S.pollId=h.slice(5); }
  else if(h.startsWith("u-")){ S.view="user"; try{ S.userNick=decodeURIComponent(h.slice(2)); }catch{ S.userNick=""; } }
  else S.view=["ask","mine","me","top","admin","about"].includes(h)?h:"vote";
  S.revealing=false; if(typeof closeSheet==="function") closeSheet(); render(); window.scrollTo(0,0);
}
window.addEventListener("hashchange",route);
$("#logoBtn").onclick=()=>{ location.hash="vote"; };

const isDesk = () => matchMedia("(min-width: 960px)").matches;
let railCache=null, railAt=0;
async function fillRail(){
  const r=$("#rail"); if(!r||!isDesk()) return;
  const cta=`<div class="panel"><h3>Can’t decide?</h3><p class="note" style="margin:0 0 12px">Put two options in front of the crowd and get an honest answer fast.</p><a class="btn primary block" href="#ask">Ask a question</a></div>`;
  const inv=S.me.loggedIn&&S.me.refCode?`<div class="panel"><h3>Invite friends</h3><p class="note" style="margin:0 0 12px">Earn 30 credits for each friend who joins from your link.</p><a class="btn block" href="#me">Get your link</a></div>`:"";
  const st=settledList().slice(0,3);
  const settledPanel=st.length?`<div class="panel"><h3>Just settled</h3><div class="board">${st.map(({p,v})=>`<a class="brow" href="#poll-${esc(p.id)}"><span class="rank" aria-hidden="true">${v.emoji}</span><span class="who2"><b>${esc(p.q)}</b><span>${esc(v.line)}</span></span></a>`).join("")}</div><a class="btn ghost block" href="#top" style="margin-top:6px">All verdicts</a></div>`:"";
  r.innerHTML=cta+settledPanel+`<div class="panel"><h3>Trending this week</h3><div id="trend"><p class="note">Loading…</p></div><a class="btn ghost block" href="#top" style="margin-top:6px">See the leaderboard</a></div>`+inv+`<p class="note" style="padding:0 4px">Tip: press <b>A</b> or <b>B</b> to vote, <b>Enter</b> for the next poll.</p>`;
  try{ if(!railCache||Date.now()-railAt>60000){ railCache=await api("/api/leaderboard?period=week"); railAt=Date.now(); }
    const t=$("#trend"); if(!t) return;
    t.innerHTML=railCache.polls.length?`<div class="board">${railCache.polls.slice(0,5).map((p,i)=>`<a class="brow" href="#poll-${esc(p.id)}"><span class="rank ${i<3?"r"+(i+1):""}">${i+1}</span><span class="who2"><b>${esc(p.q)}</b><span>${fmt(p.votes)} ${p.votes===1?"vote":"votes"}</span></span></a>`).join("")}</div>`:`<p class="note">No new polls yet this week. Be the first!</p>`;
  }catch{ const t=$("#trend"); if(t) t.innerHTML=`<p class="note">Couldn’t load trending polls.</p>`; }
}
matchMedia("(min-width: 960px)").addEventListener?.("change",()=>render());
function render(){
  updateChrome();
  const v=$("#view"); v.classList.remove("is-feed");
  if(S.view==="vote") renderFeed(v);
  else if(S.view==="ask") renderAsk(v);
  else if(S.view==="mine") renderMine(v);
  else if(S.view==="me") renderMe(v);
  else if(S.view==="user") renderUser(v);
  else if(S.view==="top") renderTop(v);
  else if(S.view==="admin") renderAdmin(v);
  else if(S.view==="about") renderAbout(v);
  else renderPollPage(v);
}

/* ---------- Feed ---------- */
function feedList(){ return S.polls.filter(p=>p.vis!=="private" && !isHidden(p) && !isOwner(p) && !isClosed(p) && (S.cat==="all"||p.cat===S.cat)); }
function nextPoll(){
  const list=feedList().filter(p=>!myPick(p));
  // polls that still need votes come first: real polls under 5 votes, soonest verdict first; then newest; starter polls last
  const need=p=>!p.seed&&tally(p).t<5;
  const fresh=list.filter(p=>!ME.skipped.includes(p.id)).sort((x,y)=>(need(y)-need(x)) || (need(x)&&need(y)?((x.endsAt||Infinity)-(y.endsAt||Infinity)):0) || (y.seed?0:1)-(x.seed?0:1) || y.ts-x.ts);
  return fresh[0] || list[0] || null;
}
function renderFeed(v){
  const need=Math.max(0,POST_COST-S.me.credits);
  v.innerHTML = `
  <div class="feed-main">
  <section class="hero">
    <h1>Can’t decide? Let strangers pick <span class="va">A</span> or <span class="vb">B</span>.</h1>
    <p>Arguing with a friend? Post both sides and let the crowd settle it. Every vote is anonymous.</p>
  </section>
  ${S.status?`<p class="status">${esc(S.status)}</p>`:""}
  <div class="chips" role="group" aria-label="Categories">
    <button class="chip" data-cat="all" aria-pressed="${S.cat==="all"}">All</button>
    ${CATS.map(c=>`<button class="chip" data-cat="${c.id}" aria-pressed="${S.cat===c.id}">${c.e} ${esc(c.name)}</button>`).join("")}
  </div>
  ${S.me.loggedIn?`<div class="meter"><span>${need?`Vote ${need} more to post your next poll`:"Ready to ask the crowd"}</span><div class="bar"><span style="width:${Math.min(100,S.me.credits/POST_COST*100)}%"></span></div><b>${S.me.credits} credits</b></div>`:`<div class="lock"><p><b>Want to ask your own?</b> Log in with your email and get ${SIGNUP_BONUS} credits. Voting never needs an account.</p><button class="btn accent" id="suBtn">Get ${SIGNUP_BONUS}</button></div>`}
  ${ME.votes>=3&&canInstall()&&!ME.noInstall?`<div class="meter" id="instBar"><span>📲 Add Get Opinion to your home screen</span><span class="spacer"></span><button class="btn accent" id="instGo" style="padding:7px 12px">Add</button><button class="btn ghost" id="instX" aria-label="Dismiss" style="padding:7px 8px">✕</button></div>`:""}
  ${(()=>{ const x=settledList()[0]; return x?`<a class="justsettled" href="#poll-${esc(x.p.id)}"><span aria-hidden="true">${x.v.emoji}</span><span><b>Just settled:</b> ${esc(x.p.q)} ${esc(x.v.line)}</span><span aria-hidden="true">›</span></a>`:""; })()}
  <div id="slot"></div></div>
  <aside class="rail" id="rail"></aside>`;
  v.classList.add("is-feed"); fillRail();
  $("#instGo")&&($("#instGo").onclick=doInstall);
  $("#instX")&&($("#instX").onclick=()=>{ ME.noInstall=true; saveMe(); $("#instBar").remove(); });
  v.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{ S.cat=b.dataset.cat; S.current=null; render(); });
  $("#suBtn")&&($("#suBtn").onclick=()=>openLogin());
  const slot=$("#slot");
  if(!S.loaded){ slot.innerHTML=`<p class="status">Loading polls…</p>`; return; }
  let p = S.current && getPoll(S.current);
  if(!p || (myPick(p) && !S.revealing) || isHidden(p) || (S.cat!=="all"&&p.cat!==S.cat)) p=nextPoll();
  if(!p){
    slot.innerHTML=`<div class="empty"><h2>You’ve judged everything here.</h2><p>Put your own dilemma in front of the crowd.</p><a class="btn primary" href="#ask">Ask a question</a> <button class="btn" id="reset">See skipped polls</button></div>`;
    $("#reset").onclick=()=>{ME.skipped=[];saveMe();render();};
    return;
  }
  S.current=p.id;
  slot.appendChild(buildCard(p,{feed:true}));
}

function sideHTML(p,s){
  const img = p.kind==="image" ? (s==="a"?p.ai:p.bi) : null;
  const txt = s==="a"?p.a:p.b, who = p.cat==="debate" ? (s==="a"?p.an:p.bn) : "";
  const L=s.toUpperCase();
  if(img) return `<span class="letter">${L}</span><span class="imgbg" style="background-image:url('${esc(img)}')" aria-hidden="true"></span><img alt="Option ${L}: ${esc(txt||"photo")}" src="${esc(img)}" draggable="false" loading="lazy"><span class="zoom" role="button" tabindex="0" aria-label="See photo ${L} full size" data-zoom="${s}">⤢</span><span class="side-pct-wrap"><span class="pct">0%</span></span><span class="cap">${who?`<span class="who">${esc(who)}’s side</span>`:""}<span class="opt">${esc(txt||"Option "+L)}</span></span>`;
  return `<span class="letter">${L}</span>${who?`<span class="who">${esc(who)}’s side</span>`:""}<span class="opt">${esc(txt)}</span><span class="pct">0%</span>`;
}

function buildCard(p,{feed=false,alias=null}={}){
  const el=document.createElement("article"); el.className="card"; el.dataset.id=p.id;
  const c=catOf(p.cat), t=tally(p), pick=myPick(p), own=isOwner(p);
  el.innerHTML=`
    <div class="meta"><span class="cat">${c.e} ${esc(c.name)}</span>${p.cat==="debate"&&p.an&&p.bn?`<span class="tag debate">${esc(p.an)} vs ${esc(p.bn)}</span>`:""}${p.seed?`<span class="tag">Starter poll</span>`:`<span class="tag">New</span>`}${p.vis==="private"?`<span class="tag">Private</span>`:""}${isOpenTimed(p)?`<span class="tag debate">⏳ Verdict in ${left(p.endsAt)}</span>`:isClosed(p)?`<span class="tag debate">Final result</span>`:""}${p.extended?`<span class="tag">Extended</span>`:""}<span class="spacer"></span><span class="count">${fmt(t.t)} ${t.t===1?"vote":"votes"}</span></div>
    <h2 class="q">${esc(p.q)}</h2>
    ${p.by?`<p class="byline">Asked by <a href="#u-${encodeURIComponent(p.by)}">${esc(p.by)}</a></p>`:""}
    <div class="split${p.kind==="image"?" imgs":""}" role="group" aria-label="Pick A or B">
      <button class="side side-a${p.kind==="image"?" has-img":""}" data-s="a">${sideHTML(p,"a")}</button>
      <button class="side side-b${p.kind==="image"?" has-img":""}" data-s="b">${sideHTML(p,"b")}</button>
    </div>
    <p class="hint">${pick||own||isClosed(p)?"":"Tap a side, swipe the card, or press A / B"}</p>
    <p class="verdict" aria-live="polite"></p>
    <div class="actions">
      ${feed?`<button class="btn ghost" data-act="skip">Skip</button>`:""}
      <button class="btn" data-act="share">Share</button>
      ${own?"":`<button class="btn ghost" data-act="flag">Report</button>`}
      ${feed?`<button class="btn primary next" data-act="next" hidden>Next poll<span class="prog"></span></button>`:""}
    </div>`;
  const split=el.querySelector(".split");
  if(pick) reveal(el,p,pick,false);
  else if(own||isClosed(p)) reveal(el,p,null,false);
  split.querySelectorAll(".side").forEach(b=>b.onclick=()=>{ if(!split.classList.contains("voted")) castVote(el,p,b.dataset.s,alias); });
  el.querySelector('[data-act="share"]').onclick=()=>{ stopAuto(el); const cur=getPoll(p.id)||p; openShare(cur,false,isSettled(cur)&&verdictOf(cur).kind==="win"); };
  el.querySelectorAll("[data-zoom]").forEach(z=>{ const open=e=>{ e.stopPropagation(); e.preventDefault(); stopAuto(el); viewPhotos(p,z.dataset.zoom); };
    z.addEventListener("click",open,true); z.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" ") open(e); }); });
  el.querySelector('[data-act="flag"]')&&(el.querySelector('[data-act="flag"]').onclick=()=>{ stopAuto(el); openFlag(p); });
  if(feed){
    el.querySelector('[data-act="skip"]').onclick=()=>{ if(!ME.skipped.includes(p.id)) ME.skipped.push(p.id); saveMe(); S.current=null; render(); };
    el.querySelector('[data-act="next"]').onclick=()=>goNext();
  }
  if(!own&&!isClosed(p)) attachSwipe(el,p,alias);
  return el;
}

function reveal(el,p,pick,animate){
  const t=tally(p), split=el.querySelector(".split");
  split.classList.add("voted");
  const A=split.querySelector(".side-a"), B=split.querySelector(".side-b");
  if(pick) (pick==="a"?A:B).classList.add("chosen");
  el.querySelector(".count").textContent=fmt(t.t)+(t.t===1?" vote":" votes");
  const hint=el.querySelector(".hint"); if(hint) hint.textContent="";
  if(t.sealed){
    A.querySelector(".pct").textContent="🔒"; B.querySelector(".pct").textContent="🔒";
    const vd=el.querySelector(".verdict");
    const grp=p.roster?`${(p.votedNames||[]).length} of ${p.roster.length} have voted`:"";
    vd.textContent = p.roster ? (pick?`Vote locked in. Results show when everyone has voted (${grp}).`:`Results show when everyone has voted (${grp}).`) : `Vote locked in. The poster is keeping results secret until the end, in ${left(p.endsAt)}.`;
    const nb=notifyButton(p.roster?"Notify me when everyone’s voted":"Notify me when results drop",()=>watchPoll(p.id)); if(nb){ vd.appendChild(document.createElement("br")); vd.appendChild(nb); }
    return;
  }
  // photo polls keep both photos the same size so neither gets squeezed; text polls resize to the split
  const set=()=>{ if(p.kind==="image") return; A.style.flexGrow=Math.max(t.pa,22); B.style.flexGrow=Math.max(t.pb,22); };
  if(animate) requestAnimationFrame(()=>requestAnimationFrame(set)); else set();
  countUp(A.querySelector(".pct"),t.pa,animate); countUp(B.querySelector(".pct"),t.pb,animate);
  const win = t.pa===t.pb ? null : (t.pa>t.pb?"a":"b");
  if(isSettled(p)){
    const v=verdictOf(p);
    const card=document.createElement("div"); card.className="vcard "+v.kind;
    card.innerHTML=`<span class="vemoji" aria-hidden="true">${v.emoji}</span><span><b>${esc(v.headline)}</b><span>${esc(v.line)}</span>${v.note?`<small class="vnote">⚠️ ${esc(v.note)}</small>`:""}</span>`;
    el.querySelector(".split").before(card);
    if(v.kind==="win"){ (v.side==="a"?A:B).classList.add("winner"); (v.side==="a"?B:A).classList.add("loser"); }
    el.querySelector(".verdict").textContent = !pick ? (isOwner(p)?"Your poll has been settled.":"Voting has closed.") : v.kind!=="win" ? `You picked ${pick.toUpperCase()}.` : pick===v.side ? "You called it! 🎯 You were with the winning side." : "You went the other way this time.";
    const sv=el.querySelector('[data-act="share"]'); if(sv&&v.kind==="win") sv.textContent="Share verdict";
    return;
  }
  let msg;
  const debateWin = p.cat==="debate"&&p.an&&p.bn ? (!win?"It’s a tie.":`${win==="a"?p.an:p.bn} wins, ${Math.max(t.pa,t.pb)}% to ${Math.min(t.pa,t.pb)}%.`) : null;
  if(isClosed(p)) msg = "Voting closed. "+(debateWin || (!t.t?"No votes came in.":!win?"It’s a perfect tie.":`The crowd picked ${win.toUpperCase()}, ${Math.max(t.pa,t.pb)}% to ${Math.min(t.pa,t.pb)}%.`));
  else if(!pick) msg = isOpenTimed(p) ? `Your poll. Voters see results in ${left(p.endsAt)}. You can watch live.` : t.t ? "Your poll. Live results above." : "Your poll. Share it to get the first votes.";
  else if(p.cat==="debate" && p.an && p.bn) msg = !win ? "Dead heat. Nobody wins this one yet." : `The crowd sides with ${win==="a"?p.an:p.bn}, ${Math.max(t.pa,t.pb)}% to ${Math.min(t.pa,t.pb)}%.`;
  else if(isOpenTimed(p)) msg = `Live result so far. The final verdict lands in ${left(p.endsAt)}, check back to see which way the crowd went.`;
  else if(t.t<5) msg = t.t<=1 ? "You’re the first to vote! Check back as more people weigh in." : `You’re one of the first ${t.t} voters. Check back as more people weigh in.`;
  else msg = !win ? "Perfect split. You’re the tiebreaker." : (pick===win ? `You’re with the crowd. ${Math.max(t.pa,t.pb)}% agree.` : `Bold pick. Only ${pick==="a"?t.pa:t.pb}% went your way.`);
  el.querySelector(".verdict").textContent=msg;
  if(pick&&p.groups&&p.groups.length){
    const L=x=>x==="a"?(p.a||"A"):(p.b||"B");
    const box=document.createElement("div"); box.className="groups";
    box.innerHTML=`<p class="note" style="margin:0 0 6px;text-align:center">How different groups voted</p>`+p.groups.map(gp=>{ const side=gp.pa>=50?"a":"b", pct=side==="a"?gp.pa:100-gp.pa;
      return `<div class="grow"><span class="gl">${esc(gp.label)}</span><span class="gb"><span class="s${side}" style="width:${pct}%"></span></span><span class="gp">${pct}% ${esc(L(side)).slice(0,18)}</span></div>`; }).join("")
      +(!ME.g&&!ME.age?`<p class="note" style="margin:6px 0 0;text-align:center"><a href="#me">Add your age and gender</a> to be counted.</p>`:"");
    el.querySelector(".verdict").after(box);
  }
}
function countUp(node,to,animate){
  if(!node) return; if(!animate){ node.textContent=to+"%"; return; }
  const st=performance.now(); const tick=n=>{ const k=Math.min(1,(n-st)/650); node.textContent=Math.round(to*(1-Math.pow(1-k,3)))+"%"; if(k<1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

let autoT=null;
function stopAuto(el){ clearTimeout(autoT); el?.querySelector?.(".next")?.classList.remove("run"); }
function goNext(){ clearTimeout(autoT); S.revealing=false; S.current=null; render(); if(S.askDemo){ S.askDemo=false; openDemo(); } }

async function castVote(el,p,s,alias){
  if(myPick(p)||isOwner(p)||isClosed(p)) return;
  const split=el.querySelector(".split"); split.classList.add("voted");
  S.revealing = S.view==="vote";
  // optimistic
  const opt = p.sealed ? {...p,pick:s,total:(p.total||0)+1,votedNames:alias&&p.roster?[...(p.votedNames||[]),alias]:p.votedNames} : {...p,pick:s,ca:p.ca+(s==="a"?1:0),cb:p.cb+(s==="b"?1:0)}; upsert(opt);
  reveal(el,opt,s,true);
  if(navigator.vibrate) try{navigator.vibrate(12)}catch{}
  const next=el.querySelector(".next");
  if(next){ next.hidden=false; if(!p.sealed){ next.classList.add("run"); autoT=setTimeout(goNext,2200); } }
  try{
    const j=await api("/api/vote",{method:"POST",body:{id:p.id,side:s,member:alias||undefined,g:ME.g||undefined,age:ME.age||undefined}});
    upsert(j.poll); S.me={...S.me,...j.me};
    if(j.counted&&(isOpenTimed(j.poll)||j.poll.sealed)&&pushState()==="on") watchPoll(j.poll.id);
    if(j.counted){
      const t=tally(j.poll);
      ME.votes++; if(!t.sealed&&((s==="a"&&t.pa>=t.pb)||(s==="b"&&t.pb>=t.pa))) ME.matches++;
      const d=todayKey(); if(!ME.days.includes(d)) ME.days.push(d); ME.days=ME.days.slice(-60);
      ME.today = ME.today.d===d ? {d,n:ME.today.n+1} : {d,n:1};
      if(ME.votes>=5&&!ME.demoAsked) S.askDemo=true;
      saveMe();
    }
    updateChrome();
    $("#creditPill").animate?.([{transform:"scale(1.18)"},{transform:"scale(1)"}],{duration:300});
    if(S.me.loggedIn&&S.me.credits===POST_COST) setTimeout(()=>toast("You can post again. Ask your next question!"),400);
    if(S.view==="poll"&&S.pollId===p.id) setTimeout(()=>{ if(S.view==="poll"&&S.pollId===p.id) renderPollPage($("#view")); },1400);
  }catch(e){
    upsert(p); stopAuto(el); toast(e.message); S.revealing=false; render();
  }
}

function attachSwipe(el,p,alias){
  let x0=null,dx=0,id=null;
  el.addEventListener("pointerdown",e=>{ if(el.querySelector(".split.voted")||e.target.closest(".actions")) return; x0=e.clientX; dx=0; id=e.pointerId; });
  el.addEventListener("pointermove",e=>{ if(x0===null||e.pointerId!==id) return; dx=e.clientX-x0; if(Math.abs(dx)>8){ el.classList.add("drag"); el.style.transform=`translateX(${dx*.6}px) rotate(${dx/40}deg)`; } });
  const end=()=>{ if(x0===null) return; el.classList.remove("drag"); el.style.transform=""; if(Math.abs(dx)>90) castVote(el,p,dx<0?"a":"b",alias); x0=null; };
  el.addEventListener("pointerup",end); el.addEventListener("pointercancel",end);
  el.addEventListener("click",e=>{ if(Math.abs(dx)>8){ e.stopPropagation(); e.preventDefault(); dx=0; } },true);
}
document.addEventListener("keydown",e=>{
  if(S.view!=="vote"||e.target.closest("input,textarea")||$("#scrim").classList.contains("open")) return;
  const card=$(".card"); if(!card) return; const p=getPoll(card.dataset.id); if(!p) return;
  const k=e.key.toLowerCase();
  if((k==="a"||k==="arrowleft")&&!myPick(p)) castVote(card,p,"a");
  else if((k==="b"||k==="arrowright")&&!myPick(p)) castVote(card,p,"b");
  else if((k==="enter"||k===" ")&&myPick(p)&&!e.target.closest("button")){ e.preventDefault(); goNext(); }
});

/* ---------- Ask ---------- */
const DRAFT = {catManual:false,hours:24,roster:"",showName:false,cat:"random",q:"",a:"",b:"",an:"",bn:"",kind:"text",vis:"public",ai:null,bi:null,consent:false,checks:{}};
function renderAsk(v){
  const d=DRAFT, cost=costOf(d.kind), li=S.me.loggedIn, can=li&&S.me.credits>=cost, isDebate=d.cat==="debate";
  v.innerHTML=`
  <h1 class="section-title">Ask the crowd</h1>
  <p class="sub">One question, two options. A text poll costs ${POST_COST} credits and a photo poll costs ${PHOTO_COST}. You earn 1 for every vote you cast.</p>
  ${!li?`<div class="lock"><p><b>Log in with your email to post.</b> You get ${SIGNUP_BONUS} credits to start. You can draft now.</p><button class="btn accent" id="askSu">Log in</button></div>`:can?"":`<div class="lock"><p><b>Vote on ${cost-S.me.credits} more ${cost-S.me.credits===1?"poll":"polls"} to post ${d.kind==="image"?"a photo poll":"again"}.</b> You can draft now.</p><a class="btn accent" href="#vote">Vote</a></div>`}
  <div class="panel">
    <label class="lbl">Category</label>
    <div class="chips" style="padding-bottom:4px">${CATS.map(c=>`<button class="chip" data-cat="${c.id}" aria-pressed="${d.cat===c.id}">${c.e} ${esc(c.name)}</button>`).join("")}</div>
    <p class="note" id="catHint" style="margin-top:0"></p>
    ${isDebate?`<p class="note" style="margin-top:0">Arguing with a friend? Put both of your names on it. The crowd picks a winner, and you get a verdict card to send back to them.</p>`:""}
  </div>
  <div class="panel">
    <h3>Need an idea?</h3>
    <div class="prompts">${TEMPLATES[d.cat].map((t,i)=>`<button class="prompt" data-i="${i}">${esc(t[0])}<small>${t[3]?"Photo poll":t[1]?esc(t[1])+" or "+esc(t[2]):"Fill in both sides"}</small></button>`).join("")}</div>
  </div>
  <div class="panel">
    <label class="lbl" for="q">Your question</label>
    <textarea class="field" id="q" maxlength="120" placeholder="${isDebate?"What are you two arguing about?":"What can’t you decide?"}">${esc(d.q)}</textarea>
    <div class="counter"><span id="qc">${d.q.length}</span>/120</div>
    <div style="margin-top:10px" class="seg" role="group" aria-label="Format">
      <button data-kind="text" aria-pressed="${d.kind==="text"}">Two texts · ${POST_COST}</button>
      <button data-kind="image" aria-pressed="${d.kind==="image"}">Two photos · ${PHOTO_COST}</button>
    </div>
    ${isDebate?`<div class="row" style="margin-top:14px">
      <div><label class="lbl" for="an">Side A belongs to</label><input class="field" id="an" maxlength="18" placeholder="You" value="${esc(d.an)}"></div>
      <div><label class="lbl" for="bn">Side B belongs to</label><input class="field" id="bn" maxlength="18" placeholder="Your friend" value="${esc(d.bn)}"></div></div>`:""}
    ${d.kind==="text"?`
    <div class="row" style="margin-top:14px">
      <div><label class="lbl" for="oa">Option A</label><input class="field" id="oa" maxlength="60" value="${esc(d.a)}" placeholder="${isDebate?"Their argument":"First choice"}"></div>
      <div><label class="lbl" for="ob">Option B</label><input class="field" id="ob" maxlength="60" value="${esc(d.b)}" placeholder="${isDebate?"Their argument":"Second choice"}"></div>
    </div>`:`
    <div class="upl" style="margin-top:14px">
      ${["a","b"].map(s=>`<label class="tile ${s}">${d[s+"i"]?`<img alt="" src="${esc(d[s+"i"])}">`:`<span style="font-size:1.6rem">${s.toUpperCase()}</span><span>Add photo</span>`}
        <input type="file" accept="image/*" data-s="${s}" aria-label="Photo for option ${s.toUpperCase()}">${d.checks[s]?`<span class="st">${esc(d.checks[s])}</span>`:""}</label>`).join("")}
    </div>
    <div class="row" style="margin-top:10px">
      <div><input class="field" id="oa" maxlength="40" value="${esc(d.a)}" placeholder="Label A (optional)" aria-label="Label for A"></div>
      <div><input class="field" id="ob" maxlength="40" value="${esc(d.b)}" placeholder="Label B (optional)" aria-label="Label for B"></div>
    </div>
    <label class="check"><input type="checkbox" id="consent" ${d.consent?"checked":""}><span>I took these photos or have the right to share them, and anyone recognisable in them agreed to be posted.</span></label>
    ${(d.askin||0)>.6||(d.bskin||0)>.6?`<label class="check"><input type="checkbox" id="skinOk" ${d.skinOk?"checked":""}><span>Our automatic check flagged a photo, often just because of skin tones, wood or warm colours. I confirm there’s no nudity. It’ll be reviewed, and hidden if anyone reports it.</span></label>`:""}`}
  </div>
  <div class="panel">
    <label class="check" style="margin:0 0 14px"><input type="checkbox" id="showName" ${d.showName?"checked":""} ${S.me.loggedIn?"":"disabled"}><span><b>Show my nickname on this poll</b>${S.me.loggedIn&&S.me.nick?` (${esc(S.me.nick)})`:""}<br><span class="note">Off keeps you anonymous. If on, people can tap your name to see other polls you posted with your name. Anonymous polls never show up there.</span></span></label>
    <h3>Who can vote?</h3>
    <div class="seg" role="group" aria-label="Visibility">
      <button data-vis="public" aria-pressed="${d.vis==="public"}">Public feed</button>
      <button data-vis="private" aria-pressed="${d.vis==="private"}">Private link</button>
    </div>
    <p class="note">${d.vis==="public"?"Anyone browsing can vote. Nobody sees who asked or who voted.":"Only people with your link can vote, no account needed. Nobody ever sees who picked what."}</p>
    ${d.vis==="private"?`<label class="lbl" for="roster" style="margin-top:12px">Who’s in the group? <span class="note">(optional)</span></label>
    <input class="field" id="roster" maxlength="600" placeholder="Aman, Riya, Kabir, Sana" value="${esc(d.roster)}">
    <p class="note">Add names, separated by commas, to see who’s voted and nudge the rest. Results stay hidden until everyone has voted${d.hours?" or time runs out":""}, so nobody can work out who picked what.</p>`:""}
  </div>
  <div class="panel">
    <h3>When do results come out?</h3>
    <div class="seg" role="group" aria-label="Results timing">
      ${[[0,"Instant"],[6,"6 hrs"],[24,"1 day"],[72,"3 days"],[168,"7 days"]].map(([h,l])=>`<button data-hours="${h}" aria-pressed="${d.hours===h}">${l}</button>`).join("")}
    </div>
    <p class="note">${d.hours?"Voters see the live split as soon as they vote. When time’s up, Get Opinion announces the final verdict, like “It’s settled! Beard wins. 67% agree.” If votes are low, you can extend it.":"Voters see the live split right after they vote. Voting never closes, so there’s no final verdict."}</p>
    ${d.hours?`<label class="check"><input type="checkbox" id="hideRes" ${d.hideResults?"checked":""}><span>Hide results until the end <span class="note">(adds suspense, good for debates)</span></span></label>`:""}
  </div>
  <p class="err" id="err" role="alert"></p>
  <button class="btn primary block" id="post" ${can||!li?"":"disabled"} style="padding:14px">${!li?"Log in to post":can?`Post for ${cost} credits`:`Need ${cost-S.me.credits} more ${cost-S.me.credits===1?"credit":"credits"}`}</button>
  <p class="note" style="text-align:center">Every poll is screened for nudity, abuse and personal details before it goes live.</p>`;

  const keep=()=>{ d.q=$("#q").value; d.a=$("#oa")?.value??d.a; d.b=$("#ob")?.value??d.b; if($("#an")){d.an=$("#an").value; d.bn=$("#bn").value;} if($("#consent")) d.consent=$("#consent").checked; };
  $("#q").oninput=e=>{ $("#qc").textContent=e.target.value.length; keep(); queueSuggestion(); };
  v.querySelectorAll("input.field").forEach(i=>i.oninput=()=>{ keep(); queueSuggestion(); });
  $("#consent")&&($("#consent").onchange=keep);
  $("#skinOk")&&($("#skinOk").onchange=e=>{ d.skinOk=e.target.checked; });
  $("#hideRes")&&($("#hideRes").onchange=e=>{ d.hideResults=e.target.checked; });
  $("#showName").onchange=e=>{ d.showName=e.target.checked; };
  $("#roster")&&($("#roster").oninput=e=>{ d.roster=e.target.value; });
  v.querySelectorAll(".chip[data-cat]").forEach(b=>b.onclick=()=>{ keep(); d.cat=b.dataset.cat; d.catManual=true; renderAsk(v); });
  v.querySelectorAll("[data-kind]").forEach(b=>b.onclick=()=>{ keep(); d.kind=b.dataset.kind; renderAsk(v); });
  v.querySelectorAll("[data-vis]").forEach(b=>b.onclick=()=>{ keep(); d.vis=b.dataset.vis; renderAsk(v); });
  v.querySelectorAll("[data-hours]").forEach(b=>b.onclick=()=>{ keep(); d.hours=+b.dataset.hours; renderAsk(v); });
  applySuggestion();
  v.querySelectorAll(".prompt").forEach(b=>b.onclick=()=>{ const t=TEMPLATES[d.cat][+b.dataset.i]; d.catManual=true; d.q=t[0]; d.kind=t[3]?"image":"text"; d.a=t[1]; d.b=t[2]; renderAsk(v); $("#q").focus(); });
  v.querySelectorAll('input[type="file"]').forEach(inp=>inp.onchange=async()=>{ keep(); const f=inp.files[0]; if(!f) return; await loadPhoto(f,inp.dataset.s); renderAsk(v); });
  $("#post").onclick=()=>{ keep(); submitPoll(); };
  $("#askSu")&&($("#askSu").onclick=()=>{ keep(); openLogin(); });
}

async function loadPhoto(file,s){
  const d=DRAFT, err=$("#err");
  if(!file.type.startsWith("image/")){ err.textContent="Choose an image file."; return; }
  try{
    const url=URL.createObjectURL(file); const img=new Image(); img.src=url; await img.decode();
    const max=720, k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
    const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
    const ratio=skinRatio(ctx,c.width,c.height);
    let q=.8, out=c.toDataURL("image/jpeg",q); while(out.length>300000&&q>.4){ q-=.1; out=c.toDataURL("image/jpeg",q); }
    d[s+"i"]=out; d[s+"skin"]=ratio; d.checks[s]= ratio>.6 ? "Our check will take a second look at this one" : "Ready for screening";
  }catch{ err.textContent="That image couldn’t be read. Try a JPG or PNG."; }
}

const parseRoster = t => [...new Map(String(t||"").split(/[,\n]/).map(x=>x.trim().replace(/\s+/g," ").slice(0,20)).filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
/* ---------- Category suggestion from keywords (free, runs on the phone) ---------- */
const CAT_WORDS = {
  design:["logo","design","font","typography","colour","color","palette","thumbnail","poster","flyer","banner","website","landing page","app icon","icon","ui","layout","mockup","wallpaper","cover","book cover","brand","branding","slide","presentation","portfolio","illustration","invite card","invitation"],
  style:["outfit","wear","wearing","dress","shirt","t-shirt","jeans","pants","trousers","shoes","sneakers","heels","loafers","haircut","hair","hairstyle","beard","shave","moustache","glasses","specs","watch","saree","sari","kurta","lehenga","sherwani","makeup","lipstick","nails","perfume","cologne","tattoo","jacket","blazer","suit","earrings","jewellery","jewelry","look better","style"],
  dating:["date","dating","first date","crush","boyfriend","girlfriend","bf","gf","ex","text him","text her","text back","propose","proposal","partner","relationship","tinder","hinge","bumble","wife","husband","marry","marriage","wedding","flirt","love","situationship","dp","profile pic","opener","pickup line"],
  everyday:["rent","job","offer","salary","flat","apartment","buy","phone","iphone","car","bike","laptop","move","shift","city","cook","cooking","gym","workout","study","college","course","exam","pet","dog","cat","budget","house","office","work","boss","sleep","diet","paint","room","sofa","furniture","party","rum","whiskey","beer","wine","cab","metro","commute","order in","swiggy","zomato"],
  fun:["messi","ronaldo","cricket","ipl","football","match","team","virat","kohli","dhoni","rohit","f1","formula 1","game","gaming","movie","film","marvel","dc","netflix","series","show","song","music","concert","beach","mountains","pizza","biryani","burger","superpower","would you rather","goat","champion","world cup"],
  debate:["vs","versus","who's right","who is right","who’s right","settle","argue","arguing","argument","debate","my friend says","we can't agree","we can’t agree","fight","who wins","who started"]
};
function suggestCat(text){
  const t=" "+String(text||"").toLowerCase().replace(/[^\p{L}\p{N}'’ -]+/gu," ").replace(/\s+/g," ")+" ";
  let best=null, score=0;
  for(const [cat,words] of Object.entries(CAT_WORDS)){
    let n=0; for(const w of words) if(t.includes(" "+w+" ")) n+= w.includes(" ")?2:1;
    if(n>score){ score=n; best=cat; }
  }
  return best || "random";
}
function applySuggestion(){
  const d=DRAFT, hint=$("#catHint"); if(!hint) return;
  if(d.catManual){ hint.textContent=""; return; }
  const sug=suggestCat([d.q,d.a,d.b].join(" "));
  if(sug==="debate"&&d.cat!=="debate"){
    hint.innerHTML=`⚖️ Sounds like an argument. <button class="btn ghost" id="mkDeb" style="padding:0;font-size:inherit;text-decoration:underline">Make it a debate</button> to add both names.`;
    $("#mkDeb").onclick=()=>{ d.cat="debate"; d.catManual=true; renderAsk($("#view")); };
    return;
  }
  if(sug==="debate"||d.cat==="debate") return;
  if(sug!==d.cat){ d.cat=sug; document.querySelectorAll(".chip[data-cat]").forEach(c=>c.setAttribute("aria-pressed",String(c.dataset.cat===sug))); }
  hint.textContent = d.q.trim().length<4 ? "We’ll suggest a category as you type." : sug==="random" ? "🎲 Filed under Random. Tap a category above if one fits better." : `✨ Suggested: ${catOf(sug).e} ${catOf(sug).name}. Tap another if it fits better.`;
}
let sugT=null;
const queueSuggestion=()=>{ clearTimeout(sugT); sugT=setTimeout(applySuggestion,250); };

let posting=false;
async function submitPoll(){
  if(posting) return; const d=DRAFT, err=$("#err"); err.textContent="";
  if(!S.me.loggedIn){ openLogin(); return; }
  const q=d.q.trim(), a=d.a.trim(), b=d.b.trim();
  const cost=costOf(d.kind);
  if(S.me.credits<cost){ err.textContent=`Vote on ${cost-S.me.credits} more polls first.`; return; }
  if(q.length<6){ err.textContent="Write a question of at least a few words."; return; }
  if(d.kind==="text"&&(!a||!b)){ err.textContent="Fill in both options."; return; }
  if(d.kind==="text"&&a.toLowerCase()===b.toLowerCase()){ err.textContent="Options A and B need to be different."; return; }
  if(d.cat==="debate"&&(!d.an.trim()||!d.bn.trim())){ err.textContent="Add a name for each side of the debate."; return; }
  if(d.kind==="image"){
    if(!d.ai||!d.bi){ err.textContent="Add a photo for both A and B."; return; }
    if(!d.consent){ err.textContent="Confirm you have permission to post these photos."; return; }
    if(((d.askin||0)>.6||(d.bskin||0)>.6)&&!d.skinOk){ err.textContent="Our automatic check wants a second look at one photo. Tick the box below to confirm there’s no nudity, and we’ll review it."; return; }
  }
  const bad=screenText(q,a,b,d.an,d.bn); if(bad){ err.textContent=bad; return; }
  if(d.vis==="private"&&parseRoster(d.roster).length===1){ err.textContent="Add at least 2 people to the group, or leave it empty."; return; }
  posting=true; const btn=$("#post"); btn.disabled=true; btn.textContent=d.kind==="image"?"Screening photos…":"Posting…";
  try{
    const j=await api("/api/polls",{method:"POST",body:{hideResults:!!d.hideResults&&d.hours>0,skinFlag:d.kind==="image"&&((d.askin||0)>.6||(d.bskin||0)>.6),roster:d.vis==="private"?parseRoster(d.roster):[],showName:d.showName,hours:d.hours,cat:d.cat,q,a,b,an:d.an,bn:d.bn,kind:d.kind,vis:d.vis,ai:d.ai,bi:d.bi,consent:d.consent}});
    S.me={...S.me,...j.me}; upsert(j.poll);
    Object.assign(DRAFT,{hideResults:false,skinOk:false,hours:24,catManual:false,cat:"random",roster:"",showName:false,q:"",a:"",b:"",an:"",bn:"",ai:null,bi:null,consent:false,checks:{},askin:0,bskin:0});
    posting=false; location.hash="mine"; setTimeout(()=>openShare(j.poll,true),150);
  }catch(e){
    posting=false; btn.disabled=false; btn.textContent=`Post for ${cost} credits`; err.textContent=e.message;
    if(e.status===401){ S.me={loggedIn:false,credits:0}; openLogin(); }
  }
}

/* ---------- Mine ---------- */
function renderMine(v){
  if(!S.me.loggedIn){ v.innerHTML=`<h1 class="section-title">My polls</h1><div class="empty"><h2>Log in to see your polls</h2><p>Your questions and live results show up here.</p><button class="btn primary" id="mLog">Log in with email</button></div>`; $("#mLog").onclick=()=>openLogin(); return; }
  const mine=S.polls.filter(isOwner).sort((a,b)=>b.ts-a.ts);
  v.innerHTML=`<h1 class="section-title">My polls</h1><p class="sub">Live results. Only you can see this list.</p><div class="mine" id="ml"></div>`;
  const ml=$("#ml");
  if(!mine.length){ ml.innerHTML=`<div class="empty"><h2>No polls yet</h2><p>You have ${S.me.credits} credits. Ask your first question.</p><a class="btn primary" href="#ask">Ask a question</a></div>`; return; }
  for(const p of mine){
    const t=tally(p), debate=p.cat==="debate"&&p.an;
    const win=t.t?(t.pa===t.pb?null:(t.pa>t.pb?"a":"b")):null;
    const el=document.createElement("div"); el.className="mi";
    el.innerHTML=`<div class="meta"><span class="cat">${catOf(p.cat).e} ${esc(catOf(p.cat).name)}</span><span class="tag">${p.vis==="private"?"Private link":"Public"}</span>${p.by?`<span class="tag">Name shown</span>`:`<span class="tag">Anonymous</span>`}<span class="spacer"></span><span>${ago(p.ts)}</span></div>
      <h2 class="q">${esc(p.q)}</h2>
      ${isSettled(p)?(()=>{ const v=verdictOf(p); return `<p class="note" style="margin:0 0 8px"><b>${v.emoji} ${esc(v.headline)}.</b> ${esc(v.line)}</p>`; })():""}
      ${t.sealed?`<div class="res"><span class="ra" style="flex-grow:1;justify-content:center;background:var(--surface-2);color:var(--muted)">🔒 ${p.roster?"Results show when everyone has voted":"Results hidden until time’s up"}</span></div>`:`<div class="res"><span class="ra" style="flex-grow:${Math.max(t.pa,15)}">A ${t.t?t.pa+"%":""}</span><span class="rb" style="flex-grow:${Math.max(t.pb,15)}">${t.t?t.pb+"%":""} B</span></div>`}
      <div class="legend"><span>${debate?esc(p.an)+": ":""}${esc(p.a||"Photo A")}</span><span>${debate?esc(p.bn)+": ":""}${esc(p.b||"Photo B")}</span></div>
      <p class="note">${t.t?`${t.t} ${t.t===1?"vote":"votes"}`:"No votes yet. Share it to get the first ones."}${debate&&win&&t.t>=3?` · Winning: ${esc(win==="a"?p.an:p.bn)}`:""}${p.hidden?" · Hidden after reports":""}${isOpenTimed(p)?` · Results drop for voters in ${left(p.endsAt)}`:isClosed(p)?" · Voting closed":""}</p>
      <div class="actions"><button class="btn accent" data-a="share">Share</button><a class="btn" href="#poll-${esc(p.id)}">Open</a><span class="spacer"></span><button class="btn ghost" data-a="del">Delete</button></div>`;
    if(p.roster){ const {voted,pending}=groupState(p); const g=document.createElement("p"); g.className="note"; g.innerHTML=`👥 ${voted.length} of ${p.roster.length} voted${pending.length?` · Waiting on ${pending.map(esc).join(", ")}`:" · Everyone’s in!"}`; el.querySelector(".actions").before(g);
      if(pending.length){ const nb=document.createElement("button"); nb.className="btn"; nb.textContent="Nudge"; nb.onclick=()=>window.open("https://wa.me/?text="+encodeURIComponent(nudgeText(p)),"_blank","noopener"); el.querySelector('[data-a="share"]').after(nb); } }
    { const ex=extendBox(p); if(ex) el.querySelector(".actions").before(ex); }
    el.querySelector('[data-a="share"]').onclick=()=>openShare(p);
    el.querySelector('[data-a="del"]').onclick=async()=>{ if(!confirm("Delete this poll? Votes on it will no longer show.")) return; try{ await api("/api/polls/"+encodeURIComponent(p.id),{method:"DELETE"}); S.polls=S.polls.filter(x=>x.id!==p.id); render(); toast("Poll deleted"); }catch(e){ toast(e.message); } };
    ml.appendChild(el);
  }
}

/* ---------- Single poll page (private links) ---------- */
async function renderPollPage(v){
  v.innerHTML=`<div style="margin:4px 0 12px"><a class="btn ghost" href="#vote" style="padding-left:0">‹ Back to feed</a></div><div id="pp"><p class="status">Loading poll…</p></div>`;
  const id=S.pollId; let p=getPoll(id);
  if(!p){ try{ p=(await api("/api/poll/"+encodeURIComponent(id))).poll; S.extra[id]=p; }catch{ p=null; } }
  if(S.view!=="poll"||S.pollId!==id) return;
  const pp=$("#pp"); pp.innerHTML="";
  if(!p){ pp.innerHTML=`<div class="empty"><h2>This poll isn’t available</h2><p>It may have been deleted, or the link is incomplete.</p><a class="btn primary" href="#vote">Vote on other polls</a></div>`; return; }
  if(isHidden(p)&&!isOwner(p)){ pp.innerHTML=`<div class="empty"><h2>This poll is under review</h2><p>It was reported by the community.</p></div>`; return; }
  ME.member=ME.member||{};
  if(p.roster&&!p.groupDone&&!isOwner(p)&&!myPick(p)&&!isClosed(p)&&!ME.member[p.id]){
    const {voted}=groupState(p), lc=new Set(voted.map(n=>n.toLowerCase()));
    pp.innerHTML=`<div class="panel"><h3>Which one are you?</h3><p class="note" style="margin:0 0 12px">Tap your name to vote on “${esc(p.q)}”. Nobody will see what you pick.</p>
      <div class="badges">${p.roster.map(n=>lc.has(n.toLowerCase())?`<span class="badge">✓ ${esc(n)}</span>`:`<button class="badge on" data-m="${esc(n)}" style="border:0;cursor:pointer">${esc(n)}</button>`).join("")}</div>
      <p class="note">Names with ✓ have already voted.</p></div>`;
    pp.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{ ME.member[p.id]=b.dataset.m; saveMe(); renderPollPage(v); });
    return;
  }
  pp.appendChild(buildCard(p,{alias:p.roster?(ME.member&&ME.member[p.id])||null:null}));
  if(p.roster){
    pp.appendChild(groupPanel(p));
    if(!isOwner(p)&&!myPick(p)&&ME.member&&ME.member[p.id]){ const n=document.createElement("p"); n.className="note"; n.style.textAlign="center"; n.textContent=`Voting as ${ME.member[p.id]}. `; const ch=document.createElement("button"); ch.className="btn ghost"; ch.textContent="Not you?"; ch.onclick=()=>{ delete ME.member[p.id]; saveMe(); renderPollPage(v); }; n.appendChild(ch); pp.appendChild(n); }
  }
  { const ex=extendBox(p); if(ex){ ex.classList.add("panel"); ex.style.marginTop="14px"; pp.appendChild(ex); } }
  if(isOwner(p)&&!p.roster){
    const box=document.createElement("div"); box.className="panel"; box.style.marginTop="14px";
    const tt=tally(p); box.innerHTML=`<h3>Your poll</h3><p class="note">${tt.t?`${tt.t} ${tt.t===1?"person has":"people have"} voted.`:`No votes yet. ${p.vis==="private"?"Send the link to your group.":"Share it to get the first votes."}`} Votes are anonymous, so you see the result, not who picked what.</p>`;
    pp.appendChild(box);
  } else if(!myPick(p)){
    const more=document.createElement("p"); more.className="note"; more.style.textAlign="center";
    more.textContent="Vote to see what everyone else picked.";
    pp.appendChild(more);
  }
}

/* ---------- Extend (poster only) ---------- */
function extendBox(p){
  const t=tally(p);
  if(!isOwner(p)||!p.endsAt||(p.extended||0)>=2||t.t>=20||p.groupDone) return null;
  if(!isClosed(p)&&p.endsAt-Date.now()>24*3600e3&&t.t>=5) return null;
  const box=document.createElement("div"); box.className="extend";
  const msg = t.t<5 ? `Only ${t.t} ${t.t===1?"vote":"votes"} so far. Extend it for a stronger verdict.` : "Want more votes before the verdict? Extend it.";
  box.innerHTML=`<p class="note" style="margin:0 0 8px">${msg} ${isClosed(p)?"Voting reopens and the verdict updates when the new time ends.":""} You can extend ${2-(p.extended||0)} more ${2-(p.extended||0)===1?"time":"times"}.</p>
    <div class="actions" style="margin:0"><button class="btn" data-ext="24">Extend 1 day</button><button class="btn" data-ext="72">Extend 3 days</button><button class="btn ghost" data-ext="share">Share it</button></div>`;
  box.querySelectorAll("[data-ext]").forEach(b=>b.onclick=async()=>{
    if(b.dataset.ext==="share"){ openShare(p); return; }
    b.disabled=true;
    try{ const j=await api("/api/polls/"+encodeURIComponent(p.id)+"/extend",{method:"POST",body:{hours:+b.dataset.ext}}); upsert(j.poll); toast(`Extended. New verdict in ${left(j.poll.endsAt)}.`); render(); }
    catch(e){ b.disabled=false; toast(e.message); }
  });
  return box;
}

/* ---------- Group polls: who has voted (never what they picked) ---------- */
function groupState(p){ const voted=p.votedNames||[], lc=new Set(voted.map(n=>n.toLowerCase())); return {voted, pending:(p.roster||[]).filter(n=>!lc.has(n.toLowerCase()))}; }
function nudgeText(p){ const {pending}=groupState(p); return `Hey ${pending.join(", ")}! Still waiting on your vote 👀 “${p.q}” Takes 2 seconds: ${shareLink(p)}`; }
function groupPanel(p){
  const {voted,pending}=groupState(p);
  const box=document.createElement("div"); box.className="panel"; box.style.marginTop="14px";
  box.innerHTML=`<h3>${pending.length?`${voted.length} of ${p.roster.length} have voted`:"Everyone has voted 🎉"}</h3>
    ${voted.length?`<p class="note" style="margin:0 0 6px">Voted</p><ul class="voters">${voted.map(n=>`<li class="va">✓ ${esc(n)}</li>`).join("")}</ul>`:""}
    ${pending.length?`<p class="note" style="margin:10px 0 6px">Waiting on</p><ul class="voters">${pending.map(n=>`<li class="vb">${esc(n)}</li>`).join("")}</ul>
    <div class="actions"><button class="btn accent" data-n="wa">Nudge on WhatsApp</button><button class="btn" data-n="copy">Copy nudge</button></div>`:""}
    <p class="note">Only who has voted is shown, never what they picked.</p>`;
  box.querySelector('[data-n="wa"]')&&(box.querySelector('[data-n="wa"]').onclick=()=>window.open("https://wa.me/?text="+encodeURIComponent(nudgeText(p)),"_blank","noopener"));
  box.querySelector('[data-n="copy"]')&&(box.querySelector('[data-n="copy"]').onclick=async()=>toast(await copyText(nudgeText(p))?"Nudge copied":"Couldn’t copy"));
  return box;
}

/* ---------- Leaderboards ---------- */
S.topTab="settled"; S.topPeriod="week";
function settledList(){ return S.polls.filter(p=>!p.seed&&p.vis==="public"&&isSettled(p)&&!isHidden(p)).map(p=>({p,v:verdictOf(p)})).filter(x=>x.v.kind!=="none").sort((x,y)=>(y.p.endsAt||y.p.ts)-(x.p.endsAt||x.p.ts)); }
async function renderTop(v){
  const tab=S.topTab, period=S.topPeriod;
  v.innerHTML=`<h1 class="section-title">Leaderboard</h1><p class="sub">${period==="week"?"This week’s":"All-time"} top polls, askers and voters.</p>
    <div class="seg" role="group" aria-label="Board" style="margin-bottom:10px">${[["settled","Settled"],["polls","Top polls"],["askers","Askers"],["voters","Voters"]].map(([k,l])=>`<button data-tab="${k}" aria-pressed="${tab===k}">${l}</button>`).join("")}</div>
    <div class="chips" role="group" aria-label="Period" style="padding-top:0">${[["week","This week"],["all","All time"]].map(([k,l])=>`<button class="chip" data-per="${k}" aria-pressed="${period===k}">${l}</button>`).join("")}</div>
    <div id="tb"><p class="status">Loading…</p></div>`;
  v.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ S.topTab=b.dataset.tab; renderTop(v); });
  v.querySelectorAll("[data-per]").forEach(b=>b.onclick=()=>{ S.topPeriod=b.dataset.per; renderTop(v); });
  let j; try{ j=await api("/api/leaderboard?period="+period); }catch(e){ $("#tb").innerHTML=`<p class="status">${esc(e.message)}</p>`; return; }
  if(S.view!=="top"||S.topTab!==tab||S.topPeriod!==period) return;
  const tb=$("#tb"), rk=i=>`<span class="rank ${i<3?"r"+(i+1):""}">${i+1}</span>`;
  const empty=msg=>`<div class="empty"><p>${msg}</p><a class="btn primary" href="#ask">Ask a question</a></div>`;
  if(tab==="settled"){
    const list=settledList();
    tb.innerHTML=list.length?`<div class="board">${list.slice(0,30).map(({p,v})=>`<a class="brow" href="#poll-${esc(p.id)}"><span class="rank" aria-hidden="true">${v.emoji}</span><span class="who2"><b>${esc(p.q)}</b><span>${esc(v.headline)}: ${esc(v.line)}</span></span></a>`).join("")}</div>`:`<div class="empty"><p>No verdicts yet. Polls with a timer get a verdict when time’s up.</p><a class="btn primary" href="#ask">Ask a question</a></div>`;
    return;
  }
  if(tab==="polls"){
    tb.innerHTML=j.polls.length?`<div class="board">${j.polls.map((p,i)=>`<a class="brow" href="#poll-${esc(p.id)}">${rk(i)}<span class="who2"><b>${esc(p.q)}</b><span>${catOf(p.cat).e} ${esc(catOf(p.cat).name)}${p.by?` · by ${esc(p.by)}`:""}</span></span><span class="num">${fmt(p.votes)}</span></a>`).join("")}</div>`:empty(period==="week"?"No new polls this week yet. Be the first!":"No polls yet.");
  } else if(tab==="askers"){
    tb.innerHTML=(j.askers.length?`<div class="board">${j.askers.map((a,i)=>`<a class="brow" href="#u-${encodeURIComponent(a.nick)}">${rk(i)}<span class="who2"><b>${esc(a.nick)}</b><span>${a.polls} ${a.polls===1?"poll":"polls"}</span></span><span class="num">${fmt(a.votes)} ${a.votes===1?"vote":"votes"}</span></a>`).join("")}</div>`:empty("No named polls yet."))
      +`<p class="note">Only polls posted with “Show my nickname” count here. Anonymous polls stay anonymous.</p>`;
  } else {
    const me=j.me;
    tb.innerHTML=(j.voters.length?`<div class="board">${j.voters.map(r=>`<div class="brow${r.you?" you":""}"><span class="rank ${r.rank<=3?"r"+r.rank:""}">${r.rank}</span><span class="who2"><b>${r.nick?esc(r.nick):"Anonymous voter"}${r.you?" (you)":""}</b></span><span class="num">${fmt(r.n)} ${r.n===1?"vote":"votes"}</span></div>`).join("")}</div>`:`<div class="empty"><p>No votes counted yet${period==="week"?" this week":""}.</p></div>`)
      +(S.me.loggedIn?`${me&&me.rank&&me.rank>10?`<div class="brow you" style="margin-top:8px"><span class="rank">${me.rank}</span><span class="who2"><b>You</b></span><span class="num">${fmt(me.n)} ${me.n===1?"vote":"votes"}</span></div>`:""}
        <label class="check"><input type="checkbox" id="onB" ${S.me.onBoards?"checked":""}><span>Show my nickname on the voter leaderboard<br><span class="note">Only how many votes you cast is shown, never what you picked.</span></span></label>`
        :`<p class="note">Votes count here when you’re logged in. <button class="btn ghost" id="tLog" style="padding:0;font-size:inherit;text-decoration:underline">Log in</button> to join the leaderboard.</p>`);
    $("#onB")&&($("#onB").onchange=async e=>{ try{ const r=await api("/api/me/boards",{method:"POST",body:{on:e.target.checked}}); S.me.onBoards=r.onBoards; toast(r.onBoards?"Your nickname will show on the leaderboard":"You’ll show as Anonymous voter"); renderTop(v); }catch(err){ toast(err.message); } });
    $("#tLog")&&($("#tLog").onclick=()=>openLogin());
  }
}

/* ---------- Public profile (named polls only) ---------- */
async function renderUser(v){
  const nick=S.userNick;
  v.innerHTML=`<div style="margin:4px 0 12px"><a class="btn ghost" href="#vote" style="padding-left:0">‹ Back to feed</a></div><div id="up"><p class="status">Loading…</p></div>`;
  let j=null, err=null;
  try{ j=await api("/api/profile/"+encodeURIComponent(nick)); }catch(e){ err=e.message; }
  if(S.view!=="user"||S.userNick!==nick) return;
  const up=$("#up");
  if(!j){ up.innerHTML=`<div class="empty"><h2>Nothing to show</h2><p>${esc(err||"")}</p><a class="btn primary" href="#vote">Back to voting</a></div>`; return; }
  const votes=j.polls.reduce((n,p)=>n+tally(p).t,0);
  up.innerHTML=`<div class="panel" style="display:flex;gap:14px;align-items:center"><span class="avatar" aria-hidden="true">${esc(j.nick.slice(0,1).toUpperCase())}</span><div><h1 class="section-title" style="margin:0">${esc(j.nick)}</h1><p class="note" style="margin:0">${j.polls.length} ${j.polls.length===1?"poll":"polls"} · ${fmt(votes)} votes received</p></div></div>
    <p class="note" style="margin:0 0 12px">Only polls ${esc(j.nick)} chose to post with their name appear here.</p><div class="mine" id="ul"></div>`;
  const ul=$("#ul");
  if(!j.polls.length){ ul.innerHTML=`<div class="empty"><p>You haven’t posted any polls with your name yet. Turn on “Show my nickname” when you ask.</p></div>`; return; }
  for(const p of j.polls){
    upsert(p); const t=tally(p), done=!!myPick(p)||isClosed(p)||isOwner(p);
    const el=document.createElement("a"); el.className="mi"; el.href="#poll-"+p.id; el.style.display="block"; el.style.textDecoration="none"; el.style.color="inherit";
    el.innerHTML=`<div class="meta"><span class="cat">${catOf(p.cat).e} ${esc(catOf(p.cat).name)}</span>${isOpenTimed(p)?`<span class="tag debate">⏳ ${left(p.endsAt)}</span>`:""}<span class="spacer"></span><span>${ago(p.ts)}</span></div>
      <h2 class="q" style="font-size:1.1rem;margin-bottom:8px">${esc(p.q)}</h2>
      <div class="actions" style="margin:0"><span class="note" style="margin:0">${fmt(t.t)} ${t.t===1?"vote":"votes"}</span><span class="spacer"></span><span class="btn ${done?"":"accent"}" style="padding:7px 14px">${myPick(p)?"You voted ✓":isClosed(p)?"See result":isOwner(p)?"Your poll":"Vote"}</span></div>`;
    ul.appendChild(el);
  }
}

/* ---------- Me ---------- */
function renderMe(v){
  const acc=ME.votes?Math.round(ME.matches*100/ME.votes):0, st=streak();
  const badges=[["First vote",ME.votes>=1],["10 votes",ME.votes>=10],["50 votes",ME.votes>=50],["3-day streak",st>=3],["7-day streak",st>=7],["Crowd whisperer",ME.votes>=20&&acc>=70],["Contrarian",ME.votes>=20&&acc<40],["Asked the crowd",S.polls.some(isOwner)]];
  v.innerHTML=`<h1 class="section-title">Your stats</h1><p class="sub">You’re anonymous. Nobody sees these numbers but you.</p>
  ${S.me.loggedIn?`<div class="panel"><h3>Account</h3><p class="note" style="margin:0 0 10px">Logged in as ${esc(S.me.nick)} (${esc(S.me.email)}). Your email is never shown to anyone.</p><div class="actions" style="margin:0"><a class="btn" href="#u-${encodeURIComponent(S.me.nick)}">My public profile</a><button class="btn" id="logout">Log out</button></div></div>`:`<div class="lock"><p><b>Not logged in.</b> Log in with your email to get ${SIGNUP_BONUS} credits for asking.</p><button class="btn accent" id="suMe">Log in</button></div>`}
  <div class="stats">
    <div class="stat"><b>${S.me.loggedIn?S.me.credits:0}</b><span>Credits to spend</span></div>
    <div class="stat"><b>${ME.votes}</b><span>Votes cast</span></div>
    <div class="stat"><b>${st}</b><span>Day streak</span></div>
    <div class="stat"><b>${acc}%</b><span>Agreed with the crowd</span></div>
  </div>
  ${S.me.loggedIn&&S.me.referrals?(()=>{const R=S.me.referrals; return `<div class="panel"><h3>Invite friends</h3>
    <p class="note" style="margin:0 0 10px">Every link you share carries your invite. When a friend signs up and casts ${R.need} votes, you get <b>${R.reward} credits</b> and they get ${R.welcome} extra.</p>
    <div class="stats" style="margin-bottom:10px"><div class="stat"><b>${R.joined}</b><span>Friends joined</span></div><div class="stat"><b>${R.earned}</b><span>Credits earned</span></div></div>
    ${R.pending?`<p class="note" style="margin:0 0 10px">${R.pending} ${R.pending===1?"friend has":"friends have"} signed up and ${R.pending===1?"is":"are"} still voting.</p>`:""}
    ${R.invitedBy&&!R.invitedBy.done?`<p class="note" style="margin:0 0 10px">${esc(R.invitedBy.nick)} invited you. Cast ${Math.max(0,R.need-(S.me.votesCast||0))} more votes to send them their bonus.</p>`:""}
    <button class="btn accent" id="meInvite">Share invite link</button></div>`;})():""}
  <div class="panel"><h3>App and notifications</h3>
    <p class="note" style="margin:0 0 10px">${isStandalone()?"You’re using the installed app.":"Add Get Opinion to your home screen to open it like an app."}${(()=>{const st=pushState();return st==="on"?" Notifications are on: you’ll hear when your polls get votes and when verdicts land.":st==="denied"?" Notifications are blocked in your browser’s site settings.":st==="ios-install"?" On iPhone, add it to your Home Screen first to get notifications.":st==="unsupported"?" This browser can’t show notifications.":" Notifications are off. They’re only ever on if you turn them on: we’ll tell you when your polls get votes and when verdicts land. No emails, no marketing.";})()}</p>
    <div class="actions" style="margin:0">${canInstall()?`<button class="btn accent" id="meInst">📲 Add to home screen</button>`:""}${pushState()==="on"?`<button class="btn" id="meOff">Turn off notifications</button>`:["off","ios-install"].includes(pushState())?`<button class="btn" id="meOn">🔔 Turn on notifications</button>`:""}</div></div>
  <div class="panel"><h3>Badges</h3><div class="badges">${badges.map(([n,on])=>`<span class="badge ${on?"on":""}">${on?"✓ ":""}${n}</span>`).join("")}</div></div>
  <div class="panel"><h3>How credits work</h3><p class="note" style="margin:0">Voting is open to everyone. Logging in with your email gives you ${SIGNUP_BONUS} credits, every vote while logged in earns 1 more, and posting costs ${POST_COST} for a text poll or ${PHOTO_COST} for a photo poll.</p></div>
  <div class="panel"><h3>Community rules</h3>
    <ul class="rules"><li>No nudity, sexual content or graphic images.</li><li>Only post photos you took or have the right to share. Anyone recognisable must have agreed.</li><li>No insults, hate or harassment, including in debate names.</li><li>No phone numbers, emails, links or ID documents.</li></ul>
    <p class="note">Text is checked automatically before posting, and photos are screened for nudity and unsafe content. Polls reported by 3 people are hidden until reviewed.</p></div>
  <div class="panel"><h3>About you <span class="note">(optional)</span></h3><p class="note" style="margin:0 0 10px">${ME.g||ME.age?`${[AGE_OPTS.find(o=>o[0]===ME.age)?.[1],G_OPTS.find(o=>o[0]===ME.g)?.[1]].filter(x=>x&&x!=="Prefer not to say").join(" · ")||"Prefer not to say"}. Used only to show how groups voted, never linked to your account.`:"Add your age group and gender to be counted in “how groups voted”. Never linked to your account."}</p>
    <div class="actions" style="margin:0"><button class="btn" id="meDemo">${ME.g||ME.age?"Edit":"Add"}</button>${ME.g||ME.age?`<button class="btn ghost" id="meDemoClr">Clear</button>`:""}</div></div>
  <div class="panel"><h3>Feedback and help</h3><p class="note" style="margin:0 0 10px">Ideas, complaints, something broken, or a question about your data? It goes straight to the Get Opinion team.</p>
    <div class="actions" style="margin:0"><button class="btn" id="meFb">Send feedback or a complaint</button>${INSTAGRAM?`<a class="btn" href="https://instagram.com/${esc(INSTAGRAM)}" target="_blank" rel="noopener">Follow on Instagram</a>`:""}${S.me.admin?`<a class="btn primary" href="#admin">Open admin</a>`:""}</div></div>
  <div class="panel"><h3>Privacy</h3><p class="note" style="margin:0 0 10px">Your votes are anonymous and never linked to your email or account. Read what’s stored and why.</p>
    <div class="actions" style="margin:0"><button class="btn" id="mePriv">Privacy note</button><button class="btn" id="meTerms">Terms</button>${S.me.loggedIn?`<button class="btn ghost" id="meDel" style="color:var(--danger)">Delete my account</button>`:""}</div></div>
  <button class="btn ghost" id="resetMe">Reset my stats on this device</button>`;
  $("#mePriv").onclick=()=>openPrivacy();
  $("#meTerms").onclick=()=>openTerms();
  $("#meDemo").onclick=()=>openDemo(true);
  $("#meFb").onclick=()=>openFeedback();
  $("#meDemoClr")&&($("#meDemoClr").onclick=()=>{ ME.g=""; ME.age=""; saveMe(); toast("Cleared"); render(); });
  $("#meInvite")&&($("#meInvite").onclick=async()=>{
    const link=location.origin+"/?r="+S.me.refCode, text=`Settle debates and get honest A/B opinions on Get Opinion. Join with my link and we both get bonus credits: ${link}`;
    if(navigator.share){ try{ await navigator.share({text}); return; }catch(e){ if(e.name==="AbortError") return; } }
    const ok=await copyText(text); toast(ok?"Invite copied. Paste it in WhatsApp!":"Couldn’t copy. Your link: "+link);
  });
  $("#meDel")&&($("#meDel").onclick=confirmDelete);
  $("#suMe")&&($("#suMe").onclick=()=>openLogin());
  $("#meInst")&&($("#meInst").onclick=doInstall);
  $("#meOn")&&($("#meOn").onclick=async()=>{ if(await enablePush()) render(); });
  $("#meOff")&&($("#meOff").onclick=async()=>{ await disablePush(); render(); });
  $("#logout")&&($("#logout").onclick=async()=>{ try{ await api("/api/auth/logout",{method:"POST"}); }catch{} S.me={loggedIn:false,credits:0}; toast("Logged out"); await refresh(); syncPush(); });
  $("#resetMe").onclick=()=>{ if(confirm("Reset streak and stats on this device? Your account and credits stay.")){ ME=Object.assign({},DEFAULT_ME,{onboarded:true}); saveMe(); render(); } };
}

/* ---------- Sheets ---------- */
function openSheet(html){ $("#sheet").innerHTML=`<div class="grab"></div>`+html; $("#scrim").classList.add("open"); const f=$("#sheet").querySelector("input,button"); f?.focus(); }
function closeSheet(){ $("#scrim").classList.remove("open"); }
$("#scrim").addEventListener("click",e=>{ if(e.target.id==="scrim") closeSheet(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeSheet(); });

/* ---------- Email login ---------- */
function openLogin(){
  if(S.me.loggedIn){ toast("You’re already logged in"); return; }
  openSheet(`<h2>Log in with your email</h2><p class="sub">We’ll email you a 6-digit code. New here? You get ${SIGNUP_BONUS} credits to ask the crowd. Voting never needs an account.</p>
    <label class="lbl" for="em">Email</label><input class="field" id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">
    <p class="note">Your email is only used to log you in. It’s never shown on polls or linked to your votes. <button class="btn ghost" id="lPriv" style="padding:0;font-size:inherit;text-decoration:underline">Privacy note</button></p>
    <p class="err" id="lerr" role="alert"></p>
    <button class="btn primary block" id="lgo" style="padding:13px;margin-top:6px">Send code</button>`);
  const go=async()=>{
    const email=$("#em").value.trim(), e=$("#lerr"), btn=$("#lgo"); e.textContent="";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ e.textContent="Enter a valid email address."; return; }
    btn.disabled=true; btn.textContent="Sending…";
    try{ const j=await api("/api/auth/request",{method:"POST",body:{email}}); codeStep(email,j); }
    catch(err){ btn.disabled=false; btn.textContent="Send code"; e.textContent=err.message; }
  };
  $("#lgo").onclick=go; $("#em").onkeydown=e=>{ if(e.key==="Enter") go(); };
  $("#lPriv").onclick=()=>openPrivacy(true);
}
function codeStep(email,j){
  openSheet(`<h2>Check your email</h2><p class="sub">We sent a 6-digit code to ${esc(email)}. It expires in 10 minutes.</p>
    <p class="note" style="margin:-8px 0 12px">Can’t find it? Check your <b>Spam</b> or <b>Promotions</b> folder. It comes from <b>Get Opinion</b> (${esc(CONTACT_EMAIL||"our team")}). Marking it “Not spam” helps future codes arrive.</p>
    ${j.devCode?`<p class="lock" style="display:block"><b>Test mode:</b> no email service is set up yet, so here’s your code: <b>${esc(j.devCode)}</b></p>`:""}
    <label class="lbl" for="cd">Code</label><input class="field" id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="letter-spacing:.3em;font-size:1.3rem">
    ${j.isNew?`<label class="lbl" for="nk" style="margin-top:12px">Pick a nickname</label><input class="field" id="nk" maxlength="24" placeholder="Only you see this">
    <label class="check"><input type="checkbox" id="agree"><span>I’m 18 or older and agree to the <button class="btn ghost" type="button" id="cTerms" style="padding:0;font-size:inherit;text-decoration:underline">Terms</button> and <button class="btn ghost" type="button" id="cPriv" style="padding:0;font-size:inherit;text-decoration:underline">Privacy note</button>.</span></label>`:""}
    <p class="err" id="cerr" role="alert"></p>
    <button class="btn primary block" id="cgo" style="padding:13px;margin-top:6px">${j.isNew?`Create account and get ${SIGNUP_BONUS} credits`:"Log in"}</button>
    <button class="btn ghost block" id="resend" disabled>Resend code in 60s</button>`);
  let left=60; const rs=$("#resend"); const tm=setInterval(()=>{ left--; if(left<=0){ clearInterval(tm); rs.disabled=false; rs.textContent="Resend code"; } else rs.textContent=`Resend code in ${left}s`; },1000);
  rs.onclick=async()=>{ rs.disabled=true; try{ const k=await api("/api/auth/request",{method:"POST",body:{email}}); clearInterval(tm); codeStep(email,k); toast("New code sent"); }catch(e){ $("#cerr").textContent=e.message; rs.disabled=false; } };
  const go=async()=>{
    const code=$("#cd").value.replace(/\D/g,""), e=$("#cerr"), btn=$("#cgo"); e.textContent="";
    if(code.length!==6){ e.textContent="Enter the 6-digit code from the email."; return; }
    let nick;
    if(j.isNew){ nick=$("#nk").value.trim(); if(nick.length<2){ e.textContent="Pick a nickname of at least 2 characters."; return; } if(screenText(nick)){ e.textContent="Pick a different nickname."; return; } if(!$("#agree").checked){ e.textContent="Confirm you’re 18 or older and agree to the Terms to continue."; return; } }
    btn.disabled=true;
    try{
      const r=await api("/api/auth/verify",{method:"POST",body:{email,code,nick,ref:lsGet("go-ref",""),adult:j.isNew?!!$("#agree")?.checked:undefined}});
      clearInterval(tm); closeSheet(); S.me=r.me;
      toast(r.bonus?`Welcome! +${r.bonus+(r.refBonus||0)} credits${r.refBonus?" (incl. "+r.refBonus+" from your friend’s invite)":""}`:`Welcome back, ${r.me.nick}`);
      await refresh(); syncPush();
    }catch(err){ btn.disabled=false; e.textContent=err.message; }
  };
  $("#cgo").onclick=go; $("#cd").onkeydown=e=>{ if(e.key==="Enter") go(); };
  const back=()=>codeStep(email,j);
  $("#cTerms")&&($("#cTerms").onclick=()=>openTerms(back));
  $("#cPriv")&&($("#cPriv").onclick=()=>openPrivacy(false,back));
}

/* ---------- Privacy ---------- */
function openPrivacy(fromLogin,onBack){
  openSheet(`<h2>Privacy note</h2><p class="sub">Plain and short: what Get Opinion stores, and why.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">If you log in</h3>
  <p class="note" style="margin:0">Your email, to send login codes. Your nickname and credits. None of this is ever shown to other people.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Polls you post</h3>
  <p class="note" style="margin:0">Your question, options and any photos (resized on your phone first). Public polls never show who posted them.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Your votes</h3>
  <p class="note" style="margin:0">Saved with a random ID kept in your browser, not with your account or email, so votes can’t be traced back to you.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Emails</h3>
  <p class="note" style="margin:0">We email you only the login code you ask for. Nothing else, ever: no newsletters, no marketing.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Notifications</h3>
  <p class="note" style="margin:0">Off unless you turn them on. If you do, your browser gives us a device address. It’s linked to your account only to tell you about your own polls. Result alerts for polls you voted on don’t record your vote.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Age and gender (optional)</h3>
  <p class="note" style="margin:0">Only if you add them. They’re kept on your phone and attached to your votes on public polls as a group label, never to your account or email. A group’s results only show once at least 20 people from that group have voted, and never on private polls.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Leaderboards</h3>
  <p class="note" style="margin:0">The voter leaderboard counts how many votes you cast while logged in, never what you picked. Your nickname shows there only if you turn it on.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Reports and stats</h3>
  <p class="note" style="margin:0">Reports are anonymous. Streaks and badges stay on your device.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">What we don’t do</h3>
  <p class="note" style="margin:0">No ad tracking, no selling data, no contacts, no location.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Where it’s kept</h3>
  <p class="note" style="margin:0">With our hosting and database providers (Vercel and Neon). Login emails are sent through Resend.</p>
  <h3 style="font-size:1rem;margin:12px 0 4px">Deleting your data</h3>
  <p class="note" style="margin:0">Use <b>Delete my account</b> in Me. It removes your email, nickname, credits and every poll you posted, with its photos and votes. Votes you cast stay as anonymous counts.${CONTACT_EMAIL?` Questions: ${esc(CONTACT_EMAIL)}`:""}</p>
  <button class="btn primary block" id="pOk" style="margin-top:16px">${fromLogin||onBack?"Back":"Done"}</button>`);
  $("#pOk").onclick=()=>{ if(onBack) onBack(); else if(fromLogin) openLogin(); else closeSheet(); };
}
function confirmDelete(){
  openSheet(`<h2>Delete your account?</h2><p class="sub">This removes your email, nickname, credits and every poll you posted, including photos and their votes. It can’t be undone.</p>
  <label class="lbl" for="delc">Type DELETE to confirm</label><input class="field" id="delc" autocomplete="off">
  <p class="err" id="derr" role="alert"></p>
  <button class="btn block" id="dGo" style="margin-top:8px;background:var(--danger);color:#fff;border-color:var(--danger)">Delete my account</button>
  <button class="btn ghost block" id="dNo">Cancel</button>`);
  $("#dNo").onclick=closeSheet;
  $("#dGo").onclick=async()=>{
    if($("#delc").value.trim().toUpperCase()!=="DELETE"){ $("#derr").textContent="Type DELETE to confirm."; return; }
    $("#dGo").disabled=true;
    try{ await api("/api/account",{method:"DELETE"}); closeSheet(); S.me={loggedIn:false,credits:0}; toast("Your account has been deleted"); await refresh(); syncPush(); }
    catch(e){ $("#dGo").disabled=false; $("#derr").textContent=e.message; }
  };
}

/* ---------- Full-size photo viewer ---------- */
function viewPhotos(p,start){
  const both=[["a",p.ai,p.a],["b",p.bi,p.b]];
  openSheet(`<h2>${esc(p.q)}</h2><div class="viewer">${both.map(([k,src,lab])=>`<figure id="vw-${k}"><span class="vtag ${k}">${k.toUpperCase()}</span><img src="${esc(src)}" alt="Option ${k.toUpperCase()}${lab?": "+esc(lab):""}" draggable="false"><figcaption>${esc(lab||"Option "+k.toUpperCase())}</figcaption></figure>`).join("")}</div>
    <button class="btn primary block" id="vwOk" style="margin-top:12px">Back to voting</button>`);
  $("#vwOk").onclick=closeSheet;
  setTimeout(()=>$("#vw-"+start)?.scrollIntoView({block:"start"}),50);
}

/* ---------- About ---------- */
function renderAbout(v){
  v.innerHTML=`<div style="margin:4px 0 12px"><a class="btn ghost" href="#vote" style="padding-left:0">‹ Back to voting</a></div>
  <div class="panel" style="display:flex;gap:14px;align-items:center"><span class="mark" aria-hidden="true" style="width:52px;height:52px;border-radius:14px"><i style="font-size:1.2rem">A</i><i style="font-size:1.2rem">B</i></span><div><h1 class="section-title" style="margin:0">About Get Opinion</h1><p class="note" style="margin:0">Honest answers from strangers, in two taps.</p></div></div>
  <div class="panel"><h3>Why it exists</h3><p class="note" style="margin:0">Friends and family are kind, biased, or both. When you’re stuck between two haircuts, two outfits, two job offers, or you and a friend just can’t agree, Get Opinion puts both options in front of people who have no reason to sugarcoat it.</p></div>
  <div class="panel"><h3>How it stays honest</h3><ul class="rules"><li>Votes are anonymous. Nobody, including us, can see who picked what.</li><li>Voting needs no account. Posting needs an email login, so we can keep out spam and abuse.</li><li>Every poll is screened for abusive words and personal details, photos are checked for nudity, and anyone can report a poll.</li><li>Vote counts are real. Starter polls are marked, and they show only real votes.</li></ul></div>
  <div class="panel"><h3>Who’s behind it</h3><p class="note" style="margin:0 0 10px">Get Opinion is an independent project made in India${MADE_BY?` by ${esc(MADE_BY)}`:""}. It’s free, with no ads and no selling of data.</p>
    <div class="actions" style="margin:0">${CONTACT_EMAIL?`<a class="btn" href="mailto:${esc(CONTACT_EMAIL)}">Email us</a>`:""}<button class="btn" id="abFb">Send feedback</button>${INSTAGRAM?`<a class="btn" href="https://instagram.com/${esc(INSTAGRAM)}" target="_blank" rel="noopener">Instagram</a>`:""}</div></div>
  <div class="actions" style="justify-content:center"><button class="btn ghost" id="abTerms">Terms</button><button class="btn ghost" id="abPriv">Privacy</button></div>`;
  $("#abFb").onclick=()=>openFeedback(); $("#abTerms").onclick=()=>openTerms(); $("#abPriv").onclick=()=>openPrivacy();
}

/* ---------- Terms of use ---------- */
function openTerms(onBack){
  const h=t=>`<h3 style="font-size:1rem;margin:12px 0 4px">${t}</h3>`, p=t=>`<p class="note" style="margin:0">${t}</p>`;
  openSheet(`<h2>Terms of use</h2><p class="sub">Short and plain. Using Get Opinion means you agree to these.</p>
  ${h("Who can use it")}${p("You must be 18 or older to create an account. Anyone can vote, but please don’t post if you’re under 18.")}
  ${h("Your posts")}${p("You’re responsible for what you post. You keep ownership of your questions and photos, and you let Get Opinion show them in the app, in share previews and in results.")}
  ${h("Not allowed")}${p("Nudity or sexual content. Hate, harassment, bullying or threats. Photos of anyone without their permission, or of children. Other people’s personal details, phone numbers or ID. Spam, scams, links or ads. Anything illegal or pretending to be someone else.")}
  ${h("What we can do")}${p("We can hide or remove any poll, and block accounts that break these rules, with or without warning. Polls reported by several people are hidden automatically until we review them.")}
  ${h("Opinions, not advice")}${p("Results are the crowd’s opinion, not professional advice. Decisions you make are your own.")}
  ${h("Credits")}${p("Credits are for posting polls in the app only. They have no cash value, can’t be sold or transferred, and we may change how they work.")}
  ${h("Changes")}${p("We may update these terms. If you keep using Get Opinion after a change, you accept the new version.")}
  ${h("Contact")}${p(`Questions or complaints? Use <b>Send feedback</b> in Me${CONTACT_EMAIL?` or email ${esc(CONTACT_EMAIL)}`:""}. These terms are governed by the laws of India.`)}
  <button class="btn primary block" id="tOk" style="margin-top:16px">${onBack?"Back":"Done"}</button>`);
  $("#tOk").onclick=()=>{ if(onBack) onBack(); else closeSheet(); };
}

/* ---------- Feedback ---------- */
function openFeedback(opts={}){
  let kind=opts.kind||"feedback";
  const kinds=[["feedback","💡 Feedback"],["complaint","⚠️ Complaint"],["bug","🐞 Something’s broken"],["data","🔒 My data / privacy"]];
  openSheet(`<h2>Send feedback</h2><p class="sub">Goes straight to the Get Opinion team. We read everything.</p>
    <div class="chips" style="flex-wrap:wrap;margin:0;padding:0 0 12px">${kinds.map(([k,l])=>`<button class="chip" data-k="${k}" aria-pressed="${k===kind}">${l}</button>`).join("")}</div>
    <label class="lbl" for="fbm">Message</label><textarea class="field" id="fbm" maxlength="2000" placeholder="Tell us what’s on your mind">${esc(opts.message||"")}</textarea>
    <label class="lbl" for="fbe" style="margin-top:12px">Your email, if you’d like a reply <span class="note">(optional)</span></label>
    <input class="field" id="fbe" type="email" inputmode="email" value="${esc(S.me.email||"")}" placeholder="you@example.com">
    <p class="err" id="fberr" role="alert"></p>
    <button class="btn primary block" id="fbgo" style="padding:13px;margin-top:6px">Send</button>
    <button class="btn ghost block" id="fbx">Cancel</button>`);
  const sh=$("#sheet");
  sh.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{ kind=b.dataset.k; sh.querySelectorAll("[data-k]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); });
  $("#fbx").onclick=closeSheet;
  $("#fbgo").onclick=async()=>{ const btn=$("#fbgo"); btn.disabled=true;
    try{ await api("/api/feedback",{method:"POST",body:{kind,message:$("#fbm").value,email:$("#fbe").value.trim(),pollId:opts.pollId}}); closeSheet(); toast("Thanks! We got your message."); }
    catch(e){ btn.disabled=false; $("#fberr").textContent=e.message; } };
}

/* ---------- Admin ---------- */
async function renderAdmin(v){
  if(!S.me.admin){ v.innerHTML=`<div class="empty"><h2>Admins only</h2><p>Log in with an admin email to see this page.</p><a class="btn primary" href="#vote">Back to voting</a></div>`; return; }
  v.innerHTML=`<div class="actions" style="margin-top:4px;margin-bottom:8px"><h1 class="section-title" style="margin:0">Admin</h1><span class="spacer"></span><button class="btn" id="adR">Refresh</button></div><div id="adm"><p class="status">Loading…</p></div>`;
  $("#adR").onclick=()=>renderAdmin(v);
  let j; try{ j=await api("/api/admin/overview"); }catch(e){ $("#adm").innerHTML=`<p class="status">${esc(e.message)}</p>`; return; }
  if(S.view!=="admin") return;
  const st=j.stats, d=t=>new Date(t).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
  const stat=(n,l)=>`<div class="stat"><b>${fmt(n||0)}</b><span>${l}</span></div>`;
  const act=async(path,body,msg)=>{ try{ await api(path,{method:"POST",body}); toast(msg); renderAdmin(v); }catch(e){ toast(e.message); } };
  $("#adm").innerHTML=`
    <h3 class="section-title" style="font-size:1.1rem">Today · last 7 days</h3>
    <div class="stats">${stat(st.voters_1d,"Voters today")}${stat(st.voters_7d,"Voters, 7 days")}${stat(st.votes_1d,"Votes today")}${stat(st.votes_7d,"Votes, 7 days")}${stat(st.users_1d,"Sign-ups today")}${stat(st.users_7d,"Sign-ups, 7 days")}${stat(st.polls_1d,"Polls today")}${stat(st.polls_7d,"Polls, 7 days")}</div>
    <div class="stats">${stat(st.first_day_votes,"Avg votes per new poll, day 1")}${stat(st.referrals,"Referrals paid")}${stat(st.push,"Notifications on")}${stat(st.users,"Total accounts")}${stat(st.polls,"Total polls")}${stat(st.votes,"Total votes")}${stat(st.private_polls,"Private polls")}${stat(st.blocked,"Blocked accounts")}</div>
    <div class="panel"><h3>Categories, last 30 days</h3>${j.cats.length?j.cats.map(c=>`<div class="grow"><span class="gl">${catOf(c.cat).e} ${esc(catOf(c.cat).name).split(" ")[0]}</span><span class="gb"><span class="sa" style="width:${Math.round(c.n*100/Math.max(...j.cats.map(x=>x.n)))}%"></span></span><span class="gp">${c.n}</span></div>`).join(""):`<p class="note">No polls yet.</p>`}</div>
    <div class="panel"><h3>Reported polls (${j.reported.length})</h3><p class="note" style="margin:0 0 10px">Hidden automatically at ${j.flagHide} reports. Keep it to clear the reports and show it again.</p><div id="adRep"></div></div>
    <div class="panel"><h3>Feedback and complaints (${j.feedback.length})</h3><div id="adFb"></div></div>
    <div class="panel"><h3>Latest polls</h3><div id="adNew"></div></div>`;
  const rep=$("#adRep");
  rep.innerHTML=j.reported.length?"":`<p class="note">Nothing reported. 🎉</p>`;
  for(const p of j.reported){
    const el=document.createElement("div"); el.className="mi"; el.style.marginBottom="10px";
    el.innerHTML=`<div class="meta">${p.review?`<span class="tag debate">Photo auto-check</span>`:""}<span class="tag">${p.reports} ${p.reports===1?"report":"reports"}</span>${p.reports>=(p.review?1:j.flagHide)?`<span class="tag debate">Hidden</span>`:""}<span class="tag">${p.vis==="private"?"Private":"Public"}</span><span class="spacer"></span><span>${d(p.last_report)}</span></div>
      <h2 class="q" style="font-size:1.05rem;margin-bottom:4px">${esc(p.q)}</h2>
      <p class="note" style="margin:0 0 4px">${p.kind==="image"?`<a href="#poll-${esc(p.id)}">View photos</a>`:`${esc(p.a)} vs ${esc(p.b)}`} · by ${esc(p.owner||"starter poll")}${p.owner_blocked?" (blocked)":""}</p>
      <p class="note" style="margin:0 0 8px">Reasons: ${esc((p.reasons||[]).join(", ")||"none given")}</p>
      <div class="actions" style="margin:0"><button class="btn" data-x="keep">Keep</button><button class="btn" data-x="del" style="color:var(--danger)">Delete poll</button>${p.owner&&!p.owner_blocked?`<button class="btn ghost" data-x="block" style="color:var(--danger)">Block poster</button>`:""}</div>`;
    el.querySelector('[data-x="keep"]').onclick=()=>act("/api/admin/poll",{id:p.id,action:"restore"},"Kept and reports cleared");
    el.querySelector('[data-x="del"]').onclick=()=>{ if(confirm("Delete this poll for everyone?")) act("/api/admin/poll",{id:p.id,action:"delete"},"Poll deleted"); };
    el.querySelector('[data-x="block"]')&&(el.querySelector('[data-x="block"]').onclick=()=>{ if(confirm(`Block ${p.owner}? They’ll be logged out and can’t log in again.`)) act("/api/admin/user",{pollId:p.id,block:true,removePolls:confirm("Also delete all their polls?")},"Account blocked"); });
    rep.appendChild(el);
  }
  const fb=$("#adFb");
  fb.innerHTML=j.feedback.length?"":`<p class="note">No new messages.</p>`;
  const K={feedback:"💡 Feedback",complaint:"⚠️ Complaint",bug:"🐞 Bug",data:"🔒 Data request"};
  for(const m of j.feedback){
    const el=document.createElement("div"); el.className="mi"; el.style.marginBottom="10px";
    el.innerHTML=`<div class="meta"><span class="tag">${K[m.kind]||m.kind}</span><span>${esc(m.nick||"Guest")}</span><span class="spacer"></span><span>${d(m.created_at)}</span></div>
      <p style="margin:0 0 8px;white-space:pre-wrap">${esc(m.message)}</p>${m.poll_id?`<p class="note" style="margin:0 0 8px">About <a href="#poll-${esc(m.poll_id)}">this poll</a></p>`:""}
      <div class="actions" style="margin:0">${m.reply_to?`<a class="btn" href="mailto:${esc(m.reply_to)}?subject=${encodeURIComponent("Re: your Get Opinion message")}">Reply</a>`:`<span class="note">No reply email</span>`}<button class="btn ghost" data-x="done">Mark done</button></div>`;
    el.querySelector('[data-x="done"]').onclick=()=>act("/api/admin/feedback",{id:m.id},"Marked done");
    fb.appendChild(el);
  }
  const nw=$("#adNew");
  nw.innerHTML=j.recent.length?`<div class="board">${j.recent.map(p=>`<div class="brow"><span class="who2"><b><a href="#poll-${esc(p.id)}" style="color:inherit">${esc(p.q)}</a></b><span>${catOf(p.cat).e} ${p.vis==="private"?"Private · ":""}by ${esc(p.owner||"?")}${p.owner_blocked?" (blocked)":""} · ${d(p.created_at)}</span></span><span class="num">${p.votes}</span><button class="btn ghost" data-del="${esc(p.id)}" aria-label="Delete poll" style="padding:6px 8px">🗑</button></div>`).join("")}</div>`:`<p class="note">No polls yet.</p>`;
  nw.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{ if(confirm("Delete this poll for everyone?")) act("/api/admin/poll",{id:b.dataset.del,action:"delete"},"Poll deleted"); });
}

/* ---------- About you (optional) ---------- */
const G_OPTS=[["w","Woman"],["m","Man"],["nb","Non-binary"],["","Prefer not to say"]];
const AGE_OPTS=[["18-24","18–24"],["25-34","25–34"],["35-44","35–44"],["45+","45+"],["","Prefer not to say"]];
function openDemo(fromMe){
  ME.demoAsked=true; saveMe();
  let g=ME.g||"", age=ME.age||"";
  const chips=(opts,cur,key)=>opts.map(([v,l])=>`<button class="chip" data-${key}="${v}" aria-pressed="${cur===v}">${l}</button>`).join("");
  openSheet(`<h2>${fromMe?"About you":"Help us show how groups voted?"}</h2>
    <p class="sub">Optional. After you vote, see splits like “Women picked A 64%”. Saved on your phone and added to your votes as a group, never linked to your account or email.</p>
    <label class="lbl">Age</label><div class="chips" style="flex-wrap:wrap;margin:0;padding:0 0 12px">${chips(AGE_OPTS,age,"age")}</div>
    <label class="lbl">Gender</label><div class="chips" style="flex-wrap:wrap;margin:0;padding:0 0 12px">${chips(G_OPTS,g,"g")}</div>
    <button class="btn primary block" id="dmSave" style="padding:13px">Save</button>
    <button class="btn ghost block" id="dmSkip">${fromMe?"Cancel":"Not now"}</button>`);
  const sheet=$("#sheet");
  sheet.querySelectorAll("[data-age]").forEach(b=>b.onclick=()=>{ age=b.dataset.age; sheet.querySelectorAll("[data-age]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); });
  sheet.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{ g=b.dataset.g; sheet.querySelectorAll("[data-g]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); });
  $("#dmSave").onclick=()=>{ ME.g=g; ME.age=age; saveMe(); closeSheet(); toast(g||age?"Thanks! Your next votes will count in group results.":"Saved. You won’t be counted in group results."); if(S.view==="me") render(); };
  $("#dmSkip").onclick=closeSheet;
}

/* ---------- Report ---------- */
function openFlag(p){
  openSheet(`<h2>Report this poll</h2><p class="sub">Reports are anonymous. The poll disappears from your feed right away.</p>
  <div class="prompts">${["Nudity or sexual content","Abusive or hateful","Photo posted without consent","Spam or scam","Something else"].map(r=>`<button class="prompt" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>
  <button class="btn ghost block" style="margin-top:10px" id="fbMore">Tell us more by message</button>
  <button class="btn ghost block" id="cx">Cancel</button>`);
  $("#cx").onclick=closeSheet;
  $("#fbMore").onclick=()=>openFeedback({kind:"complaint",pollId:p.id,message:`About the poll “${p.q}”: `});
  $("#sheet").querySelectorAll("[data-r]").forEach(b=>b.onclick=async()=>{
    closeSheet(); upsert({...p,hidden:true});
    try{ await api("/api/flag",{method:"POST",body:{id:p.id,reason:b.dataset.r}}); }catch{}
    toast("Thanks. We’ve hidden it for you."); S.current=null; if(S.view==="poll") location.hash="vote"; else render();
  });
}

/* ---------- Share ---------- */
const shareLink = p => location.origin+"/p/"+p.id+(S.me.refCode?"?r="+S.me.refCode:"");
function hooks(p){
  if(isOpenTimed(p)) return [`Results drop in ${left(p.endsAt)} ⏳ Lock in your pick:`, p.cat==="debate"&&p.an&&p.bn?`${p.an} vs ${p.bn}. Vote before it closes.`:`Settle this before voting closes: ${p.q}`, `Anonymous. Takes 2 seconds. Results in ${left(p.endsAt)}.`];
  if(p.cat==="debate"&&p.an&&p.bn) return [`${p.an} vs ${p.bn}. Settle it for us 👀`,`We can’t agree: ${p.q} Pick a side.`,`Loser buys dinner. Who’s right?`];
  return [`Settle this for me 👀 A or B?`,`Be brutally honest: ${p.q}`,`I can’t decide. You pick, it’s anonymous.`];
}
async function openShare(p,justPosted,verdictMode){
  const V = verdictMode ? verdictOf(p) : null;
  const link=shareLink(p), hs=V?[`${V.emoji} ${V.headline}! ${p.q} ${V.line}`,`The crowd has spoken: ${V.line}`,`Called it or not? ${p.q} ${V.line}`]:hooks(p);
  openSheet(`<h2>${V?"Share the verdict":justPosted?"Your poll is live":"Share this poll"}</h2>
  <p class="sub" style="margin-bottom:6px">${p.vis==="private"?"Send the link to your group. They vote in two taps, anonymously, no account needed.":"Post it to your Story or Status to pull in fast votes."}</p>
  <div class="story"><canvas id="sc" width="1080" height="1920" aria-label="Story image preview"></canvas></div>
  <div class="share-grid">
    <button class="btn accent" id="shWa">WhatsApp</button>
    <button class="btn accent" id="shIg">Instagram Story</button>
    <button class="btn" id="shCopy">Copy link</button>
    <button class="btn" id="shSave">Save image</button>
  </div>
  <div class="linkbox"><input class="field" id="lk" readonly value="${esc(link)}" aria-label="Poll link"></div>
  <p class="note">${S.me.loggedIn?`🎁 This link carries your invite. Earn ${S.me.referrals?.reward||30} credits for each friend who signs up and casts ${S.me.referrals?.need||5} votes.`:`🎁 Log in before sharing to earn credits when friends join from your link.`}</p>
  <h3 style="margin:16px 0 4px;font-size:1rem">Caption ideas</h3><p class="note" style="margin:0">Tap one to copy it.</p>
  <div class="hooks">${hs.map(h=>`<button class="hook">${esc(h)}</button>`).join("")}</div>
  <button class="btn ghost block" style="margin-top:12px" id="cx">Done</button>`);
  $("#cx").onclick=closeSheet;
  if(justPosted){ const nb=notifyButton("Notify me when my verdict is ready"); if(nb){ nb.querySelector("button").classList.add("block"); $("#sheet").insertBefore(nb,$("#sheet .story")); } }
  const canvas=$("#sc"); if(V) await drawVerdict(canvas,p,V); else await drawStory(canvas,p);
  const blob=()=>new Promise(r=>canvas.toBlob(r,"image/png"));
  const shareText=hs[0]+" "+link;
  $("#sheet").querySelectorAll(".hook").forEach(h=>h.onclick=async()=>{ const ok=await copyText(h.textContent+" "+link); toast(ok?"Caption copied":"Long-press the caption to copy it"); });
  $("#shCopy").onclick=async()=>{ const ok=await copyText(link); if(!ok) $("#lk").select(); toast(ok?"Link copied":"Select the link above to copy it"); };
  $("#shWa").onclick=()=>{ window.open("https://wa.me/?text="+encodeURIComponent(shareText),"_blank","noopener"); };
  const saveImg=async(withText)=>{
    const b=await blob(); const file=new File([b],"get-opinion-story.png",{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){ try{ await navigator.share(withText?{files:[file],text:shareText}:{files:[file]}); return "shared"; }catch(e){ if(e.name==="AbortError") return "aborted"; } }
    const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="get-opinion-story.png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    return "saved";
  };
  $("#shSave").onclick=async()=>{ const r=await saveImg(false); if(r==="saved") toast("Story image saved"); };
  $("#shIg").onclick=async()=>{ await copyText(link); const r=await saveImg(false); if(r!=="aborted") toast("Link copied. Add the image to your Story, then add a link sticker."); };
}

function wrap(ctx,text,maxW){ const words=String(text).split(/\s+/); const lines=[]; let cur=""; for(const w of words){ const t=cur?cur+" "+w:w; if(ctx.measureText(t).width>maxW&&cur){ lines.push(cur); cur=w; } else cur=t; } if(cur) lines.push(cur); return lines; }
function loadImg(src){ return new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; }); }
function rr(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
async function drawVerdict(c,p,V){
  try{ await document.fonts.load("800 80px 'Bricolage Grotesque'"); }catch{}
  const ctx=c.getContext("2d"), F="'Bricolage Grotesque', system-ui, sans-serif";
  ctx.fillStyle="#1B1630"; ctx.fillRect(0,0,1080,1920);
  ctx.save(); ctx.translate(90,150); ctx.rotate(-.14); ctx.fillStyle="#4B2BE8"; rr(ctx,0,0,44,88,14); ctx.fill(); ctx.fillStyle="#FFB01F"; rr(ctx,44,0,44,88,14); ctx.fill(); ctx.fillRect(44,0,10,88); ctx.restore();
  ctx.fillStyle="#fff"; ctx.font=`800 52px ${F}`; ctx.fillText("Get Opinion",210,215);
  ctx.fillStyle="#FFB01F"; ctx.font=`800 46px ${F}`; ctx.fillText("THE VERDICT IS IN",90,360);
  ctx.fillStyle="#fff"; ctx.font=`800 76px ${F}`; let y=470; for(const l of wrap(ctx,p.q,900).slice(0,3)){ ctx.fillText(l,90,y); y+=88; }
  const w=V.side, fill=w==="a"?"#4B2BE8":"#FFB01F", ink=w==="a"?"#fff":"#2A1A00", top=y+40, h=760;
  ctx.save(); rr(ctx,90,top,900,h,48); ctx.clip(); ctx.fillStyle=fill; ctx.fillRect(90,top,900,h);
  const img=p.kind==="image"?await loadImg(w==="a"?p.ai:p.bi):null;
  if(img){ const sc=Math.max(900/img.width,h/img.height); ctx.drawImage(img,90+(900-img.width*sc)/2,top+(h-img.height*sc)/2,img.width*sc,img.height*sc); const g=ctx.createLinearGradient(0,top+h-420,0,top+h); g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,.78)"); ctx.fillStyle=g; ctx.fillRect(90,top+h-420,900,420); }
  const tc=img?"#fff":ink;
  ctx.fillStyle=tc; ctx.font=`800 200px ${F}`; ctx.fillText(V.pct+"%",140,top+h-250);
  ctx.font=`700 58px ${F}`; let ty=top+h-150; for(const l of wrap(ctx,((w==="a"?p.a:p.b)||("Option "+w.toUpperCase()))+" wins",800).slice(0,2)){ ctx.fillText(l,140,ty); ty+=66; }
  ctx.restore();
  ctx.textAlign="center"; ctx.fillStyle="#fff"; ctx.font=`800 52px ${F}`;
  ctx.fillText(p.cat==="debate"&&p.an&&p.bn?`${w==="a"?p.an:p.bn} wins the debate`:`${V.T} people voted`,540,top+h+110);
  ctx.fillStyle="#B9B2CF"; ctx.font=`500 36px ${F}`; ctx.fillText("Ask yours on Get Opinion. Anonymous, 2 seconds.",540,top+h+175); ctx.textAlign="left";
}
async function drawStory(c,p){
  try{ await document.fonts.load("800 80px 'Bricolage Grotesque'"); }catch{}
  const ctx=c.getContext("2d"), F="'Bricolage Grotesque', system-ui, sans-serif";
  ctx.fillStyle="#1B1630"; ctx.fillRect(0,0,1080,1920);
  ctx.save(); ctx.translate(90,150); ctx.rotate(-.14); ctx.fillStyle="#4B2BE8"; rr(ctx,0,0,44,88,14); ctx.fill(); ctx.fillStyle="#FFB01F"; rr(ctx,44,0,44,88,14); ctx.fill(); ctx.fillRect(44,0,10,88); ctx.restore();
  ctx.fillStyle="#fff"; ctx.font=`800 52px ${F}`; ctx.fillText("Get Opinion",210,215);
  const tag = p.cat==="debate"&&p.an&&p.bn ? `${p.an} vs ${p.bn}` : catOf(p.cat).name;
  ctx.font=`600 38px ${F}`; ctx.fillStyle="#B9B2CF"; ctx.fillText(tag,90,340);
  ctx.font=`800 84px ${F}`; ctx.fillStyle="#fff"; let y=440;
  for(const l of wrap(ctx,p.q,900).slice(0,4)){ ctx.fillText(l,90,y); y+=96; }
  const top=Math.max(y+30,780), h=860, w=440;
  for(const [i,s] of [[0,"a"],[1,"b"]]){
    const x=90+i*(w+20); ctx.save(); rr(ctx,x,top,w,h,40); ctx.clip();
    ctx.fillStyle= s==="a"?"#4B2BE8":"#FFB01F"; ctx.fillRect(x,top,w,h);
    if(p.kind==="image"){ const im=await loadImg(s==="a"?p.ai:p.bi); if(im){ const ih=h-200, sc=Math.max(w/im.width,ih/im.height); ctx.drawImage(im,x+(w-im.width*sc)/2,top+(ih-im.height*sc)/2,im.width*sc,im.height*sc); } }
    ctx.fillStyle= s==="a"?"rgba(255,255,255,.35)":"rgba(42,26,0,.35)"; ctx.font=`800 150px ${F}`; if(p.kind!=="image") ctx.fillText(s.toUpperCase(),x+30,top+160);
    ctx.fillStyle= s==="a"?"#fff":"#2A1A00"; ctx.font=`700 50px ${F}`;
    const lines=wrap(ctx,(s==="a"?p.a:p.b)||("Option "+s.toUpperCase()),w-60).slice(0,4);
    let ty=top+h-50-(lines.length-1)*58; for(const l of lines){ ctx.fillText(l,x+30,ty); ty+=58; }
    if(p.cat==="debate"&&(s==="a"?p.an:p.bn)){ ctx.font=`700 36px ${F}`; ctx.fillText(((s==="a"?p.an:p.bn)+"’s side"),x+30,top+h-50-(lines.length)*58-14); }
    ctx.restore();
  }
  ctx.fillStyle="#FFB01F"; ctx.font=`800 56px ${F}`; ctx.textAlign="center";
  ctx.fillText(p.cat==="debate"?"Pick a side. Settle it.":"Tap the link and vote",540,top+h+120);
  ctx.fillStyle="#B9B2CF"; ctx.font=`500 36px ${F}`; ctx.fillText("Anonymous. Takes 2 seconds.",540,top+h+180); ctx.textAlign="left";
}

/* ---------- Install + notifications ---------- */
let installEvt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const canInstall = () => !isStandalone() && (!!installEvt || isIOS());
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; softRender(); });
window.addEventListener("appinstalled", () => { installEvt = null; toast("Get Opinion is on your home screen"); softRender(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

function pushState(){
  if(!pushSupported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if(Notification.permission === "denied") return "denied";
  return ME.push && Notification.permission === "granted" ? "on" : "off";
}
function b64(s){ const p="=".repeat((4-s.length%4)%4); const r=atob((s+p).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(r,c=>c.charCodeAt(0)); }
async function doInstall(){
  if(installEvt){ installEvt.prompt(); await installEvt.userChoice.catch(()=>null); installEvt=null; render(); return; }
  if(isIOS()) openSheet(`<h2>Add to your Home Screen</h2><ol style="padding-left:20px;margin:6px 0 12px"><li style="margin-bottom:8px">Tap the <b>Share</b> button in Safari (the square with an arrow).</li><li style="margin-bottom:8px">Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol><p class="note">On iPhone, notifications work once Get Opinion is on your Home Screen. Open it from there and turn them on in <b>Me</b>.</p><button class="btn primary block" id="okI" style="margin-top:12px">Got it</button>`);
  else openSheet(`<h2>Install Get Opinion</h2><p class="sub">Open your browser menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b>.</p><button class="btn primary block" id="okI">Got it</button>`);
  $("#okI").onclick=closeSheet;
}
async function enablePush(){
  const st=pushState();
  if(st==="ios-install"){ doInstall(); return false; }
  if(st==="unsupported"){ toast("This browser can’t show notifications. Try Chrome."); return false; }
  if(st==="denied"){ toast("Notifications are blocked. Allow them in your browser’s site settings."); return false; }
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){ toast("Notifications not turned on"); return false; }
    const reg=await navigator.serviceWorker.ready;
    const {key}=await api("/api/push/key");
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key)});
    await api("/api/push/subscribe",{method:"POST",body:{sub:sub.toJSON()}});
    ME.push=true; saveMe(); toast("Notifications on 🔔"); return true;
  }catch(e){ toast("Couldn’t turn on notifications. Try again."); return false; }
}
async function disablePush(){
  try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription();
    if(sub){ await api("/api/push/unsubscribe",{method:"POST",body:{endpoint:sub.endpoint}}).catch(()=>{}); await sub.unsubscribe(); } }catch{}
  ME.push=false; saveMe(); toast("Notifications off");
}
async function syncPush(){
  if(!pushSupported()||Notification.permission!=="granted") { if(ME.push){ ME.push=false; saveMe(); } return; }
  try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription();
    ME.push=!!sub; saveMe();
    if(sub) await api("/api/push/subscribe",{method:"POST",body:{sub:sub.toJSON()}});
  }catch{}
}
async function watchPoll(id){
  try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription();
    if(sub) await api("/api/push/watch",{method:"POST",body:{id,endpoint:sub.endpoint}}); }catch{}
}
function notifyButton(label,onDone){
  const st=pushState(); if(st==="on"||st==="unsupported") return null;
  const wrap=document.createElement("div"); wrap.style.marginTop="10px";
  const b=document.createElement("button"); b.className="btn"; b.textContent="🔔 "+label;
  const n=document.createElement("p"); n.className="note"; n.style.margin="6px 0 0"; n.textContent="Only if you say yes. No emails, no marketing. Turn it off anytime in Me.";
  b.onclick=async e=>{ e.stopPropagation(); if(await enablePush()){ wrap.remove(); onDone&&onDone(); } };
  wrap.append(b,n); return wrap;
}

/* ---------- Onboarding ---------- */
function onboard(){
  if(ME.onboarded||location.hash.startsWith("#poll-")) return;
  openSheet(`<h2>Welcome to Get Opinion</h2><p class="sub">Honest answers from strangers, in two taps.</p>
  <ul class="ob" style="padding-left:18px;margin:0 0 16px"><li><b>Vote A or B.</b> Tap, swipe or press a key. No account, nobody knows it’s you.</li><li><b>Ask for free.</b> Log in with your email to get ${SIGNUP_BONUS} credits. Text questions cost ${POST_COST}, photo questions ${PHOTO_COST}.</li><li><b>Settle debates.</b> Arguing with a friend? Put both names on it and let the crowd decide.</li><li><b>Decide as a group.</b> Share a private link with just your friends. Rum or whiskey? The majority wins, and nobody sees who picked what.</li></ul>
  <button class="btn primary block" id="obgo" style="padding:13px">Start voting</button>`);
  $("#obgo").onclick=()=>{ ME.onboarded=true; saveMe(); closeSheet(); };
}

/* ---------- Boot ---------- */
document.querySelectorAll("[data-foot]").forEach(b=>b.onclick=e=>{ const k=b.dataset.foot; if(k==="terms"){ e.preventDefault(); openTerms(); } else if(k==="privacy"){ e.preventDefault(); openPrivacy(); } else if(k==="contact"){ e.preventDefault(); openFeedback(); } });
// discourage saving poll photos: block the right-click / long-press menu and dragging on them
document.addEventListener("contextmenu",e=>{ if(e.target.closest(".side.has-img, .viewer, .tile, .story")) e.preventDefault(); });
document.addEventListener("dragstart",e=>{ if(e.target.tagName==="IMG") e.preventDefault(); });
route(); onboard(); refresh().then(syncPush);
