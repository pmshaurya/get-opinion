"use strict";
/* ---------- Config ---------- */
const POST_COST = 3;
const SIGNUP_BONUS = 100;
const CATS = [
  {id:"design",  name:"Creative & Design",       e:"🎨"},
  {id:"style",   name:"Style & Grooming",         e:"💇"},
  {id:"dating",  name:"Dating & Relationships",   e:"💬"},
  {id:"everyday",name:"Everyday Dilemmas",        e:"🤔"},
  {id:"fun",     name:"Sports & Fun",             e:"🏆"},
  {id:"debate",  name:"Settle a Debate",          e:"⚖️"}
];
const catOf = id => CATS.find(c=>c.id===id) || CATS[3];

/* ---------- Helpers ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n>=1000 ? (n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,"")+"k" : String(n);
const ago = ts => { const m=Math.max(1,Math.round((Date.now()-ts)/60000)); return m<60?m+"m ago":m<1440?Math.round(m/60)+"h ago":Math.round(m/1440)+"d ago"; };
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

/* ---------- Local stats (per device) ---------- */
const DEFAULT_ME = {votes:0,matches:0,days:[],today:{d:"",n:0},alias:"",onboarded:false,skipped:[]};
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
const tally = p => { const a=p.ca||0,b=p.cb||0,t=a+b; const pa=t?Math.round(a*100/t):50; return {a,b,t,pa,pb:t?100-pa:50}; };
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
  else S.view=["ask","mine","me"].includes(h)?h:"vote";
  S.revealing=false; render(); window.scrollTo(0,0);
}
window.addEventListener("hashchange",route);
$("#logoBtn").onclick=()=>{ location.hash="vote"; };

function render(){
  updateChrome();
  const v=$("#view");
  if(S.view==="vote") renderFeed(v);
  else if(S.view==="ask") renderAsk(v);
  else if(S.view==="mine") renderMine(v);
  else if(S.view==="me") renderMe(v);
  else renderPollPage(v);
}

/* ---------- Feed ---------- */
function feedList(){ return S.polls.filter(p=>p.vis!=="private" && !isHidden(p) && !isOwner(p) && (S.cat==="all"||p.cat===S.cat)); }
function nextPoll(){
  const list=feedList().filter(p=>!myPick(p));
  const fresh=list.filter(p=>!ME.skipped.includes(p.id)).sort((x,y)=>(y.seed?0:1)-(x.seed?0:1) || y.ts-x.ts);
  return fresh[0] || list[0] || null;
}
function renderFeed(v){
  const need=Math.max(0,POST_COST-S.me.credits);
  v.innerHTML = `
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
  <div id="slot"></div>`;
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
  if(img) return `<span class="letter">${L}</span><img alt="Option ${L}: ${esc(txt||"photo")}" src="${esc(img)}" draggable="false" loading="lazy"><span class="side-pct-wrap"><span class="pct">0%</span></span><span class="cap">${who?`<span class="who">${esc(who)}’s side</span>`:""}<span class="opt">${esc(txt||"Option "+L)}</span></span>`;
  return `<span class="letter">${L}</span>${who?`<span class="who">${esc(who)}’s side</span>`:""}<span class="opt">${esc(txt)}</span><span class="pct">0%</span>`;
}

