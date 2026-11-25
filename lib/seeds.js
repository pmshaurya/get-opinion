"use strict";
/* ---------- Seed artwork (inline SVG) ---------- */
const svgURI = s => "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(s);
function room(wall,name){return svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${wall}"/><rect y="300" width="300" height="100" fill="#C9B79C"/><rect x="40" y="70" width="90" height="70" fill="#fff" opacity=".9"/><rect x="48" y="78" width="74" height="54" fill="#E8D9C4"/><rect x="170" y="60" width="80" height="110" fill="#F7F3EC" opacity=".85"/><rect x="30" y="230" width="240" height="70" rx="16" fill="#5A4B6E"/><rect x="30" y="205" width="240" height="40" rx="14" fill="#6C5C82"/><rect x="45" y="300" width="10" height="16" fill="#3a2f48"/><rect x="245" y="300" width="10" height="16" fill="#3a2f48"/><circle cx="258" cy="190" r="22" fill="#3F6B3A"/><rect x="252" y="205" width="12" height="40" fill="#8A6A4A"/><text x="150" y="380" font-family="Arial" font-size="20" font-weight="700" text-anchor="middle" fill="#2b2238">${name}</text></svg>`)}
const thumbA = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#E23D3D"/><circle cx="110" cy="250" r="90" fill="#F4C9A8"/><circle cx="85" cy="235" r="10" fill="#222"/><circle cx="135" cy="235" r="10" fill="#222"/><ellipse cx="110" cy="285" rx="22" ry="28" fill="#5a1a1a"/><text x="150" y="80" font-family="Arial Black,Arial" font-weight="900" font-size="44" fill="#FFE100" text-anchor="middle" stroke="#000" stroke-width="3">I QUIT</text><text x="150" y="125" font-family="Arial Black,Arial" font-weight="900" font-size="34" fill="#fff" text-anchor="middle" stroke="#000" stroke-width="3">MY JOB?!</text><path d="M200 300 l60 -60" stroke="#FFE100" stroke-width="12" stroke-linecap="round"/><path d="M260 240 l-30 2 l28 28z" fill="#FFE100"/></svg>`);
const thumbB = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#16131F"/><rect x="30" y="230" width="240" height="130" rx="10" fill="#2A2438"/><circle cx="90" cy="295" r="36" fill="#F0D9C2"/><rect x="140" y="270" width="110" height="10" rx="5" fill="#8C84A6"/><rect x="140" y="292" width="80" height="10" rx="5" fill="#8C84A6"/><text x="30" y="110" font-family="Georgia,serif" font-size="40" fill="#fff">6 months</text><text x="30" y="160" font-family="Georgia,serif" font-size="40" fill="#fff" font-style="italic">without a boss</text><text x="30" y="200" font-family="Arial" font-size="18" fill="#B9B2CF">the honest numbers</text></svg>`);
const iconA = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#EDEBF3"/><rect x="60" y="110" width="180" height="180" rx="44" fill="#4B2BE8"/><path d="M160 135 l-55 85 h40 l-15 55 l60 -90 h-42z" fill="#fff"/><text x="150" y="350" font-family="Arial" font-size="22" font-weight="700" text-anchor="middle" fill="#1B1630">Bolt</text></svg>`);
const iconB = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#EDEBF3"/><rect x="60" y="110" width="180" height="180" rx="44" fill="#fff" stroke="#DDD" stroke-width="2"/><circle cx="150" cy="200" r="52" fill="#FF7A1A"/><circle cx="150" cy="200" r="24" fill="#fff"/><text x="150" y="350" font-family="Arial" font-size="22" font-weight="700" text-anchor="middle" fill="#1B1630">Orbit</text></svg>`);
const invA = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#F6EFE6"/><rect x="24" y="24" width="252" height="352" fill="none" stroke="#B8946A" stroke-width="2"/><text x="150" y="150" font-family="Georgia,serif" font-style="italic" font-size="34" fill="#5B4632" text-anchor="middle">Priya</text><text x="150" y="190" font-family="Georgia,serif" font-size="20" fill="#5B4632" text-anchor="middle">&amp;</text><text x="150" y="232" font-family="Georgia,serif" font-style="italic" font-size="34" fill="#5B4632" text-anchor="middle">Arjun</text><text x="150" y="300" font-family="Georgia,serif" font-size="14" fill="#8A7258" text-anchor="middle" letter-spacing="3">12 . 02 . 2027</text></svg>`);
const invB = svgURI(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#1D2240"/><text x="40" y="120" font-family="Arial" font-weight="800" font-size="46" fill="#fff">PRIYA</text><text x="40" y="170" font-family="Arial" font-weight="800" font-size="46" fill="#F2B84B">+ARJUN</text><rect x="40" y="200" width="60" height="4" fill="#F2B84B"/><text x="40" y="250" font-family="Arial" font-size="16" fill="#C9CCE6">Saturday, 12 Feb 2027</text><text x="40" y="276" font-family="Arial" font-size="16" fill="#C9CCE6">Goa</text></svg>`);

/* ---------- Seed feed (cold start) ---------- */
const H = 3600e3, NOW = Date.now();
const SEEDS = [
  {id:"s01",cat:"debate",q:"Pineapple on pizza: crime or genius?",a:"Genius, sweet and salty",b:"Crime, keep fruit off it",an:"Kabir",bn:"Meera",base:[512,688]},
  {id:"s02",cat:"design",kind:"image",q:"Which thumbnail would you actually click?",a:"Loud and dramatic",b:"Calm and curious",ai:thumbA,bi:thumbB,base:[731,402]},
  {id:"s03",cat:"style",q:"Job interview at a startup: what do I wear?",a:"Blazer and good jeans",b:"Full suit, play it safe",base:[903,241]},
  {id:"s04",cat:"dating",q:"Which opener gets a reply?",a:"Hey! How’s your week going?",b:"Settle a debate: is cereal soup?",base:[188,644]},
  {id:"s05",cat:"everyday",kind:"image",q:"Living room wall: which shade?",a:"Sage",b:"Dusty rose",ai:room("#A3B18A","Sage"),bi:room("#D8A7A0","Dusty rose"),base:[640,377]},
  {id:"s06",cat:"fun",q:"Penalty kick: where do you aim?",a:"Top corner",b:"Blast it down the middle",base:[592,311]},
  {id:"s07",cat:"debate",q:"Is a hot dog a sandwich?",a:"Yes, bread plus filling",b:"No, it’s its own thing",an:"Dev",bn:"Sana",base:[287,826]},
  {id:"s08",cat:"everyday",q:"Rent: closer to work or bigger place farther out?",a:"Closer, save my commute",b:"Bigger, I need the space",base:[811,529]},
  {id:"s09",cat:"design",kind:"image",q:"App icon for a budgeting app?",a:"Bolt",b:"Orbit",ai:iconA,bi:iconB,base:[344,469]},
  {id:"s10",cat:"dating",q:"First date: coffee or drinks?",a:"Coffee, low pressure",b:"Drinks, more vibe",base:[455,497]},
  {id:"s11",cat:"style",q:"Grow the beard or stay clean-shaven?",a:"Grow it",b:"Clean-shaven",base:[702,486]},
  {id:"s12",cat:"fun",q:"Cricket: Test match or T20?",a:"Test, the real thing",b:"T20, give me fireworks",base:[384,771]},
  {id:"s13",cat:"everyday",q:"Buy the new phone now or wait for the sale?",a:"Buy now",b:"Wait for the sale",base:[143,968]},
  {id:"s14",cat:"debate",q:"Who should do the dishes after the other cooked?",a:"The person who didn’t cook",b:"Whoever made the mess",an:"Rohan",bn:"Ira",base:[1021,233]},
  {id:"s15",cat:"design",kind:"image",q:"Wedding invite: which style?",a:"Classic script",b:"Modern bold",ai:invA,bi:invB,base:[566,489]},
  {id:"s16",cat:"dating",q:"They left you on read for 2 days. Do you text again?",a:"Yes, one light nudge",b:"No, ball’s in their court",base:[392,860]},
  {id:"s17",cat:"style",q:"White sneakers or loafers with chinos?",a:"White sneakers",b:"Loafers",base:[617,544]},
  {id:"s18",cat:"fun",q:"Holiday: beach or mountain trek?",a:"Beach",b:"Mountains",base:[488,603]},
  {id:"s19",cat:"everyday",q:"Morning workout or evening workout?",a:"Morning",b:"Evening",base:[577,601]},
  {id:"s20",cat:"debate",q:"Is it okay to recline your seat on a short flight?",a:"Yes, I paid for the seat",b:"No, it’s rude under 2 hours",an:"Aditi",bn:"Sam",base:[419,712]},
  {id:"s21",cat:"design",q:"Portfolio site: dark mode or light mode?",a:"Dark",b:"Light",base:[530,421]},
  {id:"s22",cat:"dating",q:"Split the bill on a first date?",a:"Split it",b:"Whoever asked pays",base:[640,618]},
  {id:"s23",cat:"fun",q:"Best way to watch the big match?",a:"Packed sports bar",b:"Couch with friends",base:[322,866]},
  {id:"s24",cat:"style",q:"Glasses: round frames or square frames?",a:"Round",b:"Square",base:[471,452]},
  {id:"s25",cat:"everyday",q:"Learn to cook or keep ordering in?",a:"Learn to cook",b:"Order in, life’s short",base:[1104,197]},
  {id:"s26",cat:"debate",q:"Toilet paper: over or under?",a:"Over",b:"Under",an:"Nikhil",bn:"Tara",base:[1286,233]},
  {id:"s27",cat:"debate",q:"After a fight, who texts first?",a:"Whoever was wrong",b:"Whoever cares more",an:"Ishaan",bn:"Zoya",base:[702,655]},
  {id:"s28",cat:"debate",q:"Is replying ‘k’ to a long message rude?",a:"Yes, it’s a declaration of war",b:"No, it means okay",an:"Anya",bn:"Vik",base:[1340,276]},
  {id:"s29",cat:"debate",q:"Road trip: who controls the music?",a:"The driver, always",b:"Shotgun, it’s their job",an:"Arnav",bn:"Pooja",base:[811,590]},
  {id:"s30",cat:"debate",q:"Still using your ex’s Netflix login. Okay?",a:"Yes, free is free",b:"No, have some dignity",an:"Kiara",bn:"Mo",base:[566,742]},
  {id:"s31",cat:"design",q:"Startup’s first hire: designer or engineer?",a:"Designer",b:"Engineer",base:[318,804]},
  {id:"s32",cat:"design",q:"Memes in a pitch deck to investors?",a:"Yes, be memorable",b:"No, be serious",base:[289,913]},
  {id:"s33",cat:"design",q:"Instagram grid: strict colour theme or organised chaos?",a:"Strict theme",b:"Organised chaos",base:[402,688]},
  {id:"s34",cat:"design",q:"Comic Sans: ever acceptable?",a:"Yes, it has its place",b:"Never, not once",base:[377,1029]},
  {id:"s35",cat:"style",q:"Thinning hair: shave it all or ride it out?",a:"Shave it, own it",b:"Ride it out",base:[938,402]},
  {id:"s36",cat:"style",q:"Gym clothes to Sunday brunch?",a:"Totally fine",b:"Go home and change",base:[611,577]},
  {id:"s37",cat:"style",q:"First tattoo: visible or hidden?",a:"Visible, why hide it",b:"Hidden, just for me",base:[455,703]},
  {id:"s38",cat:"style",q:"One signature scent or rotate perfumes?",a:"Signature scent",b:"Rotate by mood",base:[662,548]},
  {id:"s39",cat:"dating",q:"Your ex still watches all your stories. Do you remove them?",a:"Remove, clean break",b:"Leave it, let them watch",base:[533,689]},
  {id:"s40",cat:"dating",q:"Not feeling it after date two. How do you end it?",a:"Honest kind text",b:"Slowly fade away",base:[1108,207]},
  {id:"s41",cat:"dating",q:"Meeting the parents: 3 months or 1 year in?",a:"3 months",b:"1 year",base:[421,598]},
  {id:"s42",cat:"dating",q:"Joint bank account with your partner?",a:"Yes, we’re a team",b:"No, keep it separate",base:[367,844]},
  {id:"s43",cat:"everyday",q:"Friend asks what you think of their bad startup idea. Do you tell them?",a:"Tell the truth",b:"Encourage them",base:[1012,288]},
  {id:"s44",cat:"everyday",q:"Neighbour’s music at 11pm on a weeknight?",a:"Knock and ask",b:"Let it go this time",base:[790,431]},
  {id:"s45",cat:"everyday",q:"Big wedding or small wedding plus a dream trip?",a:"Big wedding",b:"Small wedding and travel",base:[298,1157]},
  {id:"s46",cat:"everyday",q:"Quit a job you hate with no backup?",a:"Quit now",b:"Find the next one first",base:[352,1043]},
  {id:"s47",cat:"fun",q:"Fight one horse-sized duck or 100 duck-sized horses?",a:"One giant duck",b:"100 tiny horses",base:[688,734]},
  {id:"s48",cat:"fun",q:"Tennis GOAT?",a:"Federer",b:"Djokovic",base:[901,822]},
  {id:"s49",cat:"fun",q:"Superpower: never need sleep or never feel hungry?",a:"Never sleep",b:"Never hungry",base:[1003,412]},
  {id:"s50",cat:"fun",q:"Messi or Ronaldo?",a:"Messi",b:"Ronaldo",base:[1422,1187]}
,  {id:"s51",cat:"random",q:"Window seat or aisle seat?",a:"Window, always",b:"Aisle, freedom",base:[874,512]},
  {id:"s52",cat:"random",q:"Phone call or voice note?",a:"Just call me",b:"Voice note, my own pace",base:[401,733]},
  {id:"s53",cat:"random",q:"Time machine: visit the past or the future?",a:"The past",b:"The future",base:[588,640]}
].map((p,i)=>({kind:"text",vis:"public",ts:NOW-(i*2.3+1)*H,seed:true,o:"seed",...p}));


module.exports = { SEEDS };
