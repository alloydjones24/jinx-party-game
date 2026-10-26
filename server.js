const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.join(publicDir, file);
  if (!full.startsWith(publicDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(full);
  const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
  res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
  fs.createReadStream(full).pipe(res);
});
const wss = new WebSocket.Server({ server });
const prompts = [
  {type:'MIND MATCH', kind:'match', q:'What is the best food to eat at 2 AM?'},
  {type:'READ MY MIND', kind:'predict', q:'What is your ideal late-night takeaway?'},
  {type:'STAND OUT', kind:'standout', q:'What is the worst thing to find under your bed?'},
  {type:'MIND MATCH', kind:'match', q:'What would you buy first if you suddenly became a millionaire?'},
  {type:'READ MY MIND', kind:'predict', q:'What is the most suspicious thing someone can say on a first date?'},
  {type:'STAND OUT', kind:'standout', q:'What is the most ridiculous reason to call in sick?'},
  {type:'WILDCARD', kind:'wild', q:'Name something you should never bring to a wedding.'},
  {type:'MIXED ROUND', kind:'match', q:'What fictional character would be the worst flatmate?'},
  {type:'DOUBLE TROUBLE', kind:'final', q:'What is something everyone secretly judges people for?'}
];
const avatars = ['🦊','🐸','🐙','🦄','🐼','🦝','🐸','🐯'];
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){ let s=''; for(let i=0;i<5;i++) s+=codeChars[Math.floor(Math.random()*codeChars.length)]; return s; }
function send(ws, obj){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function clean(s, max=120){ return String(s||'').trim().replace(/[<>]/g,'').slice(0,max); }
function state(room, recipient){
  const me = room.players.find(p=>p.id===recipient);
  const round = room.round;
  const publicPlayers = room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,host:p.id===room.hostId,submitted:!!(round && round.answers[p.id]),connected:!!p.ws}));
  let roundView = null;
  if(round){
    roundView = {index:round.index, total:prompts.length, type:round.prompt.type, question:round.prompt.q, phase:round.phase, deadline:round.deadline, targetId:round.targetId, double:round.prompt.kind==='final', answers:[]};
    if(round.phase==='reveal' || round.phase==='vote' || round.phase==='scores'){
      roundView.answers = Object.entries(round.answers).map(([id,a])=>({id,name:room.players.find(p=>p.id===id)?.name||'Player',text:a.text, prediction:a.prediction||''}));
    }
    if(round.phase==='vote') roundView.voteChoices = roundView.answers.filter(a=>a.id!==recipient).map(a=>({id:a.id,name:a.name,text:a.text}));
  }
  
