const selectionChrome = `<style>
  div {
    position: absolute;
    box-sizing: border-box;
    box-shadow: inset 0 0 0 calc(1px * var(--grip-scale)) #6b7688,
      0 0 0 calc(1px * var(--grip-scale)) #fff9;
  }
  button {
    --edge: #6b7688;
    --fill: #fafbfc;
    --shadow: 0 1px 3px #161c303d;
    position: absolute;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #535e70;
    pointer-events: auto;
    touch-action: none;
    scale: var(--grip-scale);
  }
  button[hidden] { display: none; }
  button:is(:hover, :active) {
    --edge: #434f61;
    --fill: #e7ebf1;
    --shadow: 0 0 0 2px #68738945, 0 1px 3px #161c303d;
  }
  button::before {
    content: "";
    grid-area: 1 / 1;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1px solid var(--edge);
    border-radius: 3px;
    background: var(--fill);
    box-shadow: var(--shadow);
  }
  button[data-grip=move] { left: 50%; top: 0; translate: -50% -50%; cursor: move; }
  button[data-grip=move]::before { width: 22px; height: 12px; border-radius: 6px; }
  button[data-grip=move]::after {
    content: "";
    grid-area: 1 / 1;
    width: 12px;
    height: 8px;
    background: radial-gradient(circle, currentColor 1px, transparent 1.2px) 0 0 / 4px 4px;
  }
  button[data-grip=e] { right: 0; top: 50%; translate: 50% -50%; cursor: ew-resize; }
  button[data-grip=e]::before { width: 6px; height: 14px; border-radius: 4px; }
  button[data-grip=s] { left: 50%; bottom: 0; translate: -50% 50%; cursor: ns-resize; }
  button[data-grip=s]::before { width: 14px; height: 6px; border-radius: 4px; }
  button[data-grip=se] { right: 0; bottom: 0; translate: 50% 50%; cursor: nwse-resize; }
</style><div></div>`;

