"use strict";(()=>{var L=Object.defineProperty;var $=(r,e,t)=>e in r?L(r,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):r[e]=t;var d=(r,e,t)=>$(r,typeof e!="symbol"?e+"":e,t);var c="roommate.",w=`${c}player`,p=`${c}name-asked`,M=20,C=10080*60,q=365*24*60*60,f=class{constructor(e){d(this,"options",e);d(this,"player");d(this,"best");d(this,"ready");d(this,"flushing");d(this,"rankingValue",{status:"idle"});d(this,"rankingLoad");d(this,"deleteValue","idle");d(this,"deleteRun");d(this,"nameValue");d(this,"holdScores",!1);d(this,"bestKey");d(this,"pendingKey");d(this,"now");this.now=e.now??(()=>new Date),this.bestKey=`${c}best.${e.game}`,this.pendingKey=`${c}pending.${e.game}`;let t=Number(this.read(this.bestKey));this.best=Number.isSafeInteger(t)&&t>0?t:void 0,this.ready=this.start()}isReady(){return this.player!==void 0}bestScore(){return this.best}rankingState(){return this.rankingValue}requestRanking(){return this.rankingValue.status==="loading"&&this.rankingLoad?this.rankingLoad:(this.rankingValue={status:"loading"},this.rankingLoad=this.loadRanking().then(e=>{this.rankingValue=e}).catch(()=>{this.rankingValue={status:"failed"}}),this.rankingLoad)}async loadRanking(){let e=_(this.now());await this.flush().catch(()=>{});let[t,i]=await Promise.all([this.options.fetch(`${this.gamePath()}/rankings/${e}`,{cache:"no-cache"}).then(async n=>{if(!n.ok)throw new Error(`HTTP ${n.status}`);return(await n.json()).entries}),this.loadMyRank(e)]);return{status:"ready",day:e,entries:t,myRank:i}}async loadMyRank(e){let t=await this.ready;if(!t)return null;try{let i=await this.options.fetch(`${this.gamePath()}/scores/me?day=${e}`,{headers:{Authorization:`Bearer ${t.token}`}});return i.ok?(await i.json()).rank??null:null}catch{return null}}deleteState(){return this.deleteValue}requestDelete(){return this.deleteValue==="deleting"&&this.deleteRun?this.deleteRun:this.deleteValue==="done"?Promise.resolve():(this.deleteValue="deleting",this.holdScores=!0,this.deleteRun=this.deleteAll().then(()=>{this.deleteValue="done"}).catch(()=>{this.deleteValue="failed",this.holdScores=!1}),this.deleteRun)}async deleteAll(){await this.ready,await this.flushing?.catch(()=>{});let e=this.player?.token??this.storedPlayer()?.token;if(e){let t=await this.options.fetch(`${this.options.apiOrigin}/players/me`,{method:"DELETE",headers:{Authorization:`Bearer ${e}`}});if(!t.ok)throw new Error(`HTTP ${t.status}`)}this.removeAllKeys(),this.player=void 0,this.ready=Promise.resolve(void 0),this.best=void 0,this.nameValue=void 0,this.rankingValue={status:"idle"}}playerId(){return this.player?.playerId}name(){return this.nameValue}async loadName(){let e=await this.ready;if(!(!e||this.deleteValue==="done")){try{let t=await this.options.fetch(`${this.options.apiOrigin}/players/me`,{headers:{Authorization:`Bearer ${e.token}`}});if(!t.ok)return;this.nameValue=(await t.json()).name}catch{return}return this.nameValue}}async shouldAskName(){return this.read(p)!==null?!1:await this.loadName()===null&&this.read(p)===null}markNameAsked(){this.write(p,"1")}async setName(e){if(this.deleteValue!=="idle"&&this.deleteValue!=="failed")return"failed";let t=await this.ready;if(!t)return"failed";let i=JSON.stringify({name:e}),n;try{if(n=await this.putName(t,i),n.status===401){if(t=await this.reissue(),!t)return"failed";n=await this.putName(t,i)}if(n.status===400)return"invalid";if(!n.ok)return"failed";this.nameValue=(await n.json()).name}catch{return"failed"}return this.markNameAsked(),"saved"}putName(e,t){return this.options.fetch(`${this.options.apiOrigin}/players/me/name`,{method:"PUT",headers:{Authorization:`Bearer ${e.token}`,"Content-Type":"application/json"},body:t})}async token(){return(await this.ready)?.token}submitScore(e,t){return this.deleteValue==="done"?Promise.resolve():(this.raiseBest(e),this.enqueue({day:_(this.now()),score:e,durationMs:t}),this.flush().catch(()=>{}))}async flush(){if(!this.holdScores)return this.flushing?this.flushing:(this.flushing=(async()=>{try{if(!await this.ready)return;for(;;){if(this.holdScores)return;let[t]=this.pending();if(!t||await this.deliver(t)==="retry")return;this.writePending(this.pending().slice(1))}}finally{this.flushing=void 0}})(),this.flushing)}async deliver(e){let t=await this.ready;if(!t)return"retry";let i=JSON.stringify(e),n;try{if(n=await this.postScore(t,i),n.status===401){if(t=await this.reissue(),!t)return"retry";n=await this.postScore(t,i)}}catch{return"retry"}if(n.ok){let{best:o}=await n.json();return o!==null&&this.raiseBest(o),"done"}return n.status===429||n.status>=500?"retry":"done"}pending(){try{let e=JSON.parse(this.read(this.pendingKey)??"[]");return Array.isArray(e)?e:[]}catch{return[]}}enqueue(e){this.writePending([...this.pending(),e].slice(-M))}writePending(e){e.length===0?this.remove(this.pendingKey):this.write(this.pendingKey,JSON.stringify(e))}async start(){let e;try{e=await this.ensurePlayer()}catch{return}return this.player=e,await this.loadBest(e).catch(()=>{}),setTimeout(()=>{this.flush().catch(()=>{})},0),e}async ensurePlayer(){let e=this.storedPlayer(),t=Math.floor(this.now().getTime()/1e3),i=e?e.expiresAt-t:-1/0;if(e&&i>-q){if(i>C)return e;let n=await this.request("/players/me/token",e.token);if(n?.ok)return this.savePlayer(await n.json());if(n?.status!==401){if(i>0)return e;throw new Error("\u533F\u540D ID \u3092\u767A\u884C\u3057\u76F4\u305B\u306A\u304B\u3063\u305F")}}return this.issue()}async issue(){let e=await this.request("/players");if(!e?.ok)throw new Error("\u533F\u540D ID \u3092\u767A\u884C\u3067\u304D\u306A\u304B\u3063\u305F");return this.savePlayer(await e.json())}async reissue(){let e=await this.issue().catch(()=>{});return e&&(this.player=e,this.ready=Promise.resolve(e)),e}postScore(e,t){return this.options.fetch(`${this.gamePath()}/scores`,{method:"POST",headers:{Authorization:`Bearer ${e.token}`,"Content-Type":"application/json"},body:t})}async loadBest(e){let t=await this.options.fetch(`${this.gamePath()}/scores/me`,{headers:{Authorization:`Bearer ${e.token}`}});if(!t.ok)return;let{best:i}=await t.json(),n=this.pending().map(o=>o.score);i!==null&&n.push(i),this.setBest(n.length>0?Math.max(...n):void 0)}async request(e,t){try{return await this.options.fetch(`${this.options.apiOrigin}${e}`,{method:"POST",headers:t?{Authorization:`Bearer ${t}`}:{}})}catch{return}}raiseBest(e){this.best!==void 0&&this.best>=e||this.setBest(e)}setBest(e){this.best=e,e===void 0?this.remove(this.bestKey):this.write(this.bestKey,String(e))}storedPlayer(){try{let e=JSON.parse(this.read(w)??"null");return e&&typeof e.token=="string"?e:void 0}catch{return}}savePlayer(e){return this.write(w,JSON.stringify(e)),e}gamePath(){return`${this.options.apiOrigin}/games/${encodeURIComponent(this.options.game)}`}removeAllKeys(){let e=[];try{for(let t=0;t<this.options.storage.length;t++){let i=this.options.storage.key(t);i?.startsWith(c)&&e.push(i)}}catch{}for(let t of new Set([...e,w,p,this.bestKey,this.pendingKey]))this.remove(t)}read(e){try{return this.options.storage.getItem(e)}catch{return null}}write(e,t){try{this.options.storage.setItem(e,t)}catch{}}remove(e){try{this.options.storage.removeItem(e)}catch{}}};function _(r){return r.toISOString().slice(0,10)}var I=`
.roommate-name-dialog {
  --rm-bg: #fffaf0; --rm-fg: #3a2a1e; --rm-muted: #7a6656; --rm-line: #e6d6bd;
  --rm-accent: #ff9852; --rm-on-accent: #3a2a1e; --rm-error: #b3261e;
  box-sizing: border-box;
  width: min(22rem, calc(100vw - 32px));
  margin: auto;
  padding: 24px;
  border: 1px solid var(--rm-line);
  border-radius: 16px;
  background: var(--rm-bg);
  color: var(--rm-fg);
  font: 15px/1.6 system-ui, sans-serif;
  word-break: auto-phrase;
  text-wrap: pretty;
}
@media (prefers-color-scheme: dark) {
  .roommate-name-dialog {
    --rm-bg: #272019; --rm-fg: #fff1dc; --rm-muted: #bca88f; --rm-line: #4a3e31;
    --rm-error: #ff9c8f;
  }
}
.roommate-name-dialog:modal { overscroll-behavior: contain; }
.roommate-name-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  overflow: hidden;
  overscroll-behavior: contain;
}
.roommate-name-dialog h2 { margin: 0; font-size: 18px; line-height: 1.4; }
.roommate-name-dialog .rm-lead { margin: 4px 0 0; color: var(--rm-muted); font-size: 14px; }
.roommate-name-dialog input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid var(--rm-muted);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
  line-height: 1.4;
}
.roommate-name-dialog input:focus-visible {
  outline: 2px solid var(--rm-fg);
  outline-offset: -1px;
}
.roommate-name-dialog input[aria-invalid="true"] {
  border-color: var(--rm-error);
  outline-color: var(--rm-error);
}
.roommate-name-dialog .rm-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 8px;
  color: var(--rm-muted);
  font-size: 13px;
  line-height: 1.5;
}
.roommate-name-dialog .rm-preview,
.roommate-name-dialog .rm-error { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.roommate-name-dialog .rm-preview b { color: var(--rm-fg); font-weight: 600; }
.roommate-name-dialog .rm-error { color: var(--rm-error); }
.roommate-name-dialog .rm-count { flex: none; font-variant-numeric: tabular-nums; }
.roommate-name-dialog .rm-count[data-over] { color: var(--rm-error); font-weight: 600; }
.roommate-name-dialog .rm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
.roommate-name-dialog button {
  min-height: 40px;
  padding: 0 20px;
  border: 1px solid var(--rm-line);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.roommate-name-dialog button[type="submit"] {
  border-color: var(--rm-accent);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-weight: 700;
}
.roommate-name-dialog button:disabled { opacity: 0.6; cursor: default; }
.roommate-name-dialog button:focus-visible { outline: 2px solid var(--rm-fg); outline-offset: 2px; }
.roommate-name-dialog [hidden] { display: none; }
`,S={tooLong:`${12} \u6587\u5B57\u307E\u3067\u306B\u3057\u3066\u304F\u3060\u3055\u3044`,invalid:"# \u3068\u898B\u3048\u306A\u3044\u6587\u5B57\u306F\u4F7F\u3048\u307E\u305B\u3093",failed:"\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u8A66\u3057\u3066\u304F\u3060\u3055\u3044"};function N(r){return r.normalize("NFC").trim().replace(/\s+/gu," ")}function R(r,e=document){let t,i=!1;function n(){let s=e.createElement("style");s.textContent=I,e.head.append(s);let a=e.createElement("dialog");a.className="roommate-name-dialog",a.setAttribute("aria-labelledby","roommate-name-title"),a.innerHTML=`
      <form method="dialog" novalidate>
        <h2 id="roommate-name-title">\u30E9\u30F3\u30AD\u30F3\u30B0\u306B\u51FA\u3059\u540D\u524D</h2>
        <p class="rm-lead" id="roommate-name-lead">\u540C\u3058\u30B3\u30FC\u30B9\u306E\u4EBA\u3068\u3001\u3053\u306E\u540D\u524D\u3067\u7AF6\u3044\u307E\u3059\u3002</p>
        <input name="name" autocomplete="nickname" enterkeyhint="done" spellcheck="false"
          aria-labelledby="roommate-name-title"
          aria-describedby="roommate-name-lead roommate-name-preview roommate-name-error" />
        <div class="rm-meta">
          <p class="rm-preview" id="roommate-name-preview"></p>
          <p class="rm-error" id="roommate-name-error" role="alert" hidden></p>
          <span class="rm-count" aria-hidden="true"></span>
        </div>
        <div class="rm-actions">
          <button type="button" data-action="cancel"></button>
          <button type="submit"></button>
        </div>
      </form>`,e.body.append(a);let l=a.querySelector("input"),g=a.querySelector("form");return l.addEventListener("paste",u=>u.stopPropagation()),l.addEventListener("input",()=>k(a,r)),a.querySelector('[data-action="cancel"]').addEventListener("click",()=>a.close()),a.addEventListener("cancel",u=>{i&&u.preventDefault()}),a.addEventListener("close",()=>{e.querySelector("#glcanvas")?.focus()}),g.addEventListener("submit",u=>{if(u.preventDefault(),i)return;let b=N(l.value),E=D(b);if(E){v(a,S[E]),l.focus();return}if(b===""&&a.dataset.mode==="first"){a.close();return}o(a,!0),r.setName(b).then(x=>{o(a,!1),x==="saved"?a.close():(v(a,S[x]),l.focus())})}),a}function o(s,a){i=a;let l=s.querySelector('button[type="submit"]');l.disabled=a,l.textContent=a?"\u4FDD\u5B58\u4E2D\u2026":"\u6C7A\u3081\u308B"}return{open(s){if(r.deleteState()==="done"||(t??(t=n()),t.open))return;let a=t;a.dataset.mode=s,a.querySelector(".rm-lead").hidden=s!=="first",a.querySelector('[data-action="cancel"]').textContent=s==="first"?"\u3042\u3068\u3067":"\u3084\u3081\u308B",o(a,!1);let l=a.querySelector("input");l.value=r.name()??"",k(a,r),r.name()===void 0&&r.loadName().then(g=>{g&&l.value===""&&(l.value=g,k(a,r))}),s==="first"&&r.markNameAsked(),a.showModal()},isOpen(){return t?.open??!1}}}function D(r){if([...r].length>12)return"tooLong";if(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}#＃]/u.test(r))return"invalid"}function k(r,e){let t=N(r.querySelector("input").value),i=[...t].length,n=r.querySelector(".rm-count");n.textContent=`${i}/${12}`,n.toggleAttribute("data-over",i>12);let o=D(t);if(o){v(r,S[o]);return}v(r,"");let s=r.querySelector(".rm-preview"),a=e.playerId();if(!a){s.replaceChildren();return}let l=r.ownerDocument.createElement("b");l.textContent=`${t||"\u540D\u7121\u3057"}#${a.slice(0,4)}`,s.replaceChildren("\u30E9\u30F3\u30AD\u30F3\u30B0\u3067\u306E\u8868\u793A: ",l)}function v(r,e){let t=r.querySelector(".rm-error");t.textContent=e,t.hidden=e==="",r.querySelector(".rm-preview").hidden=e!=="",r.querySelector("input").setAttribute("aria-invalid",String(e!==""))}var V="https://api.roommate.hayashi-naoki.com",A=document.currentScript,T=A?.dataset.game;if(!T)throw new Error("roommate-sdk.js: data-game \u306B\u30B2\u30FC\u30E0\u306E slug \u3092\u66F8\u304F");var P;try{P=window.localStorage}catch{let r=new Map;P={getItem:e=>r.get(e)??null,setItem:(e,t)=>{r.set(e,t)},removeItem:e=>{r.delete(e)},key:e=>[...r.keys()][e]??null,get length(){return r.size}}}var m=new f({apiOrigin:A?.dataset.api??V,game:T,fetch:window.fetch.bind(window),storage:P}),h=R(m);window.roommate={client:m,openNameDialog:()=>h.open("change"),isNameDialogOpen:()=>h.isOpen()};m.shouldAskName().then(r=>{r&&h.open("first")});miniquad_add_plugin({name:"roommate_sdk",version:1,register_plugin(r){r.env.roommate_is_ready=()=>m.isReady()?1:0,r.env.roommate_best_score=()=>m.bestScore()??-1,r.env.roommate_submit_score=(n,o)=>{m.submitScore(n,o)};let e=()=>{let n=m.rankingState();return n.status==="ready"?n:void 0},t={idle:0,loading:1,ready:2,failed:3};r.env.roommate_request_ranking=()=>{m.requestRanking()},r.env.roommate_ranking_status=()=>t[m.rankingState().status],r.env.roommate_ranking_len=()=>e()?.entries.length??0,r.env.roommate_ranking_my_rank=()=>e()?.myRank??-1,r.env.roommate_ranking_rank=n=>e()?.entries[n]?.rank??0,r.env.roommate_ranking_score=n=>e()?.entries[n]?.score??0,r.env.roommate_ranking_name=(n,o,s)=>{let a=new TextEncoder().encode(e()?.entries[n]?.name??"");return new Uint8Array(wasm_memory.buffer,o,s).set(a.subarray(0,s)),a.length};let i={idle:0,deleting:1,done:2,failed:3};r.env.roommate_request_delete=()=>{m.requestDelete()},r.env.roommate_delete_status=()=>i[m.deleteState()],r.env.roommate_open_name_dialog=()=>h.open("change"),r.env.roommate_name_dialog_open=()=>h.isOpen()?1:0}});})();