return {type:'state',meId:recipient,room:{code:room.code,hostId:room.hostId,status:room.status,players:publicPlayers,round:roundView,roundNumber:room.roundIndex+1,totalRounds:prompts.length}};
}
function broadcast(room){ for(const p of room.players) if(p.ws) send(p.ws,state(room,p.id)); }
function scoreAndReveal(room){
  const r=room.round; if(!r || r.phase!=='answer') return;
  r.phase='reveal';
  const answers=Object.entries(r.answers);
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an|of|and|to|with|pizza|answer)\b/g,' ').replace(/\s+/g,' ').trim();
  if(r.prompt.kind==='match' || r.prompt.kind==='final' || r.prompt.kind==='wild'){
    const groups={};
    answers.forEach(([id,a])=>{const k=norm(a.text); if(k) (groups[k] ||= []).push(id);});
    for(const [id,a] of answers){
      const count=(groups[norm(a.text)]||[]).length;
      let pts=count>=3?5:count>=2?3:0;
      if(pts && count===Math.max(0,...Object.values(groups).map(g=>g.length))) pts+=2;
      if(r.prompt.kind==='final') pts*=2;
      if(r.prompt.kind==='wild' && count===1) pts+=3;
      const p=room.players.find(x=>x.id===id); if(p) p.score+=pts;
      a.points=pts;
    }
  } else if(r.prompt.kind==='predict'){
    const target=room.players.find(p=>p.id===r.targetId);
    const targetAnswer=r.answers[r.targetId]?.text || '';
    let correct=0;
    for(const [id,a] of answers){
      if(id===r.targetId) continue;
      const exact=norm(a.prediction) && norm(a.prediction)===norm(targetAnswer);
      const close=norm(a.prediction) && (norm(targetAnswer).includes(norm(a.prediction)) || norm(a.prediction).includes(norm(targetAnswer))) && norm(a.prediction)!==norm(targetAnswer);
      a.points=exact?3:close?1:0;
      const p=room.players.find(x=>x.id===id); if(p) p.score+=a.points;
      if(exact) correct++;
    }
    if(target) {const bonus=Math.min(5,correct); target.score+=bonus; r.answers[r.targetId].points=bonus;}
  } else if(r.prompt.kind==='standout'){
    for(const [id,a] of answers){
      const count=answers.filter(([other,b])=>other!==id && norm(b.text)===norm(a.text)).length;
      a.points=count===0?3:0;
      const p=room.players.find(x=>x.id===id); if(p) p.score+=a.points;
    }
    r.phase='vote'; broadcast(room); return;
  }
  broadcast(room);
  setTimeout(()=>{if(room.round===r && r.phase==='reveal'){r.phase='scores';broadcast(room);}},3500);
}
function advance(room){
  if(room.roundIndex+1>=prompts.length){room.status='finished';room.round=null;broadcast(room);return;}
  room.roundIndex++;
  const prompt=prompts[room.roundIndex];
  const eligible=room.players;
  const target=eligible[room.roundIndex % eligible.length];
  room.round={index:room.roundIndex,prompt,phase:'answer',answers:{},votes:{},targetId:prompt.kind==='predict'?target.id:null,deadline:Date.now()+45000};
  broadcast(room);
  clearTimeout(room.timer);
  room.timer=setTimeout(()=>scoreAndReveal(room),45000);
}
function tallyVotes(room){
  const r=room.round; if(!r || r.phase!=='vote') return;
  const counts={}; Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);
  const max=Math.max(0,...Object.values(counts));
  for(const [id,a] of Object.entries(r.answers)){
    let pts=a.points||0;
    if((counts[id]||0)===max && max>0) pts+=2;
    a.points=pts;
    const p=room.players.find(x=>x.id===id); if(p) p.score+=2*((counts[id]||0)===max && max>0?1:0);
  }
  r.phase='reveal'; broadcast(room);
  setTimeout(()=>{if(room.round===r && r.phase==='reveal'){r.phase='scores';broadcast(room);}},3500);
}
wss.on('connection', ws=>{
  ws.id=Math.random().toString(36).slice(2,10);
  ws.on('message', raw=>{
    let msg; try{msg=JSON.parse(raw.toString())}catch{return}
    if(msg.action==='create'){
      let code; do{code=makeCode()}while(rooms.has(code));
      const room={code,hostId:ws.id,status:'lobby',players:[],round:null,roundIndex:-1,timer:null};
      rooms.set(code,room);
      room.players.push({id:ws.id,name:clean(msg.name,18)||'Player 1',avatar:avatars[0],score:0,ws});
      ws.roomCode=code; broadcast(room); return;
    }
    if(msg.action==='join'){
      const code=clean(msg.code,5).toUpperCase(), room=rooms.get(code);
      if(!room){send(ws,{type:'error',message:'Room not found. Check the code and try again.'});return;}
      if(room.status!=='lobby'){send(ws,{type:'error',message:'That game has already started.'});return;}
      if(room.players.length>=8){send(ws,{type:'error',message:'This room is full (8 players max).'});return;}
      if(room.players.some(p=>p.name.toLowerCase()===clean(msg.name,18).toLowerCase())){send(ws,{type:'error',message:'That nickname is already taken in this room.'});return;}
      room.players.push({id:ws.id,name:clean(msg.name,18)||`Player ${room.players.length+1}`,avatar:avatars[room.players.length%avatars.length],score:0,ws});
      ws.roomCode=code; broadcast(room); return;
    }
    const room=rooms.get(ws.roomCode); if(!room) return;
    const me=room.players.find(p=>p.id===ws.id); if(!me) return;
    if(msg.action==='start' && ws.id===room.hostId && room.status==='lobby'){
      if(room.players.length<2){send(ws,{type:'error',message:'You need at least 2 players to start.'});return;}
      room.status='playing'; room.roundIndex=-1; advance(room); return;
    }
    if(msg.action==='answer' && room.round?.phase==='answer' && !room.round.answers[ws.id]){
      let text=clean(msg.text,120), prediction=clean(msg.prediction,120);
      if(!text && room.round.prompt.kind!=='predict'){send(ws,{type:'error',message:'Add an answer first.'});return;}
      if(room.round.prompt.kind==='predict' && room.round.targetId===ws.id && !text){send(ws,{type:'error',message:'Add your answer first.'});return;}
      room.round.answers[ws.id]={text,prediction,points:0};
      if(room.players.every(p=>room.round.answers[p.id])) scoreAndReveal(room); else broadcast(room);
      return;
    }
    if(msg.action==='vote' && room.round?.phase==='vote' && !room.round.votes[ws.id] && msg.targetId!==ws.id){
      room.round.votes[ws.id]=msg.targetId;
      if(room.players.every(p=>room.round.votes[p.id] || (room.round.answers[p.id] && room.round.answers[p.id].text===''))) tallyVotes(room);
      else broadcast(room);
      return;
    }
    if(msg.action==='next' && ws.id===room.hostId && room.round?.phase==='scores'){
      advance(room); return;
    }
    if(msg.action==='rematch' && ws.id===room.hostId && room.status==='finished'){
      room.players.forEach(p=>p.score=0); room.roundIndex=-1; room.status='playing'; advance(room); return;
    }
  });
  ws.on('close',()=>{
    const room=rooms.get(ws.roomCode); if(!room)return;
    const p=room.players.find(p=>p.id===ws.id); if(p){p.ws=null;}
    if(room.players.every(p=>!p.ws)){clearTimeout(room.timer);rooms.delete(room.code);}
    else broadcast(room);
  });
});
server.listen(PORT,()=>console.log(`JINX! running on http://localhost:${PORT}`));
