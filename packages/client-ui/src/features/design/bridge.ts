import { INSPECTOR_BRIDGE_SCRIPT } from './inspector-bridge-script.ts';
import { ELEMENT_BRIDGE_SCRIPT } from './element-bridge-script.ts';
import { IMAGE_SOURCE_LIMIT, IMAGE_SOURCE_PATTERN } from './design-image.ts';

export const BRIDGE_SCRIPT = `(()=>{
const root=document.getElementById('root');let channel='';let hostOrigin='';let selected=null;let serial=0;let stamp=0;
${INSPECTOR_BRIDGE_SCRIPT}
${ELEMENT_BRIDGE_SCRIPT}
const send=m=>parent.postMessage({...m,channel},'*');
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
  send({type:'selected',id,path:elementPath(el),tag:el.tagName.toLowerCase(),leaf,text,...image,...inspectorSnapshot(el)});paintSelection();
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
    el.after(copy);select(copy);
  }else if(action==='remove'){
    const next=el.nextElementSibling??el.previousElementSibling??el.parentElement;
    el.remove();
    if(next!==root)select(next);
    else{clearSelection();send({type:'selectionCleared'})}
  }else return;
  serialize();
}
function insertLayer(kind,source){
  const presets={text:['p','Text'],heading:['h2','Heading'],button:['button','Button'],container:['div',''],rectangle:['div',''],image:['img','']};
  if(!Object.hasOwn(presets,kind))return;
  const [tag,text]=presets[kind],el=document.createElement(tag);
  el.textContent=text;
  if(tag==='button')el.type='button';
  if(kind==='container')el.style.cssText='min-height:48px;padding:12px;border:1px dashed #888';
  if(kind==='rectangle')el.style.cssText='width:120px;height:80px;background-color:#a4adb9';
  if(kind==='image'){
    if(!validImage(source))return;
    el.src=source;el.alt='';el.style.cssText='display:block;width:240px;max-width:100%;height:auto;object-fit:contain';
  }
  const container=el=>['MAIN','DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','FIGURE'].includes(el?.tagName);
  if(container(selected))selected.append(el);
  else if(selected&&container(selected.parentElement))selected.after(el);
  else if(root.children.length===1&&container(root.firstElementChild))root.firstElementChild.append(el);
  else root.append(el);
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
  const shapes={init:['html','styles','tokenStyles','stamp','editable','interactive','zoom'],render:['html','styles','tokenStyles','stamp'],setTokenStyles:['tokenStyles'],
    selectPath:['path'],clearSelection:[],editText:['id','text'],editStyle:['id','property','value'],editStyles:['id','patch'],
    alignElement:['id','axis','alignment'],exportLayer:['id'],addElement:['id','kind','source'],manageLayer:['id','action'],
    replaceImage:['id','source'],imageAlt:['id','alt'],configureEditor:['editable','interactive','zoom'],serialize:[]};
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
    if(m.type==='init')configureEditor(m.editable,m.interactive,m.zoom);
    return;
  }
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
  if(el===root){clearSelection();send({type:'selectionCleared'})}
  else select(el);
});})();`;
export const BRIDGE_HASH = 'gVXAwmZeREBqQ1CanHNgGqUCDZus6ovJESrw8aRwOzU=';
export const BRIDGE_SRC_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${BRIDGE_HASH}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"><style>html,body,#root{height:100%;margin:0}*,*::before,*::after{box-sizing:border-box}#root>svg:only-child{display:block}</style></head><body><div id="root"></div><script>${BRIDGE_SCRIPT}</script></body></html>`;
