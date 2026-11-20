import { INSPECTOR_BRIDGE_SCRIPT } from './inspector-bridge-script.ts';
import { ELEMENT_BRIDGE_SCRIPT } from './element-bridge-script.ts';
import { IMAGE_SOURCE_LIMIT, IMAGE_SOURCE_PATTERN } from './design-image.ts';
import { PROTOTYPE_BRIDGE_CSS, PROTOTYPE_BRIDGE_SCRIPT } from './prototype-bridge-script.ts';

export const BRIDGE_SCRIPT = `(()=>{
const root=document.getElementById('root');let channel='';let hostOrigin='';let selected=null;let serial=0;let stamp=0;
${INSPECTOR_BRIDGE_SCRIPT}
${ELEMENT_BRIDGE_SCRIPT}
const send=m=>parent.postMessage({...m,channel},'*');
${PROTOTYPE_BRIDGE_SCRIPT}
const imageSource=new RegExp(${JSON.stringify(IMAGE_SOURCE_PATTERN)});
const pathPattern=/^\\d{1,5}(?:\\.\\d{1,5}){0,23}$/;
function elementPath(el){const parts=[];while(el!==root&&parts.length<24){const parent=el.parentElement;if(!parent)return '';parts.unshift(Array.prototype.indexOf.call(parent.children,el));el=parent}const path=parts.join('.');return el===root&&pathPattern.test(path)?path:''}
function clearSelection(){endGesture(false);finishText(false);selected=null;paintSelection()}
function select(el){
  if(!el||el===root)return;
  selected=el;const id=el.dataset.ormiNode||'n'+(++serial);el.dataset.ormiNode=id;
  const leaf=textLayer(el);
  const text=leaf?(el.textContent||'').slice(0,500):'';
  const image=el.tagName==='IMG'?{alt:el.alt.slice(0,500)}:{};
  const action=prototypeAction(el);
  send({type:'selected',id,path:elementPath(el),tag:el.tagName.toLowerCase(),leaf,text,...image,...(action?{prototypeAction:action}:{}),...inspectorSnapshot(el)});paintSelection();
}
function serialize(){
  const clone=root.cloneNode(true);
  if(textEdit){const path=elementPath(textEdit.el);if(path){
    const copy=path.split('.').reduce((node,index)=>node.children[Number(index)],clone);
    copy.textContent=textEdit.original;copy.removeAttribute('contenteditable');
  }}
  clone.querySelectorAll('[data-ormi-node]').forEach(el=>el.removeAttribute('data-ormi-node'));
  send({type:'serialized',stamp,html:clone.innerHTML});
}
function manageLayer(el,action){
  if(!supported(el)||!root.contains(el))return;
  if(action==='duplicate'){
    const copy=el.cloneNode(true);
    for(const node of [copy,...copy.querySelectorAll('*')]){node.removeAttribute('id');node.removeAttribute('data-ormi-node')}
    el.after(copy);
    for(const prop of ['left','top']){
      const value=parseFloat(copy.style[prop]);
      if(Number.isFinite(value))copy.style[prop]=Math.min(4000,Math.round(value+32))+'px';
    }
    select(copy);
  }else if(action==='remove'){
    const next=el.nextElementSibling??el.previousElementSibling??el.parentElement;
    el.remove();
    if(next!==root)select(next);
    else{clearSelection();send({type:'selectionCleared'})}
  }else return;
  serialize();
}
function placeInserted(host,el){
  if(!host)return;
  const positioned=node=>{
    const inline=node.style&&node.style.position;
    if(inline&&inline!=='static')return true;
    try{return getComputedStyle(node).position!=='static'}catch{return false}
  };
  if(host!==document.documentElement&&!positioned(host))host.style.position='relative';
  const previous=[...host.children].filter(child=>child!==el);
  const gap=28,origin=48;
  const measured=previous.reduce((bottom,child)=>Math.max(bottom,(child.offsetTop||0)+(child.offsetHeight||0)),0);
  const stacked=previous.filter(child=>child.style&&child.style.position==='absolute').length;
  const top=measured>0?measured+gap:origin+stacked*72;
  const left=origin+(measured>0?0:stacked*36);
  el.style.position='absolute';
  el.style.left=Math.min(4000,left)+'px';
  el.style.top=Math.min(4000,top)+'px';
  el.style.margin='0';
}
function insertLayer(kind,source){
  const presets={
    text:['p','Text','font-size:20px;line-height:1.4;color:#1c2430;width:360px'],
    heading:['h2','Heading','font-size:48px;line-height:1.15;font-weight:700;color:#1c2430'],
    button:['button','Button','font-size:18px;font-weight:600;line-height:1.2;padding:14px 22px;border-width:0;border-style:none;border-radius:10px;background-color:#1c2430;color:#ffffff'],
    container:['div','','width:320px;height:180px;padding:16px;border:1px dashed #888'],
    rectangle:['div','','width:320px;height:200px;background-color:#a4adb9;border-radius:12px'],
    image:['img','','display:block;width:320px;max-width:100%;height:auto;object-fit:contain']
  };
  if(!Object.hasOwn(presets,kind))return;
  const [tag,text,css]=presets[kind],el=document.createElement(tag);
  el.textContent=text;
  if(tag==='button')el.type='button';
  if(css)el.style.cssText=css;
  if(kind==='image'){
    if(!validImage(source))return;
    el.src=source;el.alt='';
  }
  const container=node=>['MAIN','DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','FIGURE'].includes(node?.tagName);
  let host=root;
  if(container(selected)){selected.append(el);host=selected}
  else if(selected&&container(selected.parentElement)){selected.after(el);host=selected.parentElement}
  else if(root.children.length===1&&container(root.firstElementChild)){root.firstElementChild.append(el);host=root.firstElementChild}
  else root.append(el);
  placeInserted(host,el);
  if(tag==='IMG')el.addEventListener('load',paintSelection,{once:true});
  select(el);el.scrollIntoView?.({block:'nearest',inline:'nearest'});serialize();
}
function validImage(source){return typeof source==='string'&&source.length<=${IMAGE_SOURCE_LIMIT}&&imageSource.test(source)}
function replaceImage(el,source){
  if(!validImage(source))return;
  const {naturalWidth:width,naturalHeight:height}=el;
  const computed=getComputedStyle(el);
  if(width>0&&height>0&&!computed.contain.split(' ').some(item=>['size','strict'].includes(item))){
    if(computed.aspectRatio.includes('auto')||!computed.aspectRatio)el.style.aspectRatio=width+' / '+height;
    el.style.containIntrinsicSize=width+'px '+height+'px';
    el.style.contain=computed.contain==='none'||!computed.contain?'size':computed.contain==='content'?'size layout style paint':computed.contain+' size';
  }
  el.src=source;
  el.addEventListener('load',paintSelection,{once:true});
  select(el);serialize();
}
window.addEventListener('message',event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  const m=event.data;
  const shapes={init:['html','styles','tokenStyles','stamp','editable','interactive','zoom','playback','enabled','hints'],render:['html','styles','tokenStyles','stamp'],setTokenStyles:['tokenStyles'],
    selectPath:['path'],clearSelection:[],editText:['id','text'],editStyle:['id','property','value'],editStyles:['id','patch'],
    alignElement:['id','axis','alignment'],exportLayer:['id'],addElement:['id','kind','source'],manageLayer:['id','action'],
    replaceImage:['id','source'],imageAlt:['id','alt'],configureEditor:['editable','interactive','zoom'],editPrototype:['id','action'],
    configurePlayback:['enabled','hints'],serialize:[]};
  if(typeof m.type!=='string'||!Object.hasOwn(shapes,m.type)||Object.keys(m).some(k=>!['type','channel',...shapes[m.type]].includes(k))
    ||('id'in m&&(typeof m.id!=='string'||!/^n[0-9]{1,10}$/.test(m.id))))return;
  if(!channel){if(m.type!=='init'||typeof m.channel!=='string'||m.channel.length<20||m.channel.length>100)return;channel=m.channel;hostOrigin=event.origin}
  else if(event.origin!==hostOrigin||m.channel!==channel)return;
  if(m.type==='init'||m.type==='render'){
    if(typeof m.html!=='string'||m.html.length>65536||typeof m.styles!=='string'||m.styles.length>17408
      ||!applyInspectorTokenStyles(m.tokenStyles??''))return;
    clearSelection();stamp=Number.isSafeInteger(m.stamp)?m.stamp:0;
    root.innerHTML=m.html;
    let style=document.head.querySelector('#design-styles');
    if(!style){style=document.createElement('style');style.id='design-styles';document.head.append(style)}
    style.textContent=m.styles;
    if(m.type==='init'){playback=m.playback===true;configurePlayback(m);configureEditor(!playback&&m.editable,m.interactive,m.zoom)}
    if(playback)preparePlayback();
    return;
  }
  if(playback){if(m.type==='configurePlayback')configurePlayback(m);return}
  if(m.type==='configureEditor'){configureEditor(m.editable,m.interactive,m.zoom);return}
  if(m.type==='setTokenStyles'){if(applyInspectorTokenStyles(m.tokenStyles)&&selected)select(selected);return}
  if(m.type==='clearSelection'){clearSelection();return}
  if(m.type==='selectPath'){
    if(typeof m.path!=='string'||!pathPattern.test(m.path))return;
    const el=m.path.split('.').reduce((node,index)=>node?.children[Number(index)],root);
    if(el){el.scrollIntoView?.({block:'nearest',inline:'nearest'});select(el)}return;
  }
  const target=typeof m.id==='string'&&selected?.dataset.ormiNode===m.id?selected:null;
  if(m.type==='exportLayer'){if(target)exportInspectorLayer(target);return}
  if(!editable||gesture||textEdit)return;
  if(m.type==='editPrototype'&&target){
    if(m.action==='')target.removeAttribute(prototypeAttribute);
    else if(typeof m.action==='string'&&prototypePattern.test(m.action))target.setAttribute(prototypeAttribute,m.action);
    else return;
    select(target);serialize();return;
  }
  if(m.type==='editText'&&textLayer(target)&&typeof m.text==='string'&&m.text.length<=500){
    target.textContent=m.text;select(target);serialize();return;
  }
  if(m.type==='editStyle'){if(target&&typeof m.property==='string')applyInspectorStyles(target,{[m.property]:m.value});return}
  if(m.type==='editStyles'){if(target)applyInspectorStyles(target,m.patch);return}
  if(m.type==='alignElement'){if(target)alignInspectorLayer(target,m.axis,m.alignment);return}
  if(m.type==='addElement'){if(m.id===undefined?!selected:target)insertLayer(m.kind,m.source);return}
  if(m.type==='manageLayer'){if(target)manageLayer(target,m.action);return}
  if(m.type==='replaceImage'){if(target?.tagName==='IMG')replaceImage(target,m.source);return}
  if(m.type==='imageAlt'){if(target?.tagName==='IMG'&&typeof m.alt==='string'&&m.alt.length<=500){target.alt=m.alt;select(target);serialize()}return}
  if(m.type==='serialize')serialize();
});root.addEventListener('click',event=>{
  const el=event.target;
  if(!(el instanceof Element)||!root.contains(el)||textEdit)return;
  event.preventDefault();event.stopPropagation();
  if(playback){if(playing)triggerPrototype(el);return}
  if(el===root){clearSelection();send({type:'selectionCleared'})}
  else select(el);
});})();`;
export const BRIDGE_HASH = '+eYBMn5UKnoOAKcGpaP7KhYvTQxBQZNFsrH86Zg60/I=';
export const BRIDGE_SRC_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${BRIDGE_HASH}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"><style>html,body,#root{height:100%;margin:0}*,*::before,*::after{box-sizing:border-box}#root>svg:only-child{display:block}${PROTOTYPE_BRIDGE_CSS}</style></head><body><div id="root"></div><script>${BRIDGE_SCRIPT}</script></body></html>`;