function buildCard(p,{feed=false,alias=null}={}){
  const el=document.createElement("article"); el.className="card"; el.dataset.id=p.id;
  const c=catOf(p.cat), t=tally(p), pick=myPick(p), own=isOwner(p);
  el.innerHTML=`
    <div class="meta"><span class="cat">${c.e} ${esc(c.name)}</span>${p.cat==="debate"&&p.an&&p.bn?`<span class="tag debate">${esc(p.an)} vs ${esc(p.bn)}</span>`:""}${!p.seed?`<span class="tag">New</span>`:""}${p.vis==="private"?`<span class="tag">Private</span>`:""}<span class="spacer"></span><span class="count">${fmt(t.t)} ${t.t===1?"vote":"votes"}</span></div>
    <h2 class="q">${esc(p.q)}</h2>
    <div class="split${p.kind==="image"?" imgs":""}" role="group" aria-label="Pick A or B">
      <button class="side side-a${p.kind==="image"?" has-img":""}" data-s="a">${sideHTML(p,"a")}</button>
      <button class="side side-b${p.kind==="image"?" has-img":""}" data-s="b">${sideHTML(p,"b")}</button>
    </div>
    <p class="hint">${pick||own?"":"Tap a side, swipe the card, or press A / B"}</p>
    <p class="verdict" aria-live="polite"></p>
    <div class="actions">
      ${feed?`<button class="btn ghost" data-act="skip">Skip</button>`:""}
      <button class="btn" data-act="share">Share</button>
      ${own?"":`<button class="btn ghost" data-act="flag">Report</button>`}
      ${feed?`<button class="btn primary next" data-act="next" hidden>Next poll<span class="prog"></span></button>`:""}
    </div>`;
  const split=el.querySelector(".split");
  if(pick) reveal(el,p,pick,false);
  else if(own) reveal(el,p,null,false);
  split.querySelectorAll(".side").forEach(b=>b.onclick=()=>{ if(!split.classList.contains("voted")) castVote(el,p,b.dataset.s,alias); });
  el.querySelector('[data-act="share"]').onclick=()=>{ stopAuto(el); openShare(p); };
  el.querySelector('[data-act="flag"]')&&(el.querySelector('[data-act="flag"]').onclick=()=>{ stopAuto(el); openFlag(p); });
  if(feed){
    el.querySelector('[data-act="skip"]').onclick=()=>{ if(!ME.skipped.includes(p.id)) ME.skipped.push(p.id); saveMe(); S.current=null; render(); };
    el.querySelector('[data-act="next"]').onclick=()=>goNext();
  }
  if(!own) attachSwipe(el,p,alias);
  return el;
}

