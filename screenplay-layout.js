/* Physical page layout shared by the editable view and PDF export.
   Scene containers remain Neo contenteditables. Positioning their existing
   paragraphs does not rebuild text nodes or move the writer's selection. */
'use strict';
(() => {
  const PX = 96, GAP = 28, TOP = 96, BOTTOM = 72, LINE = 16;
  let pending = 0;
  const metrics = () => {
    const letter = book?.screenplay?.pageSize === 'letter';
    return { width: letter ? 816 : 210 / 25.4 * PX, height: letter ? 1056 : 297 / 25.4 * PX };
  };
  const geometry = type => {
    if (type === 'character') return { left: 3.7 * PX, width: 3 * PX, before: LINE, after: 0 };
    if (type === 'dialogue') return { left: 2.5 * PX, width: 3.5 * PX, before: 0, after: 0 };
    if (type === 'parenthetical') return { left: 3 * PX, width: 2.5 * PX, before: 0, after: 0 };
    return { left: 1.5 * PX, width: metrics().width - 2.5 * PX, before: type === 'scene-heading' ? LINE : 0, after: LINE };
  };
  function cleanBody(body) {
    const clone = body.cloneNode(true);
    clone.querySelectorAll('.sp-page-gap').forEach(node => node.remove());
    clone.querySelectorAll('[data-element]').forEach(node => { node.removeAttribute('style'); node.removeAttribute('data-layout-y'); });
    return clone.innerHTML;
  }
  window.cleanScreenplayBody = cleanBody;
  captureBody = cleanBody;

  function layout() {
    cancelAnimationFrame(pending);pending=0;
    // Hidden manuscript paragraphs measure as zero-height. Laying them out
    // while Darlings or Outline is open makes multi-line elements overlap.
    if (!book || $('#editor-view').hidden || $('#paper').hidden) return;
    const { width, height } = metrics(), stride = height + GAP, usable = height - TOP - BOTTOM, zoom = library?.pageZoom || 1;
    const wrap = $('#chapters');
    wrap.classList.add('sp-paginated');
    wrap.style.width = width+'px';wrap.style.setProperty('--sp-page-height',height+'px');wrap.style.setProperty('--sp-stride',stride+'px');
    const elements = [...wrap.querySelectorAll('.chapter-body > [data-element]')];
    let page=0, used=0, previousAfter=0;
    elements.forEach((p,index) => {
      p.querySelectorAll('.sp-page-gap').forEach(node=>node.remove());
      // Page spacers split text nodes while a long paragraph is displayed.
      // Rejoin the temporary fragments before taking fresh measurements so a
      // reflow cannot accumulate a broken DOM around the writer's caret.
      p.normalize();
      const g=geometry(p.dataset.element);
      if(p.dataset.element==='action' && ['dialogue','parenthetical'].includes(elements[index-1]?.dataset.element))g.before=LINE;
      if(p.dataset.continuation)g.before=0;
      if(elements[index+1]?.dataset.continuation)g.after=0;
      Object.assign(p.style,{position:'absolute',left:g.left+'px',width:g.width+'px',maxWidth:'none',top:'0px',margin:'0',padding:'0',font:"12pt/16px 'Courier New', monospace",whiteSpace:'pre-wrap',overflowWrap:'anywhere',textIndent:'0'});
      let h=Math.max(LINE,p.offsetHeight);
      const following=elements[index+1];
      const keep = ['scene-heading','character','parenthetical'].includes(p.dataset.element) && following ? LINE : 0;
      // Adjacent elements may both request the same blank line. The previous
      // element's trailing space is already included in used, so add only the
      // remaining space needed before this element.
      let before=used ? Math.max(0,g.before-previousAfter) : 0;
      if(used && h<=usable && used+before+h+keep>usable){page++;used=0;before=0;}
      const y=page*stride+TOP+used+before;
      p.style.top=y+'px';p.dataset.layoutY=y;
      // Very long paragraphs are split visually with zero-text spacing at a
      // rendered line boundary. The spacer is never stored in manuscript HTML.
      if(h>usable-used-before){
        let available=usable-used-before;
        let threshold=available;
        let guard=0;
        while(h>threshold && guard++<100){
          const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
          let text, boundary=null;
          const pageTop=p.getBoundingClientRect().top;
          while((text=walker.nextNode()) && !boundary){
            if(!text.length)continue;
            const lineAt=i=>{
              const r=document.createRange();r.setStart(text,i);r.setEnd(text,i+1);
              const rect=r.getBoundingClientRect();
              return (rect.top-pageTop)/zoom;
            };
            // Most text nodes fit entirely on this page. One range measurement
            // cheaply rejects them; a binary search finds the first character
            // on the overflow line instead of forcing a layout per character.
            if(lineAt(text.length-1)<threshold-0.5)continue;
            let low=0,high=text.length-1;
            while(low<high){
              const mid=Math.floor((low+high)/2);
              if(lineAt(mid)>=threshold-0.5)high=mid;else low=mid+1;
            }
            boundary={text,i:low};
          }
          if(!boundary)break;
          const tail=boundary.text.splitText(boundary.i);
          const spacer=document.createElement('span');spacer.className='sp-page-gap';spacer.contentEditable='false';spacer.setAttribute('aria-hidden','true');
          spacer.style.cssText=`display:block;height:${TOP+BOTTOM+GAP}px;pointer-events:none;user-select:none`;
          tail.before(spacer);
          h=Math.max(LINE,p.offsetHeight);
          threshold+=stride;
        }
      }
      const end=y+h+g.after;
      page=Math.floor((end-TOP)/stride);used=end-page*stride-TOP;
      if(used>usable){page++;used=0;}
      previousAfter=g.after;
    });
    const last=elements.at(-1);
    const count=Math.max(1,last?Math.ceil((Number(last.dataset.layoutY)+last.offsetHeight+BOTTOM)/stride):1);
    wrap.style.height=(count*stride-GAP)+'px';wrap.dataset.pageCount=count;
    wrap.querySelectorAll(':scope > .sp-page-number').forEach(node=>node.remove());
    for(let i=0;i<count;i++){const n=document.createElement('span');n.className='sp-page-number';n.textContent=(i+1)+'.';n.style.top=(i*stride+48)+'px';wrap.append(n);}
  }
  window.paginateScreenplay=layout;
  window.scheduleScreenplayLayout=()=>{cancelAnimationFrame(pending);pending=requestAnimationFrame(layout);};
  document.addEventListener('input',event=>{if(event.target.closest?.('.chapter-body'))window.scheduleScreenplayLayout();});
  window.addEventListener('resize',window.scheduleScreenplayLayout);
  window.screenplayPrintHtml=()=>{
    const paper=$('#paper'), wasHidden=paper.hidden;
    if(wasHidden)paper.hidden=false;
    try {
    layout();
    const {width,height}=metrics(), stride=height+GAP, m=book.screenplay||{};
    const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const elements=[...$('#chapters').querySelectorAll('.chapter-body > [data-element]')];
    const count=Number($('#chapters').dataset.pageCount)||1;
    const pages=[];
    for(let page=0;page<count;page++){
      const start=page*stride,end=start+height;
      const content=elements.filter(p=>Number(p.dataset.layoutY)<end && Number(p.dataset.layoutY)+p.offsetHeight>start).map(p=>{
        const copy=p.cloneNode(true);copy.querySelectorAll('.ph-mark,.darling-anchor').forEach(node=>node.remove());copy.style.top=(Number(p.dataset.layoutY)-start)+'px';copy.removeAttribute('data-layout-y');return copy.outerHTML;
      }).join('');
      pages.push(`<section class="page"><span class="number">${page+1}.</span>${content}</section>`);
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${width}px ${height}px;margin:0}*{box-sizing:border-box}body{margin:0;color:#111;font:12pt/16px 'Courier New',monospace}
      .page{position:relative;width:${width}px;height:${height}px;overflow:hidden;break-after:page}.page:last-child{break-after:auto}
      .number{position:absolute;top:48px;right:96px}.title{text-align:center;padding:300px 96px 96px}.title h1{font:12pt/24px 'Courier New',monospace;text-transform:uppercase;white-space:pre-wrap}.contact{position:absolute;bottom:96px;left:144px;text-align:left;white-space:pre-wrap}
      p{min-height:16px;margin:0}[data-element="scene-heading"],[data-element="character"],[data-element="transition"]{text-transform:uppercase}[data-element="transition"]{text-align:right}
    </style></head><body><section class="page title"><h1>${escape(book.title||'UNTITLED')}</h1><p>Written by</p><p>${escape(m.writer||book.author)}</p><div class="contact">${escape(m.contact)}</div></section>${pages.join('')}</body></html>`;
    } finally { paper.hidden=wasHidden; }
  };
})();