export const ELEMENT_BRIDGE_SCRIPT = String.raw`
let editable=false, interactive=false, gripScale=1, chrome, box, gesture, textEdit;
const supported=el=>el instanceof HTMLElement && !['STYLE','TEMPLATE','BR','HR'].includes(el.tagName);
const textLayer=el=>supported(el)&&el.tagName!=='IMG'&&!el.children.length;
function configureEditor(enabled,direct,zoom){
  editable=enabled===true;
  interactive=editable&&direct===true;
  if(typeof zoom==='number'&&Number.isFinite(zoom)&&zoom>0)gripScale=1/zoom;
  if(!interactive){endGesture(false);finishText(false)}
  paintSelection();
}
function paintSelection(){
  if(!selected&&!chrome)return;
  if(!chrome){
    chrome=document.createElement('div');
    chrome.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const shadow=chrome.attachShadow({mode:'closed'});
    shadow.innerHTML=${JSON.stringify(selectionChrome)};
    box=shadow.querySelector('div');
    for(const [kind,label] of [['move','Move element'],['e','Resize element width'],['s','Resize element height'],['se','Resize element']]){
      const grip=document.createElement('button');
      grip.type='button';grip.dataset.grip=kind;grip.title=label;grip.setAttribute('aria-label',label);grip.tabIndex=-1;
      grip.addEventListener('pointerdown',event=>startGesture(event,kind));
      grip.addEventListener('pointermove',previewGesture);
      grip.addEventListener('pointerup',event=>{if(gesture?.pointer===event.pointerId)endGesture(true)});
      grip.addEventListener('lostpointercapture',event=>{if(gesture?.pointer===event.pointerId)endGesture(false)});
      box.append(grip);
    }
    document.body.append(chrome);
  }
  if(!selected||!root.contains(selected)||textEdit){box.hidden=true;return}
  box.hidden=false;
  const r=selected.getBoundingClientRect();
  box.style.cssText='--grip-scale:'+gripScale+';left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';
  const showGrips=interactive&&supported(selected)&&r.width>0&&r.height>0&&getComputedStyle(selected).display!=='contents';
  for(const grip of box.children)grip.hidden=!showGrips;
}
function restoreStyle(el,value){if(value===null)el.removeAttribute('style');else el.setAttribute('style',value)}
const pixel=(n,min)=>Math.max(min,Math.min(99999,Math.round(n)))+'px';
function startGesture(event,kind){
  if(event.button!==0||!interactive||!selected||gesture)return;
  const el=selected, grip=event.currentTarget, computed=getComputedStyle(el);
  const {offsetWidth,offsetHeight}=el;
  if(!offsetWidth||!offsetHeight)return;
  event.preventDefault();
  grip.setPointerCapture(event.pointerId);
  const content= computed.boxSizing!=='border-box';
  const sum=keys=>keys.reduce((total,key)=>total+(parseFloat(computed[key])||0),0);
  const addX=content?sum(['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth']):0;
  const addY=content?sum(['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth']):0;
  const [tx='0',ty='0',tz]=computed.translate==='none'?[]:computed.translate.split(' ');
  if(kind==='move'&&tz){grip.releasePointerCapture(event.pointerId);return}
  const translate=(value,extent)=> (parseFloat(value)||0)*(value.endsWith('%')?extent/100:1);
  const parent=getComputedStyle(el.parentElement);
  const flex=parent.display.endsWith('flex')?parent.flexDirection.startsWith('column')?'height':'width':null;
  gesture={el,grip,kind,flex,pointer:event.pointerId,x:event.clientX,y:event.clientY,
    before:el.getAttribute('style'),inline:computed.display==='inline'&&el.tagName!=='IMG',
    width:offsetWidth,height:offsetHeight,addX,addY,tx:translate(tx,offsetWidth),ty:translate(ty,offsetHeight)};
}
function previewGesture(event){
  if(!gesture||gesture.pointer!==event.pointerId)return;
  const {el,kind,flex,before,inline,width,height,addX,addY,tx,ty}=gesture;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  restoreStyle(el,before);
  const patch={};
  if(Math.abs(dx)+Math.abs(dy)>=1){
    if(kind==='move')patch.translate=pixel(tx+dx,-99999)+' '+pixel(ty+dy,-99999);
    else{
      const ratio=event.shiftKey||el.tagName==='IMG'&&kind==='se';
      const w=kind.includes('e'),h=kind.includes('s');
      const xLeads=w&&(!h||Math.abs(dx)/width>=Math.abs(dy)/height);
      if(w||ratio)patch.width=pixel((ratio&&!xLeads?(height+dy)*width/height:width+dx)-addX,1);
      if(h||ratio)patch.height=pixel((ratio&&xLeads?(width+dx)*height/width:height+dy)-addY,1);
      if(inline)patch.display='inline-block';
      if(flex&&patch[flex])Object.assign(patch,{flexBasis:'auto',flexGrow:'0',flexShrink:'0'});
    }
  }
  for(const [property,value] of Object.entries(patch))if(validValue(property,value))el.style.setProperty(cssName(property),value);
  gesture.patch=patch;
  paintSelection();
}
function endGesture(commit){
  if(!gesture)return;
  const {el,grip,pointer,before,patch}=gesture;
  gesture=null;
  if(grip.hasPointerCapture(pointer))grip.releasePointerCapture(pointer);
  restoreStyle(el,before);
  if(commit&&patch&&Object.keys(patch).length)applyInspectorStyles(el,patch);
  else paintSelection();
}
function startText(el){
  if(!interactive||!textLayer(el)||textEdit||el.textContent.length>500)return;
  select(el);
  const original=el.textContent;
  textEdit={el,original};
  el.setAttribute('contenteditable','plaintext-only');
  el.focus({preventScroll:true});
  const range=document.createRange();range.selectNodeContents(el);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  paintSelection();
}
function finishText(commit){
  if(!textEdit)return;
  const {el,original}=textEdit;
  textEdit=null;
  const value=el.textContent.slice(0,500);
  el.textContent=commit?value:original;
  el.removeAttribute('contenteditable');
  if(commit&&original!==value){select(el);serialize()}
  else paintSelection();
}
root.addEventListener('dblclick',event=>{
  if(event.target instanceof HTMLElement&&textLayer(event.target)&&interactive){
    event.preventDefault();startText(event.target);
  }
});
root.addEventListener('focusout',event=>{if(event.target===textEdit?.el)finishText(true)});
window.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(textEdit){
    if(event.key==='Escape'||event.key==='Enter'){event.preventDefault();finishText(event.key==='Enter')}
    return;
  }
  if(event.key==='Escape'&&gesture){event.preventDefault();endGesture(false)}
  if(!interactive||!selected||gesture||event.altKey||event.repeat)return;
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();manageLayer(selected,'remove')}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();manageLayer(selected,'duplicate')}
});
window.addEventListener('scroll',paintSelection,true);
window.addEventListener('resize',paintSelection);
if(typeof ResizeObserver!=='undefined')new ResizeObserver(paintSelection).observe(root);
`;