function reveal(el,p,pick,animate){
  const t=tally(p), split=el.querySelector(".split");
  split.classList.add("voted");
  const A=split.querySelector(".side-a"), B=split.querySelector(".side-b");
  if(pick) (pick==="a"?A:B).classList.add("chosen");
  const set=()=>{ A.style.flexGrow=Math.max(t.pa,22); B.style.flexGrow=Math.max(t.pb,22); };
  if(animate) requestAnimationFrame(()=>requestAnimationFrame(set)); else set();
  countUp(A.querySelector(".pct"),t.pa,animate); countUp(B.querySelector(".pct"),t.pb,animate);
  el.querySelector(".count").textContent=fmt(t.t)+(t.t===1?" vote":" votes");
  const hint=el.querySelector(".hint"); if(hint) hint.textContent="";
  const win = t.pa===t.pb ? null : (t.pa>t.pb?"a":"b");
  let msg;
  if(!pick) msg = t.t ? "Your poll. Live results above." : "Your poll. Share it to get the first votes.";
  else if(p.cat==="debate" && p.an && p.bn) msg = !win ? "Dead heat. Nobody wins this one yet." : `The crowd sides with ${win==="a"?p.an:p.bn}, ${Math.max(t.pa,t.pb)}% to ${Math.min(t.pa,t.pb)}%.`;
  else msg = !win ? "Perfect split. You’re the tiebreaker." : (pick===win ? `You’re with the crowd. ${Math.max(t.pa,t.pb)}% agree.` : `Bold pick. Only ${pick==="a"?t.pa:t.pb}% went your way.`);
  el.querySelector(".verdict").textContent=msg;
}
function countUp(node,to,animate){
  if(!node) return; if(!animate){ node.textContent=to+"%"; return; }
  const st=performance.now(); const tick=n=>{ const k=Math.min(1,(n-st)/650); node.textContent=Math.round(to*(1-Math.pow(1-k,3)))+"%"; if(k<1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

let autoT=null;
function stopAuto(el){ clearTimeout(autoT); el?.querySelector?.(".next")?.classList.remove("run"); }
function goNext(){ clearTimeout(autoT); S.revealing=false; S.current=null; render(); }

async function castVote(el,p,s,alias){
  if(myPick(p)||isOwner(p)) return;
  const split=el.querySelector(".split"); split.classList.add("voted");
  S.revealing = S.view==="vote";
  // optimistic
  const opt={...p,pick:s,ca:p.ca+(s==="a"?1:0),cb:p.cb+(s==="b"?1:0)}; upsert(opt);
  reveal(el,opt,s,true);
  if(navigator.vibrate) try{navigator.vibrate(12)}catch{}
  const next=el.querySelector(".next");
  if(next){ next.hidden=false; next.classList.add("run"); autoT=setTimeout(goNext,2200); }
  try{
    const j=await api("/api/vote",{method:"POST",body:{id:p.id,side:s,alias}});
    upsert(j.poll); S.me=j.me;
    if(j.counted){
      const t=tally(j.poll);
      ME.votes++; if((s==="a"&&t.pa>=t.pb)||(s==="b"&&t.pb>=t.pa)) ME.matches++;
      const d=todayKey(); if(!ME.days.includes(d)) ME.days.push(d); ME.days=ME.days.slice(-60);
      ME.today = ME.today.d===d ? {d,n:ME.today.n+1} : {d,n:1}; saveMe();
    }
    updateChrome();
    $("#creditPill").animate?.([{transform:"scale(1.18)"},{transform:"scale(1)"}],{duration:300});
    if(S.me.loggedIn&&S.me.credits===POST_COST) setTimeout(()=>toast("You can post again. Ask your next question!"),400);
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
const DRAFT = {cat:"everyday",q:"",a:"",b:"",an:"",bn:"",kind:"text",vis:"public",ai:null,bi:null,consent:false,checks:{}};
function renderAsk(v){
  const li=S.me.loggedIn, can=li&&S.me.credits>=POST_COST, d=DRAFT, isDebate=d.cat==="debate";
  v.innerHTML=`
  <h1 class="section-title">Ask the crowd</h1>
  <p class="sub">One question, two options. Posting costs ${POST_COST} credits, and you earn 1 for every vote you cast.</p>
  ${!li?`<div class="lock"><p><b>Log in with your email to post.</b> You get ${SIGNUP_BONUS} credits to start. You can draft now.</p><button class="btn accent" id="askSu">Log in</button></div>`:can?"":`<div class="lock"><p><b>Vote on ${POST_COST-S.me.credits} more ${POST_COST-S.me.credits===1?"poll":"polls"} to post again.</b> You can draft now.</p><a class="btn accent" href="#vote">Vote</a></div>`}
  <div class="panel">
    <label class="lbl">Category</label>
    <div class="chips" style="padding-bottom:4px">${CATS.map(c=>`<button class="chip" data-cat="${c.id}" aria-pressed="${d.cat===c.id}">${c.e} ${esc(c.name)}</button>`).join("")}</div>
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
      <button data-kind="text" aria-pressed="${d.kind==="text"}">Two texts</button>
      <button data-kind="image" aria-pressed="${d.kind==="image"}">Two photos</button>
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
    <label class="check"><input type="checkbox" id="consent" ${d.consent?"checked":""}><span>I took these photos or have the right to share them, and anyone recognisable in them agreed to be posted.</span></label>`}
  </div>
  <div class="panel">
    <h3>Who can vote?</h3>
    <div class="seg" role="group" aria-label="Visibility">
      <button data-vis="public" aria-pressed="${d.vis==="public"}">Public feed</button>
      <button data-vis="private" aria-pressed="${d.vis==="private"}">Private link</button>
    </div>
    <p class="note">${d.vis==="public"?"Anyone browsing can vote. Nobody sees who asked or who voted.":"Only people with your link can vote. They enter a name, so you’ll see who picked what."}</p>
  </div>
  <p class="err" id="err" role="alert"></p>
  <button class="btn primary block" id="post" ${can||!li?"":"disabled"} style="padding:14px">${!li?"Log in to post":can?`Post for ${POST_COST} credits`:`Need ${POST_COST-S.me.credits} more ${POST_COST-S.me.credits===1?"credit":"credits"}`}</button>
  <p class="note" style="text-align:center">Every poll is screened for nudity, abuse and personal details before it goes live.</p>`;

  const keep=()=>{ d.q=$("#q").value; d.a=$("#oa")?.value??d.a; d.b=$("#ob")?.value??d.b; if($("#an")){d.an=$("#an").value; d.bn=$("#bn").value;} if($("#consent")) d.consent=$("#consent").checked; };
  $("#q").oninput=e=>{ $("#qc").textContent=e.target.value.length; keep(); };
  v.querySelectorAll("input.field").forEach(i=>i.oninput=keep);
  $("#consent")&&($("#consent").onchange=keep);
  v.querySelectorAll(".chip[data-cat]").forEach(b=>b.onclick=()=>{ keep(); d.cat=b.dataset.cat; renderAsk(v); });
  v.querySelectorAll("[data-kind]").forEach(b=>b.onclick=()=>{ keep(); d.kind=b.dataset.kind; renderAsk(v); });
  v.querySelectorAll("[data-vis]").forEach(b=>b.onclick=()=>{ keep(); d.vis=b.dataset.vis; renderAsk(v); });
  v.querySelectorAll(".prompt").forEach(b=>b.onclick=()=>{ const t=TEMPLATES[d.cat][+b.dataset.i]; d.q=t[0]; d.kind=t[3]?"image":"text"; d.a=t[1]; d.b=t[2]; renderAsk(v); $("#q").focus(); });
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
    d[s+"i"]=out; d[s+"skin"]=ratio; d.checks[s]= ratio>.6 ? "Needs review: crop closer to the clothes or object" : "Ready for screening";
  }catch{ err.textContent="That image couldn’t be read. Try a JPG or PNG."; }
}

let posting=false;
async function submitPoll(){
  if(posting) return; const d=DRAFT, err=$("#err"); err.textContent="";
  if(!S.me.loggedIn){ openLogin(); return; }
  const q=d.q.trim(), a=d.a.trim(), b=d.b.trim();
  if(S.me.credits<POST_COST){ err.textContent=`Vote on ${POST_COST-S.me.credits} more polls first.`; return; }
  if(q.length<6){ err.textContent="Write a question of at least a few words."; return; }
  if(d.kind==="text"&&(!a||!b)){ err.textContent="Fill in both options."; return; }
  if(d.kind==="text"&&a.toLowerCase()===b.toLowerCase()){ err.textContent="Options A and B need to be different."; return; }
  if(d.cat==="debate"&&(!d.an.trim()||!d.bn.trim())){ err.textContent="Add a name for each side of the debate."; return; }
  if(d.kind==="image"){
    if(!d.ai||!d.bi){ err.textContent="Add a photo for both A and B."; return; }
    if(!d.consent){ err.textContent="Confirm you have permission to post these photos."; return; }
    if((d.askin||0)>.6||(d.bskin||0)>.6){ err.textContent="One photo shows a lot of skin, so our automatic check held it back. Crop to the outfit, haircut or object you’re asking about."; return; }
  }
  const bad=screenText(q,a,b,d.an,d.bn); if(bad){ err.textContent=bad; return; }
  posting=true; const btn=$("#post"); btn.disabled=true; btn.textContent=d.kind==="image"?"Screening photos…":"Posting…";
  try{
    const j=await api("/api/polls",{method:"POST",body:{cat:d.cat,q,a,b,an:d.an,bn:d.bn,kind:d.kind,vis:d.vis,ai:d.ai,bi:d.bi,consent:d.consent}});
    S.me=j.me; upsert(j.poll);
    Object.assign(DRAFT,{q:"",a:"",b:"",an:"",bn:"",ai:null,bi:null,consent:false,checks:{},askin:0,bskin:0});
    posting=false; location.hash="mine"; setTimeout(()=>openShare(j.poll,true),150);
  }catch(e){
    posting=false; btn.disabled=false; btn.textContent=`Post for ${POST_COST} credits`; err.textContent=e.message;
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
    const t=tally(p), voters=p.voters||[], debate=p.cat==="debate"&&p.an;
    const win=t.t?(t.pa===t.pb?null:(t.pa>t.pb?"a":"b")):null;
    const el=document.createElement("div"); el.className="mi";
    el.innerHTML=`<div class="meta"><span class="cat">${catOf(p.cat).e} ${esc(catOf(p.cat).name)}</span><span class="tag">${p.vis==="private"?"Private link":"Public"}</span><span class="spacer"></span><span>${ago(p.ts)}</span></div>
      <h2 class="q">${esc(p.q)}</h2>
      <div class="res"><span class="ra" style="flex-grow:${Math.max(t.pa,15)}">A ${t.t?t.pa+"%":""}</span><span class="rb" style="flex-grow:${Math.max(t.pb,15)}">${t.t?t.pb+"%":""} B</span></div>
      <div class="legend"><span>${debate?esc(p.an)+": ":""}${esc(p.a||"Photo A")}</span><span>${debate?esc(p.bn)+": ":""}${esc(p.b||"Photo B")}</span></div>
      <p class="note">${t.t?`${t.t} ${t.t===1?"vote":"votes"}`:"No votes yet. Share it to get the first ones."}${debate&&win&&t.t>=3?` · Winning: ${esc(win==="a"?p.an:p.bn)}`:""}${p.hidden?" · Hidden after reports":""}</p>
      ${p.vis==="private"&&voters.length?`<ul class="voters">${voters.map(x=>`<li class="v${esc(x.s)}">${esc(x.n)}: ${esc(String(x.s).toUpperCase())}</li>`).join("")}</ul>`:""}
      <div class="actions"><button class="btn accent" data-a="share">Share</button><a class="btn" href="#poll-${esc(p.id)}">Open</a><span class="spacer"></span><button class="btn ghost" data-a="del">Delete</button></div>`;
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
  const needsAlias=p.vis==="private"&&!isOwner(p)&&!myPick(p)&&!ME.alias;
  if(needsAlias){
    pp.innerHTML=`<div class="panel"><h3>You’re invited to vote</h3><p class="note" style="margin:0 0 12px">The person who asked will see your name next to your pick. No account needed.</p>
      <label class="lbl" for="al">Your name or nickname</label><input class="field" id="al" maxlength="24" placeholder="e.g. Riya" value="${esc(S.me.nick||"")}"><p class="err" id="aerr"></p>
      <button class="btn primary block" id="ago" style="margin-top:10px">Continue to vote</button></div>`;
    const go=()=>{ const n=$("#al").value.trim(); if(n.length<2){ $("#aerr").textContent="Enter at least 2 characters."; return; } if(screenText(n)){ $("#aerr").textContent="Pick a different name."; return; } ME.alias=n; saveMe(); renderPollPage(v); };
    $("#ago").onclick=go; $("#al").onkeydown=e=>{ if(e.key==="Enter") go(); }; return;
  }
  pp.appendChild(buildCard(p,{alias:p.vis==="private"?ME.alias:null}));
  if(isOwner(p)){
    const voters=p.voters||[];
    const box=document.createElement("div"); box.className="panel"; box.style.marginTop="14px";
    box.innerHTML=`<h3>${p.vis==="private"?"Who voted":"Your poll"}</h3>${p.vis==="private"?(voters.length?`<ul class="voters">${voters.map(x=>`<li class="v${esc(x.s)}">${esc(x.n)}: ${esc(String(x.s).toUpperCase())}</li>`).join("")}</ul>`:`<p class="note">No votes yet. Send the link to your group.</p>`):`<p class="note">Public polls are anonymous, so voters aren’t listed.</p>`}`;
    pp.appendChild(box);
  } else if(!myPick(p)){
    const more=document.createElement("p"); more.className="note"; more.style.textAlign="center";
    more.textContent="Vote to see what everyone else picked.";
    pp.appendChild(more);
  }
  if(p.vis==="private"&&ME.alias&&!isOwner(p)&&!myPick(p)){ const n=document.createElement("p"); n.className="note"; n.style.textAlign="center"; n.textContent="Voting as "+ME.alias+". "; const ch=document.createElement("button"); ch.className="btn ghost"; ch.textContent="Change name"; ch.onclick=()=>{ME.alias="";saveMe();renderPollPage(v)}; n.appendChild(ch); pp.appendChild(n); }
}

/* ---------- Me ---------- */
function renderMe(v){
  const acc=ME.votes?Math.round(ME.matches*100/ME.votes):0, st=streak();
  const badges=[["First vote",ME.votes>=1],["10 votes",ME.votes>=10],["50 votes",ME.votes>=50],["3-day streak",st>=3],["7-day streak",st>=7],["Crowd whisperer",ME.votes>=20&&acc>=70],["Contrarian",ME.votes>=20&&acc<40],["Asked the crowd",S.polls.some(isOwner)]];
  v.innerHTML=`<h1 class="section-title">Your stats</h1><p class="sub">You’re anonymous. Nobody sees these numbers but you.</p>
  ${S.me.loggedIn?`<div class="panel"><h3>Account</h3><p class="note" style="margin:0 0 10px">Logged in as ${esc(S.me.nick)} (${esc(S.me.email)}). Your email is never shown to anyone.</p><button class="btn" id="logout">Log out</button></div>`:`<div class="lock"><p><b>Not logged in.</b> Log in with your email to get ${SIGNUP_BONUS} credits for asking.</p><button class="btn accent" id="suMe">Log in</button></div>`}
  <div class="stats">
    <div class="stat"><b>${S.me.loggedIn?S.me.credits:0}</b><span>Credits to spend</span></div>
    <div class="stat"><b>${ME.votes}</b><span>Votes cast</span></div>
    <div class="stat"><b>${st}</b><span>Day streak</span></div>
    <div class="stat"><b>${acc}%</b><span>Agreed with the crowd</span></div>
  </div>
  <div class="panel"><h3>Badges</h3><div class="badges">${badges.map(([n,on])=>`<span class="badge ${on?"on":""}">${on?"✓ ":""}${n}</span>`).join("")}</div></div>
  <div class="panel"><h3>How credits work</h3><p class="note" style="margin:0">Voting is open to everyone. Logging in with your email gives you ${SIGNUP_BONUS} credits, every vote while logged in earns 1 more, and posting a poll costs ${POST_COST}.</p></div>
  <div class="panel"><h3>Community rules</h3>
    <ul class="rules"><li>No nudity, sexual content or graphic images.</li><li>Only post photos you took or have the right to share. Anyone recognisable must have agreed.</li><li>No insults, hate or harassment, including in debate names.</li><li>No phone numbers, emails, links or ID documents.</li></ul>
    <p class="note">Text is checked automatically before posting, and photos are screened for nudity and unsafe content. Polls reported by 3 people are hidden until reviewed.</p></div>
  <div class="panel"><h3>Private voting name</h3><p class="note" style="margin:0 0 10px">${ME.alias?"Used on private links: "+esc(ME.alias):"Not set. You’ll be asked when you open a private link."}</p>${ME.alias?`<button class="btn" id="clrAlias">Clear name</button>`:""}</div>
  <button class="btn ghost" id="resetMe">Reset my stats on this device</button>`;
  $("#suMe")&&($("#suMe").onclick=()=>openLogin());
  $("#logout")&&($("#logout").onclick=async()=>{ try{ await api("/api/auth/logout",{method:"POST"}); }catch{} S.me={loggedIn:false,credits:0}; toast("Logged out"); await refresh(); });
  $("#clrAlias")&&($("#clrAlias").onclick=()=>{ME.alias="";saveMe();render();});
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
    <p class="note">Your email is only used to log you in. It’s never shown on polls.</p>
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
}
function codeStep(email,j){
  openSheet(`<h2>Check your email</h2><p class="sub">We sent a 6-digit code to ${esc(email)}. It expires in 10 minutes.</p>
    ${j.devCode?`<p class="lock" style="display:block"><b>Test mode:</b> no email service is set up yet, so here’s your code: <b>${esc(j.devCode)}</b></p>`:""}
    <label class="lbl" for="cd">Code</label><input class="field" id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="letter-spacing:.3em;font-size:1.3rem">
    ${j.isNew?`<label class="lbl" for="nk" style="margin-top:12px">Pick a nickname</label><input class="field" id="nk" maxlength="24" placeholder="Only you see this">
    <label class="check"><input type="checkbox" id="agree"><span>I agree to the community rules: no nudity, no abuse, no photos posted without consent.</span></label>`:""}
    <p class="err" id="cerr" role="alert"></p>
    <button class="btn primary block" id="cgo" style="padding:13px;margin-top:6px">${j.isNew?`Create account and get ${SIGNUP_BONUS} credits`:"Log in"}</button>
    <button class="btn ghost block" id="resend" disabled>Resend code in 60s</button>`);
  let left=60; const rs=$("#resend"); const tm=setInterval(()=>{ left--; if(left<=0){ clearInterval(tm); rs.disabled=false; rs.textContent="Resend code"; } else rs.textContent=`Resend code in ${left}s`; },1000);
  rs.onclick=async()=>{ rs.disabled=true; try{ const k=await api("/api/auth/request",{method:"POST",body:{email}}); clearInterval(tm); codeStep(email,k); toast("New code sent"); }catch(e){ $("#cerr").textContent=e.message; rs.disabled=false; } };
  const go=async()=>{
    const code=$("#cd").value.replace(/\D/g,""), e=$("#cerr"), btn=$("#cgo"); e.textContent="";
    if(code.length!==6){ e.textContent="Enter the 6-digit code from the email."; return; }
    let nick;
    if(j.isNew){ nick=$("#nk").value.trim(); if(nick.length<2){ e.textContent="Pick a nickname of at least 2 characters."; return; } if(screenText(nick)){ e.textContent="Pick a different nickname."; return; } if(!$("#agree").checked){ e.textContent="Agree to the community rules to continue."; return; } }
    btn.disabled=true;
    try{
      const r=await api("/api/auth/verify",{method:"POST",body:{email,code,nick}});
      clearInterval(tm); closeSheet(); S.me=r.me;
      toast(r.bonus?`Welcome! +${r.bonus} credits`:`Welcome back, ${r.me.nick}`);
      await refresh();
    }catch(err){ btn.disabled=false; e.textContent=err.message; }
  };
  $("#cgo").onclick=go; $("#cd").onkeydown=e=>{ if(e.key==="Enter") go(); };
}

/* ---------- Report ---------- */
function openFlag(p){
  openSheet(`<h2>Report this poll</h2><p class="sub">Reports are anonymous. The poll disappears from your feed right away.</p>
  <div class="prompts">${["Nudity or sexual content","Abusive or hateful","Photo posted without consent","Spam or scam","Something else"].map(r=>`<button class="prompt" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>
  <button class="btn ghost block" style="margin-top:10px" id="cx">Cancel</button>`);
  $("#cx").onclick=closeSheet;
  $("#sheet").querySelectorAll("[data-r]").forEach(b=>b.onclick=async()=>{
    closeSheet(); upsert({...p,hidden:true});
    try{ await api("/api/flag",{method:"POST",body:{id:p.id,reason:b.dataset.r}}); }catch{}
    toast("Thanks. We’ve hidden it for you."); S.current=null; if(S.view==="poll") location.hash="vote"; else render();
  });
}

/* ---------- Share ---------- */
const shareLink = p => location.origin+"/#poll-"+p.id;
function hooks(p){
  if(p.cat==="debate"&&p.an&&p.bn) return [`${p.an} vs ${p.bn}. Settle it for us 👀`,`We can’t agree: ${p.q} Pick a side.`,`Loser buys dinner. Who’s right?`];
  return [`Settle this for me 👀 A or B?`,`Be brutally honest: ${p.q}`,`I can’t decide. You pick, it’s anonymous.`];
}
async function openShare(p,justPosted){
  const link=shareLink(p), hs=hooks(p);
  openSheet(`<h2>${justPosted?"Your poll is live":"Share this poll"}</h2>
  <p class="sub" style="margin-bottom:6px">${p.vis==="private"?"Send the link to your group. They’ll pick a name and vote.":"Post it to your Story or Status to pull in fast votes."}</p>
  <div class="story"><canvas id="sc" width="1080" height="1920" aria-label="Story image preview"></canvas></div>
  <div class="share-grid">
    <button class="btn accent" id="shWa">WhatsApp</button>
    <button class="btn accent" id="shIg">Instagram Story</button>
    <button class="btn" id="shCopy">Copy link</button>
    <button class="btn" id="shSave">Save image</button>
  </div>
  <div class="linkbox"><input class="field" id="lk" readonly value="${esc(link)}" aria-label="Poll link"></div>
  <h3 style="margin:16px 0 4px;font-size:1rem">Caption ideas</h3><p class="note" style="margin:0">Tap one to copy it.</p>
  <div class="hooks">${hs.map(h=>`<button class="hook">${esc(h)}</button>`).join("")}</div>
  <button class="btn ghost block" style="margin-top:12px" id="cx">Done</button>`);
  $("#cx").onclick=closeSheet;
  const canvas=$("#sc"); await drawStory(canvas,p);
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

/* ---------- Onboarding ---------- */
function onboard(){
  if(ME.onboarded||location.hash.startsWith("#poll-")) return;
  openSheet(`<h2>Welcome to Get Opinion</h2><p class="sub">Honest answers from strangers, in two taps.</p>
  <ul class="ob" style="padding-left:18px;margin:0 0 16px"><li><b>Vote A or B.</b> Tap, swipe or press a key. No account, nobody knows it’s you.</li><li><b>Ask for free.</b> Log in with your email to get ${SIGNUP_BONUS} credits. Each question costs ${POST_COST}.</li><li><b>Settle debates.</b> Arguing with a friend? Put both names on it and let the crowd decide.</li><li><b>Go private.</b> Share a link with just your group when you want to know who picked what.</li></ul>
  <button class="btn primary block" id="obgo" style="padding:13px">Start voting</button>`);
  $("#obgo").onclick=()=>{ ME.onboarded=true; saveMe(); closeSheet(); };
}

/* ---------- Boot ---------- */
route(); onboard(); refresh();
