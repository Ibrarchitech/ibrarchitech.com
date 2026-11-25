(function(){var t0=Date.now(),els=document.querySelectorAll('.caa-tc');if(!els.length)return;
function pad(n){return String(n).padStart(2,'0')}
function tick(){var s=Math.floor((Date.now()-t0)/1000),tc='00:'+pad(Math.floor(s/60)%60)+':'+pad(s%60)+':'+pad((s*7)%24);for(var i=0;i<els.length;i++)els[i].textContent=tc}
tick();setInterval(tick,1000);})();
setTimeout(function(){var h=document.documentElement;if(!h.classList.contains('caa-3d'))h.classList.add('caa-no3d');},4000);
