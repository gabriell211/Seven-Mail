(function(){
var M=[
{n:"Marina Prado",i:"MP",c:"#7c6cf0",s:"Projeto · revisão final",t:"10:42",b:"Segue a atualização para nossa reunião. Podemos revisar os pontos principais nesta semana."},
{n:"Daniel Silva",i:"DS",c:"#3b82c4",s:"Agenda da semana",t:"09:18",b:"Confirme os horários quando puder. Tenho quarta à tarde e quinta de manhã livres."},
{n:"Equipe Seven",i:"EQ",c:"#16866f",s:"Bem-vindo ao Seven Mail",t:"Ontem",b:"Organize suas contas em um só lugar: e-mail, calendário, contatos e tarefas."},
{n:"Ana Costa",i:"AC",c:"#c2570c",s:"Documentos do projeto",t:"Ontem",b:"Os materiais estão disponíveis. Me avise se faltar alguma coisa."}];
var cur=0,off=false,q=0,note="",gem=false;
var list=document.getElementById("list"),read=document.getElementById("read"),app=document.getElementById("app"),sw=document.getElementById("sw");
function esc(s){return s.replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
function draw(){
list.innerHTML=M.map(function(m,k){return '<button class="msg" role="option" aria-selected="'+(k===cur)+'" data-k="'+k+'"><span class="av" style="--c:'+m.c+'">'+m.i+'</span><div><strong>'+m.n+' <small style="font-weight:400;color:var(--mut)">'+m.t+'</small></strong><span>'+esc(m.s)+'</span></div></button>'}).join("");
var m=M[cur];
if(gem){read.className="read gv";read.innerHTML='<div class="ctx"><svg class="ic"><use href="#i-shield"/></svg>Contexto: sua conta · somente leitura</div><div class="mid"><span class="fi"><svg class="ic"><use href="#i-spark"/></svg></span><b>Como posso ajudar?</b><p>Pergunte sobre seus e-mails ou arquivos.</p></div><div class="inp">Pergunte ao Gemini...</div>';return}
var st=off?(q?q+(q>1?" respostas":" resposta")+" na fila de envio":"Sem conexão. Rascunhos e fila de envio disponíveis"):(note||"Conectado. Tudo sincronizado");
read.className="read"+(off?" off":"");
read.innerHTML='<div class="status" role="status"><svg class="ic"><use href="#'+(off?"i-wifi":"i-shield")+'"/></svg>'+st+'</div><h3>'+esc(m.s)+'</h3><div class="who"><span class="av" style="--c:'+m.c+'">'+m.i+'</span><div><b>'+m.n+'</b><small>Para mim · '+m.t+'</small></div></div><p>Olá!</p><p>'+esc(m.b)+'</p><button class="reply" id="rp"><svg class="ic"><use href="#i-send"/></svg>Responder</button>';
}
list.addEventListener("click",function(e){var b=e.target.closest(".msg");if(b){cur=+b.dataset.k;note="";gem=false;document.getElementById("gem").setAttribute("aria-pressed","false");draw()}});
read.addEventListener("click",function(e){if(!e.target.closest("#rp"))return;if(off){q++}else{note="Resposta enviada"}draw();var r=document.getElementById("rp");if(r)r.focus()});
sw.addEventListener("click",function(){off=!off;sw.setAttribute("aria-checked",off);if(!off){note=q?q+(q>1?" respostas enviadas":" resposta enviada")+" ao reconectar":"";q=0}else note="";draw()});
document.getElementById("gem").addEventListener("click",function(){gem=!gem;this.setAttribute("aria-pressed",gem);draw()});
draw();
})();
